#ifndef FORGE_HANDLER_H
#define FORGE_HANDLER_H

#include <string>
#include <functional>
#include "../launcher_core.h"

namespace Aureate {

class ForgeHandler {
public:
    ForgeHandler(const std::string& basePath);
    ~ForgeHandler();
    
    // Установка Forge
    bool Install(const std::string& mcVersion, const std::string& forgeVersion,
                ProgressCallback progress = nullptr);
    
    // Проверка установки
    bool IsInstalled(const std::string& mcVersion, const std::string& forgeVersion);
    
    // Создание профиля запуска
    bool CreateLaunchProfile(const std::string& mcVersion, const std::string& forgeVersion,
                            const std::string& instancePath);
    
    // Получение информации
    std::string GetForgeJarPath(const std::string& mcVersion, const std::string& forgeVersion);
    std::string GetForgeVersionFromJar(const std::string& jarPath);
    std::vector<std::string> GetForgeLibraries(const std::string& mcVersion,
                                              const std::string& forgeVersion);
    
    // Утилиты
    std::string GetForgeUniversalJarUrl(const std::string& mcVersion,
                                       const std::string& forgeVersion);
    std::string GetForgeInstallerJarUrl(const std::string& mcVersion,
                                       const std::string& forgeVersion);
    std::string ParseForgeVersion(const std::string& versionString);
    
private:
    std::string basePath_;
    
    // Установочные методы
    bool InstallViaInstaller(const std::string& mcVersion, const std::string& forgeVersion,
                            ProgressCallback progress);
    bool InstallViaUniversal(const std::string& mcVersion, const std::string& forgeVersion,
                            ProgressCallback progress);
    
    // Обработка установщика
    bool RunForgeInstaller(const std::string& installerPath, const std::string& mcVersion,
                          const std::string& forgeVersion);
    bool ExtractForgeUniversal(const std::string& universalPath, const std::string& mcVersion,
                              const std::string& forgeVersion);
    
    // Конфигурация
    bool CreateForgeVersionJson(const std::string& mcVersion, const std::string& forgeVersion);
    bool PatchVersionJson(const std::string& jsonPath, const std::string& forgeVersion);
    
    // Проверка целостности
    bool VerifyForgeInstallation(const std::string& mcVersion, const std::string& forgeVersion);
    
    // Управление библиотеками
    bool DownloadForgeLibraries(const std::string& mcVersion, const std::string& forgeVersion,
                               ProgressCallback progress);
    std::vector<std::string> ParseForgeLibraries(const std::string& installerPath);
    
    // Логирование
    void LogForgeInstallation(const std::string& mcVersion, const std::string& forgeVersion,
                             bool success, const std::string& error = "");
};

} // namespace Aureate

#endif // FORGE_HANDLER_H