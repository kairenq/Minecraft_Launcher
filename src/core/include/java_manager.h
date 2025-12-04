#ifndef JAVA_MANAGER_H
#define JAVA_MANAGER_H

#include <string>
#include <vector>
#include <functional>
#include "launcher_core.h"

namespace Aureate {

class JavaManager {
public:
    JavaManager(const std::string& basePath);
    ~JavaManager();
    
    // Поиск Java установок
    std::vector<JavaConfig> FindJavaInstallations();
    
    // Установка Java
    bool InstallJava(const std::string& version = "17", ProgressCallback progress = nullptr);
    bool InstallJavaFromUrl(const std::string& url, ProgressCallback progress = nullptr);
    
    // Проверка Java
    bool IsJavaInstalled(const std::string& path = "");
    std::string GetJavaVersion(const std::string& path);
    
    // Получение конфигурации
    JavaConfig GetBestJavaConfig(const std::string& mcVersion = "");
    JavaConfig GetDefaultJavaConfig();
    
    // Создание аргументов JVM
    std::vector<std::string> CreateJvmArgs(const JavaConfig& config, const ModpackInfo& modpack);
    
    // Утилиты
    std::string GetJavaPath() const;
    std::string GetJavaVersionFromPath(const std::string& path);
    bool ValidateJava(const std::string& path);
    
private:
    std::string basePath_;
    
    // Поиск Java в системе
    std::vector<std::string> FindJavaInSystem();
    std::vector<std::string> FindJavaInRegistry(); // Windows only
    std::vector<std::string> FindJavaInPath();
    
    // Установка
    bool DownloadAndExtractJava(const std::string& url, ProgressCallback progress);
    bool ExtractJavaArchive(const std::string& archivePath, ProgressCallback progress);
    
    // Проверка совместимости
    bool IsJavaVersionCompatible(const std::string& javaVersion, const std::string& mcVersion);
    int ParseJavaVersion(const std::string& versionString);
    
    // URL для загрузки Java
    std::string GetJavaDownloadUrl(const std::string& version);
    std::string GetAdoptiumJavaUrl(const std::string& version);
    std::string GetZuluJavaUrl(const std::string& version);
    
    // Определение платформы
    std::string GetPlatform();
    std::string GetArchitecture();
    std::string GetPlatformExtension();
};

} // namespace Aureate

#endif // JAVA_MANAGER_H