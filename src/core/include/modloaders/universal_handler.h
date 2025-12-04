#ifndef UNIVERSAL_HANDLER_H
#define UNIVERSAL_HANDLER_H

#include <string>
#include <functional>
#include <memory>
#include "../launcher_core.h"
#include "forge_handler.h"
#include "fabric_handler.h"

namespace Aureate {

class UniversalHandler {
public:
    UniversalHandler(const std::string& basePath);
    ~UniversalHandler();
    
    // Установка любого модлоадера
    bool InstallModLoader(ModLoader loader, const std::string& mcVersion,
                         const std::string& loaderVersion, ProgressCallback progress = nullptr);
    
    // Проверка установки
    bool IsModLoaderInstalled(ModLoader loader, const std::string& mcVersion,
                             const std::string& loaderVersion);
    
    // Создание профиля запуска
    bool CreateLaunchProfile(ModLoader loader, const std::string& mcVersion,
                            const std::string& loaderVersion, const std::string& instancePath);
    
    // Получение информации
    std::string GetLoaderJarPath(ModLoader loader, const std::string& mcVersion,
                                const std::string& loaderVersion);
    std::vector<std::string> GetLoaderLibraries(ModLoader loader, const std::string& mcVersion,
                                               const std::string& loaderVersion);
    
    // Утилиты
    static std::string ModLoaderToString(ModLoader loader);
    static ModLoader StringToModLoader(const std::string& loader);
    static bool IsLoaderSupported(ModLoader loader);
    static std::vector<ModLoader> GetSupportedLoaders();
    
    // Конфигурация запуска
    std::vector<std::string> CreateLaunchArguments(ModLoader loader, const std::string& mcVersion,
                                                  const std::string& loaderVersion,
                                                  const std::string& instancePath);
    
    // Обновление модлоадера
    bool UpdateModLoader(ModLoader loader, const std::string& mcVersion,
                        const std::string& currentVersion, const std::string& newVersion,
                        ProgressCallback progress = nullptr);
    
    // Резервное копирование
    bool BackupLoader(ModLoader loader, const std::string& mcVersion,
                     const std::string& loaderVersion, const std::string& backupName);
    bool RestoreLoader(ModLoader loader, const std::string& mcVersion,
                      const std::string& loaderVersion, const std::string& backupName);
    
private:
    std::string basePath_;
    std::unique_ptr<ForgeHandler> forgeHandler_;
    std::unique_ptr<FabricHandler> fabricHandler_;
    
    // Обработчики для конкретных лоадеров
    bool HandleForgeInstall(const std::string& mcVersion, const std::string& forgeVersion,
                           ProgressCallback progress);
    bool HandleFabricInstall(const std::string& mcVersion, const std::string& fabricVersion,
                            ProgressCallback progress);
    bool HandleQuiltInstall(const std::string& mcVersion, const std::string& quiltVersion,
                           ProgressCallback progress);
    bool HandleNeoforgeInstall(const std::string& mcVersion, const std::string& neoforgeVersion,
                              ProgressCallback progress);
    
    // Проверки для конкретных лоадеров
    bool IsForgeInstalled(const std::string& mcVersion, const std::string& forgeVersion);
    bool IsFabricInstalled(const std::string& mcVersion, const std::string& fabricVersion);
    bool IsQuiltInstalled(const std::string& mcVersion, const std::string& quiltVersion);
    bool IsNeoforgeInstalled(const std::string& mcVersion, const std::string& neoforgeVersion);
    
    // Создание профилей для конкретных лоадеров
    bool CreateForgeProfile(const std::string& mcVersion, const std::string& forgeVersion,
                           const std::string& instancePath);
    bool CreateFabricProfile(const std::string& mcVersion, const std::string& fabricVersion,
                            const std::string& instancePath);
    bool CreateQuiltProfile(const std::string& mcVersion, const std::string& quiltVersion,
                           const std::string& instancePath);
    bool CreateNeoforgeProfile(const std::string& mcVersion, const std::string& neoforgeVersion,
                              const std::string& instancePath);
    
    // Получение путей для конкретных лоадеров
    std::string GetForgeJar(const std::string& mcVersion, const std::string& forgeVersion);
    std::string GetFabricJar(const std::string& mcVersion, const std::string& fabricVersion);
    std::string GetQuiltJar(const std::string& mcVersion, const std::string& quiltVersion);
    std::string GetNeoforgeJar(const std::string& mcVersion, const std::string& neoforgeVersion);
    
    // Утилиты для Quilt (похож на Fabric)
    bool InstallQuilt(const std::string& mcVersion, const std::string& quiltVersion,
                     ProgressCallback progress);
    std::string GetQuiltInstallerUrl(const std::string& mcVersion,
                                    const std::string& quiltVersion);
    
    // Утилиты для Neoforge (форк Forge)
    bool InstallNeoforge(const std::string& mcVersion, const std::string& neoforgeVersion,
                        ProgressCallback progress);
    std::string GetNeoforgeInstallerUrl(const std::string& mcVersion,
                                       const std::string& neoforgeVersion);
    
    // Общие утилиты
    bool ValidateLoaderVersion(ModLoader loader, const std::string& mcVersion,
                              const std::string& loaderVersion);
    bool CheckLoaderCompatibility(ModLoader loader, const std::string& mcVersion,
                                 const std::string& loaderVersion);
    
    // Логирование
    void LogLoaderInstallation(ModLoader loader, const std::string& mcVersion,
                              const std::string& loaderVersion, bool success,
                              const std::string& error = "");
};

} // namespace Aureate

#endif // UNIVERSAL_HANDLER_H