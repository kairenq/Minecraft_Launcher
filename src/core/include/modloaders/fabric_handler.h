#ifndef FABRIC_HANDLER_H
#define FABRIC_HANDLER_H

#include <string>
#include <functional>
#include "../launcher_core.h"

namespace Aureate {

class FabricHandler {
public:
    FabricHandler(const std::string& basePath);
    ~FabricHandler();
    
    // Установка Fabric
    bool Install(const std::string& mcVersion, const std::string& fabricVersion,
                ProgressCallback progress = nullptr);
    
    // Проверка установки
    bool IsInstalled(const std::string& mcVersion, const std::string& fabricVersion);
    
    // Создание профиля запуска
    bool CreateLaunchProfile(const std::string& mcVersion, const std::string& fabricVersion,
                            const std::string& instancePath);
    
    // Получение информации
    std::string GetFabricJarPath(const std::string& mcVersion, const std::string& fabricVersion);
    std::string GetFabricVersionFromJson(const std::string& jsonPath);
    std::vector<std::string> GetFabricLibraries(const std::string& mcVersion,
                                               const std::string& fabricVersion);
    
    // Утилиты
    std::string GetFabricInstallerUrl(const std::string& mcVersion,
                                     const std::string& fabricVersion);
    std::string GetFabricMetaUrl();
    std::string ParseFabricVersion(const std::string& versionString);
    
private:
    std::string basePath_;
    
    // Установка через installer
    bool InstallViaInstaller(const std::string& mcVersion, const std::string& fabricVersion,
                            ProgressCallback progress);
    
    // Обработка установщика
    bool RunFabricInstaller(const std::string& installerPath, const std::string& mcVersion,
                           const std::string& fabricVersion, const std::string& installPath);
    bool GenerateFabricJson(const std::string& mcVersion, const std::string& fabricVersion,
                           const std::string& installPath);
    
    // Конфигурация
    bool CreateFabricVersionJson(const std::string& mcVersion, const std::string& fabricVersion);
    bool CreateFabricProfile(const std::string& mcVersion, const std::string& fabricVersion,
                            const std::string& instancePath);
    
    // Загрузка метаданных
    bool LoadFabricMeta();
    std::string GetLatestFabricVersion(const std::string& mcVersion);
    
    // Проверка целостности
    bool VerifyFabricInstallation(const std::string& mcVersion, const std::string& fabricVersion);
    
    // Управление библиотеками
    bool DownloadFabricLibraries(const std::string& mcVersion, const std::string& fabricVersion,
                                ProgressCallback progress);
    std::vector<std::string> ParseFabricLibraries(const std::string& profileJson);
    
    // Логирование
    void LogFabricInstallation(const std::string& mcVersion, const std::string& fabricVersion,
                              bool success, const std::string& error = "");
    
    // Кэш метаданных
    std::map<std::string, std::vector<std::string>> fabricVersionsCache_;
    bool metaLoaded_ = false;
};

} // namespace Aureate

#endif // FABRIC_HANDLER_H