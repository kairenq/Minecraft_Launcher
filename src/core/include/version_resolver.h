#pragma once
#include <string>
#include <vector>
#include "launcher_core.h"

namespace MinecraftCore {

class VersionResolver {
public:
    explicit VersionResolver(const std::string& versionsDir);
    
    // Анализ версий
    VersionInfo AnalyzeVersion(const std::string& versionId);
    std::string DetectModLoader(const std::string& versionId);
    std::string ExtractMinecraftVersion(const std::string& versionId);
    int DetectRequiredJava(const std::string& minecraftVersion);
    
    // Работа с файлами версий
    std::vector<VersionInfo> FindInstalledVersions();
    VersionInfo GetVersionInfo(const std::string& versionId);
    bool VersionExists(const std::string& versionId);
    
    // Валидация
    bool ValidateVersion(const std::string& versionId);
    std::vector<std::string> GetVersionDependencies(const std::string& versionId);
    
private:
    std::string versionsDir_;
    
    // Вспомогательные методы
    std::string ReadVersionFile(const std::string& versionId);
    std::string GetVersionJsonPath(const std::string& versionId);
    std::string GetVersionJarPath(const std::string& versionId);
    
    // Парсинг
    std::string ParseMainClass(const std::string& jsonContent);
    std::string ParseAssets(const std::string& jsonContent);
    std::string ParseInheritsFrom(const std::string& jsonContent);
    std::string ParseVersionType(const std::string& jsonContent);
    
    // Утилиты
    std::string GetOsName();
    std::string GetArchitecture();
};

} // namespace MinecraftCore
