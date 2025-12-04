#include "pack_manager.h"
#include "download_manager.h"
#include "utils/file_utils.h"
#include "utils/string_utils.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <regex>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace Aureate {

PackManager::PackManager(const std::string& basePath) : basePath_(basePath) {
    FileUtils::CreateDirectory(basePath_);
    FileUtils::CreateDirectory(GetInstancesPath());
}

PackManager::~PackManager() {}

std::vector<ModpackInfo> PackManager::GetInstalledModpacks() {
    std::vector<ModpackInfo> modpacks;
    
    std::string instancesPath = GetInstancesPath();
    if (!FileUtils::Exists(instancesPath)) {
        return modpacks;
    }
    
    auto directories = FileUtils::ListDirectories(instancesPath);
    for (const auto& dir : directories) {
        std::string configPath = instancesPath + "/" + dir + "/modpack.json";
        if (FileUtils::Exists(configPath)) {
            ModpackInfo modpack;
            if (LoadModpackConfig(dir, modpack)) {
                modpacks.push_back(modpack);
            }
        }
    }
    
    return modpacks;
}

bool PackManager::InstallModpack(const ModpackInfo& modpack, ProgressCallback progress) {
    std::string logMsg = "Installing modpack: " + modpack.name + " (" + modpack.id + ")";
    std::cout << "[INFO] " << logMsg << std::endl;
    
    if (progress) progress(0, "Preparing to install " + modpack.name + "...");
    
    try {
        // Создаем директорию для сборки
        std::string instancePath = GetModpackPath(modpack.id);
        std::cout << "[DEBUG] Instance path: " << instancePath << std::endl;
        
        if (!FileUtils::CreateDirectory(instancePath)) {
            std::string error = "Failed to create directory: " + instancePath;
            std::cout << "[ERROR] " << error << std::endl;
            if (progress) progress(100, error);
            return false;
        }
        
        // Проверяем наличие архива
        if (modpack.archiveUrl.empty()) {
            std::string error = "No archive URL provided for modpack";
            std::cout << "[ERROR] " << error << std::endl;
            if (progress) progress(100, error);
            return false;
        }
        
        // Скачиваем архив
        if (progress) progress(10, "Downloading modpack archive...");
        std::cout << "[DEBUG] Downloading from: " << modpack.archiveUrl << std::endl;
        
        std::string tempArchive = instancePath + "/temp_modpack.zip";
        DownloadManager downloader;
        
        if (!downloader.DownloadFile(modpack.archiveUrl, tempArchive, 
            [progress](int p, const std::string& stage) {
                if (progress) {
                    int adjustedProgress = 10 + (p * 0.5); // 10-60%
                    progress(adjustedProgress, "Downloading: " + stage);
                }
            })) {
            std::string error = "Failed to download modpack archive";
            std::cout << "[ERROR] " << error << std::endl;
            if (progress) progress(100, error);
            return false;
        }
        
        // Извлекаем архив
        if (progress) progress(60, "Extracting modpack files...");
        std::cout << "[DEBUG] Extracting archive to: " << instancePath << std::endl;
        
        if (!ExtractModpackArchive(tempArchive, instancePath,
            [progress](int p, const std::string& stage) {
                if (progress) {
                    int adjustedProgress = 60 + (p * 0.3); // 60-90%
                    progress(adjustedProgress, "Extracting: " + stage);
                }
            })) {
            std::string error = "Failed to extract modpack archive";
            std::cout << "[ERROR] " << error << std::endl;
            if (progress) progress(100, error);
            FileUtils::DeleteFile(tempArchive);
            return false;
        }
        
        // Удаляем временный архив
        FileUtils::DeleteFile(tempArchive);
        
        // Создаем конфиг сборки
        if (progress) progress(90, "Creating modpack configuration...");
        
        ModpackInfo installedModpack = modpack;
        installedModpack.installed = true;
        installedModpack.installPath = instancePath;
        
        if (!CreateModpackConfig(installedModpack)) {
            std::cout << "[WARNING] Failed to create modpack config, but installation completed" << std::endl;
        }
        
        // Проверяем наличие minecraft и создаем если нет
        std::string mcPath = instancePath + "/.minecraft";
        if (!FileUtils::Exists(mcPath)) {
            std::cout << "[INFO] Creating .minecraft directory structure" << std::endl;
            FileUtils::CreateDirectory(mcPath);
            
            // Создаем поддиректории
            std::vector<std::string> subdirs = {
                "mods",
                "config",
                "resourcepacks",
                "shaderpacks",
                "saves",
                "logs"
            };
            
            for (const auto& dir : subdirs) {
                FileUtils::CreateDirectory(mcPath + "/" + dir);
            }
        }
        
        if (progress) progress(100, "Modpack installed successfully!");
        std::cout << "[INFO] Modpack installed successfully: " << modpack.name << std::endl;
        
        LogModpackInstallation(modpack, true);
        return true;
        
    } catch (const std::exception& e) {
        std::string error = "Installation error: " + std::string(e.what());
        std::cout << "[ERROR] " << error << std::endl;
        if (progress) progress(100, error);
        LogModpackInstallation(modpack, false, error);
        return false;
    }
}

bool PackManager::UninstallModpack(const std::string& modpackId) {
    std::string instancePath = GetModpackPath(modpackId);
    
    if (!FileUtils::Exists(instancePath)) {
        std::cout << "[WARNING] Modpack not found: " << modpackId << std::endl;
        return false;
    }
    
    std::cout << "[INFO] Uninstalling modpack: " << modpackId << std::endl;
    
    // Удаляем директорию
    if (!FileUtils::DeleteDirectory(instancePath)) {
        std::cout << "[ERROR] Failed to delete modpack directory: " << instancePath << std::endl;
        return false;
    }
    
    std::cout << "[INFO] Modpack uninstalled: " << modpackId << std::endl;
    return true;
}

bool PackManager::UpdateModpack(const std::string& modpackId) {
    // TODO: Реализовать обновление сборки
    std::cout << "[INFO] Update not implemented yet for: " << modpackId << std::endl;
    return false;
}

bool PackManager::ExtractModpackArchive(const std::string& archivePath,
                                       const std::string& destination,
                                       ProgressCallback progress) {
    std::cout << "[DEBUG] Extracting archive: " << archivePath << std::endl;
    
    // Проверяем наличие архива
    if (!FileUtils::Exists(archivePath)) {
        std::cout << "[ERROR] Archive not found: " << archivePath << std::endl;
        return false;
    }
    
    // Используем FileUtils для извлечения
    if (!FileUtils::ExtractZip(archivePath, destination)) {
        std::cout << "[ERROR] Failed to extract archive: " << archivePath << std::endl;
        return false;
    }
    
    // Проверяем структуру после извлечения
    std::cout << "[DEBUG] Checking extracted structure in: " << destination << std::endl;
    
    // Если есть вложенная папка с архивом, перемещаем содержимое на уровень выше
    auto files = FileUtils::ListFiles(destination);
    auto dirs = FileUtils::ListDirectories(destination);
    
    std::cout << "[DEBUG] Files in destination: " << files.size() << std::endl;
    std::cout << "[DEBUG] Directories in destination: " << dirs.size() << std::endl;
    
    // Проверяем наличие .minecraft или похожей структуры
    bool hasMinecraftDir = false;
    bool hasModsDir = false;
    
    for (const auto& dir : dirs) {
        std::cout << "[DEBUG] Found directory: " << dir << std::endl;
        if (dir == ".minecraft" || StringUtils::ToLower(dir).find("minecraft") != std::string::npos) {
            hasMinecraftDir = true;
            std::cout << "[DEBUG] Found Minecraft directory: " << dir << std::endl;
        }
        if (dir == "mods") {
            hasModsDir = true;
        }
    }
    
    // Если есть только одна папка и нет .minecraft, возможно это папка с модпаком
    if (dirs.size() == 1 && !hasMinecraftDir) {
        std::string subdir = destination + "/" + dirs[0];
        std::cout << "[INFO] Moving contents from subdirectory: " << subdir << std::endl;
        
        // Перемещаем содержимое подпапки на уровень выше
        auto subfiles = FileUtils::ListFiles(subdir);
        auto subdirs = FileUtils::ListDirectories(subdir);
        
        for (const auto& file : subfiles) {
            std::string source = subdir + "/" + file;
            std::string target = destination + "/" + file;
            FileUtils::MoveFile(source, target);
        }
        
        for (const auto& dir : subdirs) {
            std::string source = subdir + "/" + dir;
            std::string target = destination + "/" + dir;
            FileUtils::MoveFile(source, target);
        }
        
        // Удаляем пустую подпапку
        FileUtils::DeleteDirectory(subdir);
    }
    
    std::cout << "[INFO] Archive extracted successfully" << std::endl;
    return true;
}

bool PackManager::CreateModpackConfig(const ModpackInfo& modpack) {
    std::string configPath = GetModpackPath(modpack.id) + "/modpack.json";
    
    try {
        json config;
        config["id"] = modpack.id;
        config["name"] = modpack.name;
        config["description"] = modpack.description;
        config["minecraftVersion"] = modpack.minecraftVersion;
        config["modLoader"] = static_cast<int>(modpack.modLoader);
        config["modLoaderVersion"] = modpack.modLoaderVersion;
        config["iconUrl"] = modpack.iconUrl;
        config["archiveUrl"] = modpack.archiveUrl;
        config["installed"] = modpack.installed;
        config["installPath"] = modpack.installPath;
        config["installDate"] = std::to_string(std::time(nullptr));
        
        std::ofstream file(configPath);
        if (!file.is_open()) {
            std::cout << "[ERROR] Failed to open config file: " << configPath << std::endl;
            return false;
        }
        
        file << config.dump(2);
        file.close();
        
        std::cout << "[INFO] Created modpack config: " << configPath << std::endl;
        return true;
        
    } catch (const std::exception& e) {
        std::cout << "[ERROR] Failed to create modpack config: " << e.what() << std::endl;
        return false;
    }
}

bool PackManager::LoadModpackConfig(const std::string& modpackId, ModpackInfo& modpack) {
    std::string configPath = GetModpackPath(modpackId) + "/modpack.json";
    
    if (!FileUtils::Exists(configPath)) {
        return false;
    }
    
    try {
        std::ifstream file(configPath);
        if (!file.is_open()) {
            return false;
        }
        
        json config = json::parse(file);
        file.close();
        
        modpack.id = config.value("id", "");
        modpack.name = config.value("name", "");
        modpack.description = config.value("description", "");
        modpack.minecraftVersion = config.value("minecraftVersion", "");
        modpack.modLoader = static_cast<ModLoader>(config.value("modLoader", 0));
        modpack.modLoaderVersion = config.value("modLoaderVersion", "");
        modpack.iconUrl = config.value("iconUrl", "");
        modpack.archiveUrl = config.value("archiveUrl", "");
        modpack.installed = config.value("installed", false);
        modpack.installPath = config.value("installPath", "");
        
        return true;
        
    } catch (const std::exception& e) {
        std::cout << "[ERROR] Failed to load modpack config: " << e.what() << std::endl;
        return false;
    }
}

std::string PackManager::GetModpackPath(const std::string& modpackId) const {
    return basePath_ + "/instances/" + modpackId;
}

std::string PackManager::GetModsPath(const std::string& modpackId) const {
    std::string base = GetModpackPath(modpackId);
    
    // Проверяем разные возможные расположения модов
    std::vector<std::string> possiblePaths = {
        base + "/.minecraft/mods",
        base + "/minecraft/mods",
        base + "/mods",
        base + "/Mods"
    };
    
    for (const auto& path : possiblePaths) {
        if (FileUtils::Exists(path)) {
            return path;
        }
    }
    
    // Если не нашли, возвращаем стандартный путь
    return base + "/.minecraft/mods";
}

std::string PackManager::GetConfigPath(const std::string& modpackId) const {
    return GetModpackPath(modpackId) + "/.minecraft/config";
}

std::string PackManager::GetSavesPath(const std::string& modpackId) const {
    return GetModpackPath(modpackId) + "/.minecraft/saves";
}

std::string PackManager::GetResourcePacksPath(const std::string& modpackId) const {
    return GetModpackPath(modpackId) + "/.minecraft/resourcepacks";
}

std::string PackManager::GetShaderPacksPath(const std::string& modpackId) const {
    return GetModpackPath(modpackId) + "/.minecraft/shaderpacks";
}

void PackManager::LogModpackInstallation(const ModpackInfo& modpack, bool success,
                                        const std::string& error) {
    std::string logPath = basePath_ + "/install.log";
    std::ofstream logFile(logPath, std::ios_base::app);
    
    if (logFile.is_open()) {
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        
        logFile << "[" << std::ctime(&time) << "] ";
        logFile << (success ? "SUCCESS" : "FAILED") << " ";
        logFile << "Installation of " << modpack.name << " (" << modpack.id << ")";
        
        if (!error.empty()) {
            logFile << " - Error: " << error;
        }
        
        logFile << std::endl;
        logFile.close();
    }
}

} // namespace Aureate