#ifndef PACK_MANAGER_H
#define PACK_MANAGER_H

#include <string>
#include <vector>
#include <map>
#include <functional>
#include "launcher_core.h"

namespace Aureate {

class PackManager {
public:
    PackManager(const std::string& basePath);
    ~PackManager();
    
    // Управление сборками
    std::vector<ModpackInfo> GetInstalledModpacks();
    bool InstallModpack(const ModpackInfo& modpack, ProgressCallback progress = nullptr);
    bool UninstallModpack(const std::string& modpackId);
    bool UpdateModpack(const std::string& modpackId);
    
    // Импорт/экспорт
    bool ImportModpack(const std::string& filePath, ProgressCallback progress = nullptr);
    bool ExportModpack(const std::string& modpackId, const std::string& filePath,
                      ProgressCallback progress = nullptr);
    
    // Управление модами
    bool InstallMod(const std::string& modpackId, const std::string& modUrl,
                   ProgressCallback progress = nullptr);
    bool RemoveMod(const std::string& modpackId, const std::string& modId);
    bool UpdateMod(const std::string& modpackId, const std::string& modId,
                  ProgressCallback progress = nullptr);
    
    // Конфигурация
    bool CreateModpackConfig(const ModpackInfo& modpack);
    bool UpdateModpackConfig(const ModpackInfo& modpack);
    bool LoadModpackConfig(const std::string& modpackId, ModpackInfo& modpack);
    
    // Проверка целостности
    bool VerifyModpack(const std::string& modpackId);
    bool RepairModpack(const std::string& modpackId, ProgressCallback progress = nullptr);
    
    // Управление версиями
    bool CreateVersionBackup(const std::string& modpackId, const std::string& backupName);
    bool RestoreVersion(const std::string& modpackId, const std::string& backupName);
    bool DeleteVersionBackup(const std::string& modpackId, const std::string& backupName);
    
    // Утилиты
    std::string GetModpackPath(const std::string& modpackId) const;
    std::string GetModsPath(const std::string& modpackId) const;
    std::string GetConfigPath(const std::string& modpackId) const;
    std::string GetSavesPath(const std::string& modpackId) const;
    std::string GetResourcePacksPath(const std::string& modpackId) const;
    std::string GetShaderPacksPath(const std::string& modpackId) const;
    
    // Получение информации
    std::vector<std::string> GetInstalledMods(const std::string& modpackId);
    std::map<std::string, std::string> GetModpackStats(const std::string& modpackId);
    uint64_t GetModpackSize(const std::string& modpackId);
    
private:
    std::string basePath_;
    
    // Установка из разных источников
    bool InstallFromArchive(const std::string& archivePath, const std::string& destination,
                           ProgressCallback progress);
    bool InstallFromGitHub(const std::string& repoUrl, const std::string& destination,
                          ProgressCallback progress);
    bool InstallFromCurseForge(const std::string& projectId, const std::string& fileId,
                              const std::string& destination, ProgressCallback progress);
    bool InstallFromModrinth(const std::string& projectId, const std::string& versionId,
                            const std::string& destination, ProgressCallback progress);
    
    // Обработка архивов
    bool ExtractModpackArchive(const std::string& archivePath, const std::string& destination,
                              ProgressCallback progress);
    bool CreateModpackArchive(const std::string& sourcePath, const std::string& destination,
                             ProgressCallback progress);
    
    // Конфигурационные файлы
    bool ParsePackMcmeta(const std::string& filePath, ModpackInfo& modpack);
    bool ParseManifestJson(const std::string& filePath, ModpackInfo& modpack);
    bool CreatePackMcmeta(const ModpackInfo& modpack, const std::string& filePath);
    bool CreateManifestJson(const ModpackInfo& modpack, const std::string& filePath);
    
    // Управление зависимостями
    bool ResolveDependencies(const ModpackInfo& modpack, std::vector<std::string>& dependencies);
    bool InstallDependencies(const std::vector<std::string>& dependencies,
                            const std::string& destination, ProgressCallback progress);
    
    // Проверка совместимости
    bool CheckCompatibility(const ModpackInfo& modpack, std::string& error);
    bool CheckModCompatibility(const std::string& modpackId, const std::string& modUrl);
    
    // Управление бэкапами
    std::string GetBackupPath(const std::string& modpackId, const std::string& backupName) const;
    std::vector<std::string> GetAvailableBackups(const std::string& modpackId);
    
    // Логирование
    void LogModpackInstallation(const ModpackInfo& modpack, bool success,
                               const std::string& error = "");
};

} // namespace Aureate

#endif // PACK_MANAGER_H