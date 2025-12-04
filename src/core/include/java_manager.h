#pragma once
#include <string>
#include <vector>

namespace MinecraftCore {

struct JavaVersion {
    std::string path;
    int version = 0;
    std::string vendor;
    bool is64bit = true;
    std::string type; // "jdk", "jre", "graalvm"
    std::string architecture;
};

class JavaManager {
public:
    JavaManager();
    
    // Поиск Java
    std::vector<JavaVersion> FindAllJavaVersions();
    JavaVersion FindSuitableJava(const std::string& minecraftVersion);
    JavaVersion FindJavaByVersion(int minVersion, int maxVersion = 0);
    
    // Валидация
    bool ValidateJavaPath(const std::string& javaPath);
    JavaVersion GetJavaInfo(const std::string& javaPath);
    
    // Автоопределение
    std::string AutoDetectJavaPath(const std::string& minecraftVersion);
    
    // Установка
    bool DownloadJava(int version, const std::string& installDir);
    
private:
    std::vector<JavaVersion> installedJava_;
    
    void ScanSystemForJava();
    std::vector<std::string> GetJavaSearchPaths();
    
    // Платформозависимые методы
    std::vector<std::string> ScanWindowsRegistry();
    std::vector<std::string> ScanWindowsProgramFiles();
    std::vector<std::string> ScanLinuxSystem();
    std::vector<std::string> ScanMacOSSystem();
    
    // Проверка Java
    JavaVersion CheckJavaInstallation(const std::string& javaPath);
    std::string GetJavaVersionOutput(const std::string& javaPath);
    int ParseJavaVersion(const std::string& versionOutput);
    std::string ParseJavaVendor(const std::string& versionOutput);
    bool Check64Bit(const std::string& javaPath);
    
    // Кэширование
    void LoadCache();
    void SaveCache();
};

} // namespace MinecraftCore
