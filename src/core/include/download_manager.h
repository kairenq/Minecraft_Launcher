#ifndef DOWNLOAD_MANAGER_H
#define DOWNLOAD_MANAGER_H

#include <string>
#include <vector>
#include <functional>
#include <atomic>
#include <thread>
#include <mutex>
#include "launcher_core.h"

namespace Aureate {

struct DownloadTask {
    std::string url;
    std::string destination;
    std::string name;
    std::string sha1;
    uint64_t size;
    int priority;
    std::atomic<bool> completed;
    std::atomic<bool> failed;
    std::atomic<int> progress;
    
    DownloadTask(const std::string& u, const std::string& d, const std::string& n = "")
        : url(u), destination(d), name(n), sha1(""), size(0), priority(0),
          completed(false), failed(false), progress(0) {}
};

class DownloadManager {
public:
    DownloadManager();
    ~DownloadManager();
    
    // Управление загрузками
    void AddTask(const DownloadTask& task);
    void AddTasks(const std::vector<DownloadTask>& tasks);
    bool DownloadFile(const std::string& url, const std::string& destination,
                     ProgressCallback progress = nullptr);
    
    // Параллельные загрузки
    void StartDownload(int maxThreads = 4);
    void StopDownload();
    void WaitForCompletion();
    
    // Состояние
    bool IsDownloading() const;
    int GetCompletedCount() const;
    int GetTotalCount() const;
    int GetProgress() const; // общий прогресс в процентах
    
    // Управление
    void ClearCompleted();
    void ClearAll();
    void SetMaxThreads(int threads);
    void SetMaxRetries(int retries);
    void SetTimeout(int seconds);
    
    // Колбэки
    using TaskCallback = std::function<void(const DownloadTask& task)>;
    void SetTaskCompleteCallback(TaskCallback callback);
    void SetTaskFailedCallback(TaskCallback callback);
    void SetAllCompleteCallback(std::function<void()> callback);
    
private:
    struct ThreadData {
        std::thread thread;
        std::atomic<bool> running;
        int id;
    };
    
    std::vector<DownloadTask> tasks_;
    std::vector<ThreadData> threads_;
    std::mutex tasksMutex_;
    std::atomic<bool> stopRequested_;
    std::atomic<int> activeThreads_;
    std::atomic<int> completedCount_;
    std::atomic<int> failedCount_;
    
    int maxThreads_;
    int maxRetries_;
    int timeoutSeconds_;
    
    TaskCallback taskCompleteCallback_;
    TaskCallback taskFailedCallback_;
    std::function<void()> allCompleteCallback_;
    
    // Воркер потоков
    void DownloadWorker(int threadId);
    
    // Загрузка одного файла
    bool DownloadSingleFile(const DownloadTask& task);
    
    // Проверка целостности
    bool VerifyChecksum(const std::string& filePath, const std::string& expectedSha1);
    std::string CalculateSha1(const std::string& filePath);
    
    // HTTP клиент
    bool HttpDownload(const std::string& url, const std::string& destination,
                     std::function<void(int)> progressCallback = nullptr);
    
    // Утилиты
    std::string GetTempFilePath(const std::string& originalPath);
    bool MoveWithRetry(const std::string& source, const std::string& destination);
    
    // Очистка
    void CleanupThreads();
};

} // namespace Aureate

#endif // DOWNLOAD_MANAGER_H