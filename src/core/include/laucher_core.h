#pragma once
#include <string>
#include <vector>
#include <memory>
#include <functional>

namespace MinecraftCore {

// Структуры данных
struct LaunchOptions {
    std::string versionId;
    std::string username;
    std::string gameDir;
    std::string javaPath;
    int memory = 4096;
    std::string serverIp;
    int serverPort = 25565;
    int width = 854;
    int height = 480;
    bool demo = false;
    bool offline = true;
    std::string extraJavaArgs;
    std::string extraGameArgs;
};

struct VersionInfo {
    std::string id;
    std::string name;
    std::string type;
    std::string modLoader;
    std::string minecraftVersion;
    std::string releaseTime;
    int javaVersion;
    std::string mainClass;
    std::string assets;
    std::string inheritsFrom;
};

struct ProcessResult {
    int pid = 0;
    bool success = false;
    std::string message;
    int exitCode = 0;
};

struct PackInfo {
    std::string id;
    std::string name;
    std::string description;
    std::string version;
    std::string minecraftVersion;
    std::string modLoader;
    std::string downloadUrl;
    size_t size = 0;
    std::vector<std::string> dependencies;
};

// Callback типы
using ProgressCallback = std::function<void(int percent, const std::string& message)>;
using LogCallback = std::function<void(const std::string& message)>;

// Главный класс лаунчера
class LauncherCore {
public:
    explicit LauncherCore(const std::string& launcherDir);
    ~LauncherCore();
    
    // Основные методы
    ProcessResult Launch(const LaunchOptions& options);
    std::vector<VersionInfo> GetInstalledVersions();
    bool InstallVersion(const std::string& versionId, const std::string& modLoader = "");
    
    // Утилиты
    bool ValidateInstallation(const std::string& versionId);
    std::vector<std::string> GetMissingFiles(const std::string& versionId);
    
    // Callbacks
    void SetProgressCallback(ProgressCallback callback) { progressCallback_ = callback; }
    void SetLogCallback(LogCallback callback) { logCallback_ = callback; }
    
private:
    std::string launcherDir_;
    std::string versionsDir_;
    std::string librariesDir_;
    std::string assetsDir_;
    
    ProgressCallback progressCallback_;
    LogCallback logCallback_;
    
    // Вспомогательные методы
    void Log(const std::string& message);
    void Progress(int percent, const std::string& message = "");
    
    // Работа с файлами
    bool CheckFileExists(const std::string& path);
    bool EnsureDirectory(const std::string& path);
    
    // Модлоадеры
    class ForgeHandler* forgeHandler_;
    class FabricHandler* fabricHandler_;
    class UniversalHandler* universalHandler_;
};

} // namespace MinecraftCore
