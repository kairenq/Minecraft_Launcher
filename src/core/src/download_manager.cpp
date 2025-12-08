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
    : stopRequested_(false), maxThreads_(4), maxRetries_(3), timeoutSeconds_(30),
      activeThreads_(0), completedCount_(0), failedCount_(0) {}

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
    if (progress) progress(100, success ? "Download completed!" : "Download failed!");
    return success;
}

void DownloadManager::StartDownload(int maxThreads) {
    maxThreads_ = maxThreads;
    stopRequested_ = false;
    completedCount_ = 0;
    failedCount_ = 0;

    for (int i = 0; i < maxThreads_; i++) {
        ThreadData data;
        data.running = true;
        data.id = i;
        data.thread = std::thread(&DownloadManager::DownloadWorker, this, i);
        threads_.push_back(std::move(data));
    }
}

void DownloadManager::StopDownload() {
    stopRequested_ = true;
    for (auto& thread : threads_) {
        if (thread.thread.joinable())
            thread.thread.join();
    }
    threads_.clear();
}

bool DownloadManager::IsDownloading() const {
    return activeThreads_ > 0;
}

void DownloadManager::DownloadWorker(int threadId) {
    activeThreads_++;

    while (!stopRequested_) {
        DownloadTask task("", "");
        bool hasTask = false;

        {
            std::lock_guard<std::mutex> lock(tasksMutex_);
            for (auto& t : tasks_) {
                if (!t.completed && !t.failed) {
                    task = t;
                    t.completed = true;
                    hasTask = true;
                    break;
                }
            }
        }

        if (!hasTask) break;

        bool success = DownloadSingleFile(task);
        if (success) completedCount_++; else failedCount_++;

        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    activeThreads_--;
}

bool DownloadManager::DownloadSingleFile(const DownloadTask& task) {
#ifdef _WIN32
    return HttpDownloadWindows(task.url, task.destination,
        [this, &task](int progress) {});
#else
    return HttpDownloadCurl(task.url, task.destination,
        [this, &task](int progress) {});
#endif
}

#ifdef _WIN32

static bool HttpDownloadWindowsInternal(const std::string& url,
                                       const std::string& destination,
                                       std::function<void(int)> progressCallback,
                                       int redirectDepth,
                                       int timeoutSeconds) {
    if (redirectDepth > 6) {
        std::cout << "[ERROR] Too many redirects\n";
        return false;
    }

    std::string scheme, server, path;
    size_t pos = url.find("://");
    if (pos == std::string::npos) return false;

    scheme = url.substr(0, pos);
    std::string rest = url.substr(pos + 3);
    size_t pathPos = rest.find('/');
    server = rest.substr(0, pathPos);
    path = (pathPos != std::string::npos) ? rest.substr(pathPos) : "/";

    HINTERNET hSession = WinHttpOpen(L"Aureate Launcher",
                                    WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME,
                                    WINHTTP_NO_PROXY_BYPASS, 0);

    std::wstring wServer(server.begin(), server.end());
    std::wstring wPath(path.begin(), path.end());
    INTERNET_PORT port = (scheme == "https") ? INTERNET_DEFAULT_HTTPS_PORT : INTERNET_DEFAULT_HTTP_PORT;

    HINTERNET hConnect = WinHttpConnect(hSession, wServer.c_str(), port, 0);
    DWORD flags = (scheme == "https") ? WINHTTP_FLAG_SECURE : 0;

    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", wPath.c_str(),
                                           NULL, WINHTTP_NO_REFERER,
                                           WINHTTP_DEFAULT_ACCEPT_TYPES, flags);

    DWORD timeoutMs = timeoutSeconds * 1000;
    WinHttpSetTimeouts(hRequest, timeoutMs, timeoutMs, timeoutMs, timeoutMs);

    WinHttpSendRequest(hRequest,
                       WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                       WINHTTP_NO_REQUEST_DATA, 0,
                       0, 0);

    WinHttpReceiveResponse(hRequest, NULL);

    DWORD statusCode = 0;
    DWORD size = sizeof(statusCode);
    WinHttpQueryHeaders(hRequest,
                        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX,
                        &statusCode, &size,
                        WINHTTP_NO_HEADER_INDEX);

    if (statusCode == 301 || statusCode == 302 || statusCode == 307 || statusCode == 308) {
        DWORD dwLen = 0;
        WinHttpQueryHeaders(hRequest,
                            WINHTTP_QUERY_LOCATION,
                            WINHTTP_HEADER_NAME_BY_INDEX,
                            NULL, &dwLen,
                            WINHTTP_NO_HEADER_INDEX);

        std::vector<char> buffer(dwLen + 1);
        WinHttpQueryHeaders(hRequest,
                            WINHTTP_QUERY_LOCATION,
                            WINHTTP_HEADER_NAME_BY_INDEX,
                            buffer.data(), &dwLen,
                            WINHTTP_NO_HEADER_INDEX);

        std::string newUrl(buffer.data(), dwLen);
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);

        return HttpDownloadWindowsInternal(newUrl, destination, progressCallback, redirectDepth + 1, timeoutSeconds);
    }

    std::ofstream out(destination + ".tmp", std::ios::binary);
    DWORD dwDownloaded = 0;
    do {
        DWORD dwSize = 0;
        WinHttpQueryDataAvailable(hRequest, &dwSize);
        if (!dwSize) break;

        std::vector<char> buf(dwSize);
        WinHttpReadData(hRequest, buf.data(), dwSize, &dwDownloaded);
        out.write(buf.data(), dwDownloaded);
    } while (true);

    out.close();
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);

    return FileUtils::MoveFile(destination + ".tmp", destination);
}

bool DownloadManager::HttpDownloadWindows(const std::string& url,
                                          const std::string& destination,
                                          std::function<void(int)> progressCallback) {
    return HttpDownloadWindowsInternal(url, destination, progressCallback, 0, timeoutSeconds_);
}

#else

bool DownloadManager::HttpDownloadCurl(const std::string& url,
                                      const std::string& destination,
                                      std::function<void(int)> progressCallback) {

    CURL* curl = curl_easy_init();
    FILE* fp = fopen((destination + ".tmp").c_str(), "wb");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, fp);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeoutSeconds_);

    CURLcode res = curl_easy_perform(curl);

    fclose(fp);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        FileUtils::DeleteFile(destination + ".tmp");
        return false;
    }

    return FileUtils::MoveFile(destination + ".tmp", destination);
}

#endif

void DownloadManager::CleanupThreads() {
    for (auto& thread : threads_) {
        if (thread.thread.joinable())
            thread.thread.join();
    }
    threads_.clear();
}

}
