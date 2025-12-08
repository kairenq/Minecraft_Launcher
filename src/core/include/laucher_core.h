#ifndef LAUNCHER_CORE_H
#define LAUNCHER_CORE_H

#include <string>
#include <vector>
#include <functional>
#include <map>
#include <memory>

namespace Aureate {

// Типы модлоадеров
enum class ModLoader {
    VANILLA,
    FORGE,
    FABRIC,
    QUILT,
    NEOFORGE,
    UNKNOWN
};

// Структура для версии Minecraft
struct MinecraftVersion {
    std::string id;
    std::string releaseTime;
    std::string type;
    std::string url;
    
    bool operator==(const MinecraftVersion& other) const {
        return id == other.id;
    }
};

// Структура для информации о сборке
struct ModpackInfo {
    std::string id;
    std::string name;
    std::string description;
    std::string minecraftVersion;
    ModLoader modLoader;
    std::string modLoaderVersion;
    std::string iconUrl;
    std::string archiveUrl;
    std::vector<std::string> modUrls;
    bool installed;
    std::string installPath;
    std::string lastPlayed;
    int playTime; // в секундах
    int launchCount;
    
    // Создание уникального ID для сборки
    static std::string GenerateId(const std::string& name, const std::string& mcVersion) {
        std::string id = name + "_" + mcVersion;
        // Заменяем недопустимые символы
        for (char& c : id) {
            if (!std::isalnum(c) && c != '_' && c != '-') {
                c = '_';
            }
        }
        return id;
    }
};

// Структура для конфигурации Java
struct JavaConfig {
    std::string path;
    std::string version;
    int maxMemory; // MB
    int minMemory; // MB
    std::vector<std::string> jvmArgs;
    
    JavaConfig() : maxMemory(2048), minMemory(512) {}
};

// Структура для информации о системе
struct SystemInfo {
    std::string osName;
    std::string osVersion;
    std::string architecture;
    size_t totalMemory; // MB
    size_t freeMemory;  // MB
    int processorCount;
    std::string javaVersion;
    std::string javaPath;
    
    SystemInfo() : totalMemory(0), freeMemory(0), processorCount(0) {}
};

// Колбэки для прогресса
using ProgressCallback = std::function<void(int percent, const std::string& stage)>;
using LogCallback = std::function<void(const std::string& message, const std::string& level)>;

// Основной класс лаунчера
class LauncherCore {
public:
    LauncherCore(const std::string& basePath);
    ~LauncherCore();
    
    // Инициализация
    bool Initialize();
    
    // Управление сборками
    std::vector<ModpackInfo> GetAvailableModpacks();
    bool InstallModpack(const ModpackInfo& modpack, ProgressCallback progress = nullptr);
    bool UninstallModpack(const std::string& modpackId);
    bool UpdateModpack(const std::string& modpackId);
    
    // Управление версиями Minecraft
    std::vector<MinecraftVersion> GetAvailableVersions();
    bool InstallMinecraftVersion(const std::string& versionId, ProgressCallback progress = nullptr);
    bool IsVersionInstalled(const std::string& versionId);
    
    // Управление Java
    std::vector<JavaConfig> FindJavaInstallations();
    bool InstallJava(const std::string& version = "17", ProgressCallback progress = nullptr);
    JavaConfig GetBestJavaConfig();
    
    // Запуск игры
    bool LaunchGame(const ModpackInfo& modpack, const JavaConfig& javaConfig,
                   const std::string& username, ProgressCallback progress = nullptr);
    
    // Управление модлоадерами
    bool InstallModLoader(ModLoader loader, const std::string& mcVersion,
                         const std::string& loaderVersion, ProgressCallback progress = nullptr);
    bool IsModLoaderInstalled(ModLoader loader, const std::string& mcVersion,
                             const std::string& loaderVersion);
    
    // Информация о системе
    SystemInfo GetSystemInfo();
    
    // Утилиты
    std::string GetBasePath() const { return basePath_; }
    std::string GetVersionsPath() const;
    std::string GetInstancesPath() const;
    std::string GetJavaPath() const;
    std::string GetLibrariesPath() const;
    std::string GetAssetsPath() const;
    
    // Установка колбэков
    void SetLogCallback(LogCallback callback) { logCallback_ = callback; }
    
private:
    std::string basePath_;
    LogCallback logCallback_;
    
    // Вспомогательные методы
    void Log(const std::string& message, const std::string& level = "INFO");
    bool DownloadFile(const std::string& url, const std::string& destination, ProgressCallback progress = nullptr);
    bool ExtractArchive(const std::string& archivePath, const std::string& destination, ProgressCallback progress = nullptr);
    bool ExecuteProcess(const std::vector<std::string>& args, const std::string& workingDir = "");
    
    // Методы для конкретных модлоадеров
    bool InstallForge(const std::string& mcVersion, const std::string& forgeVersion, ProgressCallback progress);
    bool InstallFabric(const std::string& mcVersion, const std::string& fabricVersion, ProgressCallback progress);
    bool InstallQuilt(const std::string& mcVersion, const std::string& quiltVersion, ProgressCallback progress);
    bool InstallNeoforge(const std::string& mcVersion, const std::string& neoforgeVersion, ProgressCallback progress);
    
    // Кэшированные данные
    std::vector<MinecraftVersion> cachedVersions_;
    bool versionsCached_ = false;
};

// Утилиты для работы со строками
namespace StringUtils {
    std::string ToLower(const std::string& str);
    std::string ToUpper(const std::string& str);
    bool StartsWith(const std::string& str, const std::string& prefix);
    bool EndsWith(const std::string& str, const std::string& suffix);
    std::vector<std::string> Split(const std::string& str, char delimiter);
    std::string Join(const std::vector<std::string>& parts, const std::string& delimiter);
    std::string Replace(const std::string& str, const std::string& from, const std::string& to);
    bool Contains(const std::string& str, const std::string& substr);
    std::string Trim(const std::string& str);
    std::string GetFileExtension(const std::string& filename);
    std::string GetFileNameWithoutExtension(const std::string& filename);
}

// Утилиты для работы с файлами
namespace FileUtils {
    bool Exists(const std::string& path);
    bool IsDirectory(const std::string& path);
    bool CreateDirectory(const std::string& path);
    bool DeleteFile(const std::string& path);
    bool DeleteDirectory(const std::string& path);
    bool CopyFile(const std::string& source, const std::string& destination);
    bool MoveFile(const std::string& source, const std::string& destination);
    std::string ReadFile(const std::string& path);
    bool WriteFile(const std::string& path, const std::string& content);
    std::vector<std::string> ListFiles(const std::string& path, const std::string& extension = "");
    std::vector<std::string> ListDirectories(const std::string& path);
    uint64_t GetFileSize(const std::string& path);
    std::string GetAbsolutePath(const std::string& path);
    std::string GetDirectory(const std::string& path);
    std::string GetFileName(const std::string& path);
    bool ExtractZip(const std::string& zipPath, const std::string& destination);
    bool DownloadToFile(const std::string& url, const std::string& destination,
                       std::function<void(int)> progressCallback = nullptr);
}

} // namespace Aureate

#endif // LAUNCHER_CORE_H