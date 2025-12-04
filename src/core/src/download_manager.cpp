#include "download_manager.h"
#include "utils/file_utils.h"
#include "utils/string_utils.h"
#include <iostream>
#include <fstream>
#include <thread>
#include <chrono>

#ifdef _WIN32
#include <windows.h>
#include <winhttp.h>
#pragma comment(lib, "winhttp.lib")
#else
#include <curl/curl.h>
#endif

namespace Aureate {

DownloadManager::DownloadManager() 
    : stopRequested_(false), maxThreads_(4), maxRetries_(3), timeoutSeconds_(30) {
}

DownloadManager::~DownloadManager() {
    StopDownload();
    CleanupThreads();
}

void DownloadManager::AddTask(const DownloadTask& task) {
    std::lock_guard<std::mutex> lock(tasksMutex_);
    tasks_.push_back(task);
}

void DownloadManager::AddTasks(const std::vector<DownloadTask>& tasks) {
    std::lock_guard<std::mutex> lock(tasksMutex_);
    tasks_.insert(tasks_.end(), tasks.begin(), tasks.end());
}

bool DownloadManager::DownloadFile(const std::string& url, const std::string& destination,
                                  ProgressCallback progress) {
    DownloadTask task(url, destination, FileUtils::GetFileName(url));
    
    if (progress) progress(0, "Starting download...");
    
    bool success = DownloadSingleFile(task);
    
    if (success) {
        if (progress) progress(100, "Download completed!");
        return true;
    } else {
        if (progress) progress(100, "Download failed!");
        return false;
    }
}

void DownloadManager::StartDownload(int maxThreads) {
    if (IsDownloading()) {
        std::cout << "[WARNING] Download already in progress" << std::endl;
        return;
    }
    
    maxThreads_ = maxThreads;
    stopRequested_ = false;
    completedCount_ = 0;
    failedCount_ = 0;
    
    // Создаем потоки
    for (int i = 0; i < maxThreads_; i++) {
        ThreadData data;
        data.running = true;
        data.id = i;
        data.thread = std::thread(&DownloadManager::DownloadWorker, this, i);
        threads_.push_back(std::move(data));
    }
    
    std::cout << "[INFO] Started download with " << maxThreads_ << " threads" << std::endl;
}

void DownloadManager::StopDownload() {
    stopRequested_ = true;
    
    for (auto& thread : threads_) {
        if (thread.thread.joinable()) {
            thread.thread.join();
        }
    }
    
    threads_.clear();
}

void DownloadManager::WaitForCompletion() {
    while (IsDownloading()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

bool DownloadManager::IsDownloading() const {
    return activeThreads_ > 0;
}

int DownloadManager::GetCompletedCount() const {
    return completedCount_;
}

int DownloadManager::GetTotalCount() const {
    return tasks_.size();
}

int DownloadManager::GetProgress() const {
    int total = tasks_.size();
    if (total == 0) return 0;
    
    return (completedCount_ * 100) / total;
}

void DownloadManager::SetMaxThreads(int threads) {
    maxThreads_ = threads;
}

void DownloadManager::SetMaxRetries(int retries) {
    maxRetries_ = retries;
}

void DownloadManager::SetTimeout(int seconds) {
    timeoutSeconds_ = seconds;
}

void DownloadManager::DownloadWorker(int threadId) {
    activeThreads_++;
    
    while (!stopRequested_) {
        DownloadTask task;
        bool hasTask = false;
        
        // Берем задачу из очереди
        {
            std::lock_guard<std::mutex> lock(tasksMutex_);
            for (auto& t : tasks_) {
                if (!t.completed && !t.failed) {
                    task = t;
                    hasTask = true;
                    break;
                }
            }
        }
        
        if (!hasTask) {
            break;
        }
        
        std::cout << "[THREAD " << threadId << "] Downloading: " << task.name 
                  << " from " << task.url << std::endl;
        
        bool success = DownloadSingleFile(task);
        
        if (success) {
            completedCount_++;
            if (taskCompleteCallback_) {
                taskCompleteCallback_(task);
            }
        } else {
            failedCount_++;
            if (taskFailedCallback_) {
                taskFailedCallback_(task);
            }
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    
    activeThreads_--;
    
    // Если все задачи выполнены, вызываем колбэк
    if (activeThreads_ == 0 && allCompleteCallback_) {
        allCompleteCallback_();
    }
}

bool DownloadManager::DownloadSingleFile(const DownloadTask& task) {
#ifdef _WIN32
    return HttpDownloadWindows(task.url, task.destination, 
        [this, &task](int progress) {
            // Обработка прогресса
        });
#else
    return HttpDownloadCurl(task.url, task.destination,
        [this, &task](int progress) {
            // Обработка прогресса
        });
#endif
}

#ifdef _WIN32
bool DownloadManager::HttpDownloadWindows(const std::string& url, const std::string& destination,
                                        std::function<void(int)> progressCallback) {
    // Разбираем URL
    std::string server, path;
    size_t pos = url.find("://");
    if (pos != std::string::npos) {
        std::string rest = url.substr(pos + 3);
        size_t pathPos = rest.find('/');
        if (pathPos != std::string::npos) {
            server = rest.substr(0, pathPos);
            path = rest.substr(pathPos);
        } else {
            server = rest;
            path = "/";
        }
    } else {
        std::cout << "[ERROR] Invalid URL: " << url << std::endl;
        return false;
    }
    
    HINTERNET hSession = NULL, hConnect = NULL, hRequest = NULL;
    BOOL bResults = FALSE;
    DWORD dwSize = 0;
    DWORD dwDownloaded = 0;
    LPSTR pszOutBuffer;
    
    // Создаем временный файл
    std::string tempFile = destination + ".tmp";
    std::ofstream outFile(tempFile, std::ios::binary);
    if (!outFile.is_open()) {
        std::cout << "[ERROR] Failed to create temp file: " << tempFile << std::endl;
        return false;
    }
    
    try {
        // Используем WinHttp
        hSession = WinHttpOpen(L"Aureate Launcher/1.0",
                              WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                              WINHTTP_NO_PROXY_NAME,
                              WINHTTP_NO_PROXY_BYPASS, 0);
        
        if (!hSession) {
            throw std::runtime_error("WinHttpOpen failed");
        }
        
        // Конвертируем строки в wide char
        std::wstring wServer(server.begin(), server.end());
        std::wstring wPath(path.begin(), path.end());
        
        hConnect = WinHttpConnect(hSession, wServer.c_str(),
                                 INTERNET_DEFAULT_HTTPS_PORT, 0);
        
        if (!hConnect) {
            throw std::runtime_error("WinHttpConnect failed");
        }
        
        hRequest = WinHttpOpenRequest(hConnect, L"GET", wPath.c_str(),
                                      NULL, WINHTTP_NO_REFERER,
                                      WINHTTP_DEFAULT_ACCEPT_TYPES,
                                      WINHTTP_FLAG_SECURE);
        
        if (!hRequest) {
            throw std::runtime_error("WinHttpOpenRequest failed");
        }
        
        bResults = WinHttpSendRequest(hRequest,
                                     WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                     WINHTTP_NO_REQUEST_DATA, 0,
                                     0, 0);
        
        if (!bResults) {
            throw std::runtime_error("WinHttpSendRequest failed");
        }
        
        bResults = WinHttpReceiveResponse(hRequest, NULL);
        if (!bResults) {
            throw std::runtime_error("WinHttpReceiveResponse failed");
        }
        
        // Получаем размер файла
        DWORD contentLength = 0;
        DWORD dwSize = sizeof(contentLength);
        WinHttpQueryHeaders(hRequest,
                           WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
                           WINHTTP_HEADER_NAME_BY_INDEX,
                           &contentLength, &dwSize, WINHTTP_NO_HEADER_INDEX);
        
        // Читаем данные
        DWORD totalDownloaded = 0;
        do {
            dwSize = 0;
            if (!WinHttpQueryDataAvailable(hRequest, &dwSize)) {
                throw std::runtime_error("WinHttpQueryDataAvailable failed");
            }
            
            if (dwSize == 0) {
                break;
            }
            
            pszOutBuffer = new char[dwSize + 1];
            if (!pszOutBuffer) {
                throw std::runtime_error("Out of memory");
            }
            
            ZeroMemory(pszOutBuffer, dwSize + 1);
            
            if (!WinHttpReadData(hRequest, (LPVOID)pszOutBuffer,
                                dwSize, &dwDownloaded)) {
                delete[] pszOutBuffer;
                throw std::runtime_error("WinHttpReadData failed");
            }
            
            outFile.write(pszOutBuffer, dwDownloaded);
            totalDownloaded += dwDownloaded;
            
            // Отправляем прогресс
            if (progressCallback && contentLength > 0) {
                int progress = (totalDownloaded * 100) / contentLength;
                progressCallback(progress);
            }
            
            delete[] pszOutBuffer;
            
        } while (dwSize > 0);
        
        outFile.close();
        
        // Переименовываем временный файл
        if (!MoveWithRetry(tempFile, destination)) {
            throw std::runtime_error("Failed to move downloaded file");
        }
        
        std::cout << "[SUCCESS] Downloaded: " << url << " -> " << destination << std::endl;
        
    } catch (const std::exception& e) {
        std::cout << "[ERROR] Download failed: " << e.what() << std::endl;
        outFile.close();
        FileUtils::DeleteFile(tempFile);
        bResults = FALSE;
    }
    
    // Очистка
    if (hRequest) WinHttpCloseHandle(hRequest);
    if (hConnect) WinHttpCloseHandle(hConnect);
    if (hSession) WinHttpCloseHandle(hSession);
    
    return bResults == TRUE;
}
#else
// Linux/macOS реализация с использованием libcurl
bool DownloadManager::HttpDownloadCurl(const std::string& url, const std::string& destination,
                                      std::function<void(int)> progressCallback) {
    CURL* curl;
    FILE* fp;
    CURLcode res;
    
    curl = curl_easy_init();
    if (!curl) {
        std::cout << "[ERROR] Failed to initialize curl" << std::endl;
        return false;
    }
    
    std::string tempFile = destination + ".tmp";
    fp = fopen(tempFile.c_str(), "wb");
    if (!fp) {
        std::cout << "[ERROR] Failed to open file: " << tempFile << std::endl;
        curl_easy_cleanup(curl);
        return false;
    }
    
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, NULL);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, fp);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Aureate Launcher/1.0");
    
    // Таймаут
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeoutSeconds_);
    
    // Прогресс
    struct ProgressData {
        std::function<void(int)> callback;
        double totalSize;
    };
    
    ProgressData progressData{progressCallback, 0.0};
    
    if (progressCallback) {
        curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
        curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, 
            [](void* clientp, curl_off_t dltotal, curl_off_t dlnow,
               curl_off_t ultotal, curl_off_t ulnow) {
                ProgressData* data = static_cast<ProgressData*>(clientp);
                if (data->callback && dltotal > 0) {
                    int progress = (dlnow * 100) / dltotal;
                    data->callback(progress);
                }
                return 0;
            });
        curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &progressData);
    }
    
    res = curl_easy_perform(curl);
    
    fclose(fp);
    curl_easy_cleanup(curl);
    
    if (res != CURLE_OK) {
        std::cout << "[ERROR] curl_easy_perform() failed: " 
                  << curl_easy_strerror(res) << std::endl;
        FileUtils::DeleteFile(tempFile);
        return false;
    }
    
    // Переименовываем файл
    if (!MoveWithRetry(tempFile, destination)) {
        std::cout << "[ERROR] Failed to move downloaded file" << std::endl;
        return false;
    }
    
    std::cout << "[SUCCESS] Downloaded: " << url << std::endl;
    return true;
}
#endif

bool DownloadManager::MoveWithRetry(const std::string& source, const std::string& destination) {
    for (int i = 0; i < 3; i++) {
        if (FileUtils::MoveFile(source, destination)) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return false;
}

void DownloadManager::CleanupThreads() {
    for (auto& thread : threads_) {
        if (thread.thread.joinable()) {
            thread.thread.join();
        }
    }
    threads_.clear();
}

} // namespace Aureate