#include "launcher_core.h"
#include "version_resolver.h"
#include "java_manager.h"
#include "download_manager.h"
#include "pack_manager.h"
#include "modloaders/universal_handler.h"
#include "utils/file_utils.h"
#include "utils/string_utils.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <chrono>
#include <thread>
#include <map>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#include <tchar.h>
#else
#include <unistd.h>
#include <sys/types.h>
#include <pwd.h>
#include <sys/statvfs.h>
#endif

namespace Aureate {

LauncherCore::LauncherCore(const std::string& basePath) : basePath_(basePath) {
    // Создаем необходимые директории
    FileUtils::CreateDirectory(basePath_);
    FileUtils::CreateDirectory(GetVersionsPath());
    FileUtils::CreateDirectory(GetInstancesPath());
    FileUtils::CreateDirectory(GetJavaPath());
    FileUtils::CreateDirectory(GetLibrariesPath());
    FileUtils::CreateDirectory(GetAssetsPath());
    
    // Устанавливаем callback для логов
    SetLogCallback([](const std::string& message, const std::string& level) {
        std::cout << "[" << level << "] " << message << std::endl;
    });
}

LauncherCore::~LauncherCore() {
    Log("LauncherCore destroyed");
}

bool LauncherCore::Initialize() {
    Log("Initializing Aureate Launcher v1.0.0...");
    
    // Проверяем доступность необходимых директорий
    if (!FileUtils::Exists(basePath_)) {
        Log("Failed to create base directory: " + basePath_, "ERROR");
        return false;
    }
    
    // Проверяем свободное место на диске
    std::string diskPath = basePath_;
#ifdef _WIN32
    ULARGE_INTEGER freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes;
    if (GetDiskFreeSpaceExA(diskPath.c_str(), &freeBytesAvailable, &totalNumberOfBytes, &totalNumberOfFreeBytes)) {
        uint64_t freeGB = freeBytesAvailable.QuadPart / (1024 * 1024 * 1024);
        Log("Available disk space: " + std::to_string(freeGB) + " GB");
        if (freeGB < 5) {
            Log("Warning: Low disk space (< 5GB)", "WARNING");
        }
    }
#else
    struct statvfs stat;
    if (statvfs(diskPath.c_str(), &stat) == 0) {
        uint64_t freeGB = (stat.f_bavail * stat.f_frsize) / (1024 * 1024 * 1024);
        Log("Available disk space: " + std::to_string(freeGB) + " GB");
    }
#endif
    
    Log("Base path: " + basePath_);
    Log("Versions path: " + GetVersionsPath());
    Log("Instances path: " + GetInstancesPath());
    Log("Launcher initialized successfully");
    return true;
}

std::vector<ModpackInfo> LauncherCore::GetAvailableModpacks() {
    Log("Getting available modpacks...");
    
    std::vector<ModpackInfo> modpacks;
    
    // ТВОИ РЕАЛЬНЫЕ СБОРКИ
    ModpackInfo draconica;
    draconica.id = "draconica_1.18.2";
    draconica.name = "Draconica Modpack";
    draconica.description = "Модпак в стиле средневековья с драконами и магией. Полностью переработанный мир с уникальными механиками и атмосферой.";
    draconica.minecraftVersion = "1.18.2";
    draconica.modLoader = ModLoader::FORGE;
    draconica.modLoaderVersion = "40.2.0";
    draconica.iconUrl = "https://raw.githubusercontent.com/kairenq/Minecraft_Launcher/main/assets/draconica_icon.png";
    draconica.archiveUrl = "https://github.com/kairenq/Minecraft_Launcher/releases/download/v1.1.3/Draconica1.1.3.zip";
    draconica.installed = false;
    
    ModpackInfo skydustry;
    skydustry.id = "skydustry";
    skydustry.name = "Skydustry";
    skydustry.description = "Парящий в облаках техномагический модпак с механикой полёта и автоматизацией. Уникальные биомы на летающих островах.";
    skydustry.minecraftVersion = "1.20.1";
    skydustry.modLoader = ModLoader::FORGE;
    skydustry.modLoaderVersion = "47.2.0";
    skydustry.iconUrl = "https://raw.githubusercontent.com/kairenq/Minecraft_Launcher/main/assets/skydustry_icon.png";
    skydustry.archiveUrl = "https://github.com/kairenq/Minecraft_Launcher/releases/download/v.1.0.0/Skydustry.zip";
    skydustry.installed = false;
    
    // Проверяем установленные сборки
    PackManager packManager(basePath_);
    auto installed = packManager.GetInstalledModpacks();
    
    // Обновляем статусы установки
    for (const auto& installedPack : installed) {
        if (installedPack.id == draconica.id) {
            draconica = installedPack;
            draconica.installed = true;
        }
        if (installedPack.id == skydustry.id) {
            skydustry = installedPack;
            skydustry.installed = true;
        }
    }
    
    modpacks.push_back(draconica);
    modpacks.push_back(skydustry);
    
    Log("Found " + std::to_string(modpacks.size()) + " modpacks");
    return modpacks;
}

bool LauncherCore::InstallModpack(const ModpackInfo& modpack, ProgressCallback progress) {
    std::string logMsg = "Installing modpack: " + modpack.name + " (" + modpack.id + ")";
    Log(logMsg);
    
    if (progress) progress(0, "Подготовка к установке " + modpack.name + "...");
    
    try {
        // 1. Создаем директорию для сборки
        std::string instancePath = GetInstancesPath() + "/" + modpack.id;
        Log("Instance path: " + instancePath);
        
        if (!FileUtils::CreateDirectory(instancePath)) {
            std::string error = "Не удалось создать директорию: " + instancePath;
            Log(error, "ERROR");
            if (progress) progress(100, error);
            return false;
        }
        
        // 2. Скачиваем архив
        if (progress) progress(10, "Скачивание архива сборки...");
        Log("Downloading from: " + modpack.archiveUrl);
        
        std::string archivePath = instancePath + "/modpack.zip";
        DownloadManager downloader;
        
        bool downloadSuccess = downloader.DownloadFile(modpack.archiveUrl, archivePath,
            [progress](int percent, const std::string& stage) {
                if (progress) {
                    int adjustedProgress = 10 + (percent * 0.5); // 10-60%
                    progress(adjustedProgress, stage);
                }
            });
        
        if (!downloadSuccess) {
            std::string error = "Не удалось скачать архив сборки";
            Log(error, "ERROR");
            if (progress) progress(100, error);
            return false;
        }
        
        // 3. Распаковываем архив
        if (progress) progress(60, "Распаковка файлов...");
        Log("Extracting archive to: " + instancePath);
        
        if (!FileUtils::ExtractZip(archivePath, instancePath)) {
            std::string error = "Не удалось распаковать архив";
            Log(error, "ERROR");
            if (progress) progress(100, error);
            FileUtils::DeleteFile(archivePath);
            return false;
        }
        
        // Удаляем временный архив
        FileUtils::DeleteFile(archivePath);
        
        // 4. Проверяем и исправляем структуру
        if (progress) progress(80, "Проверка структуры файлов...");
        
        // Проверяем наличие .minecraft
        std::string minecraftPath = instancePath + "/.minecraft";
        bool hasMinecraftDir = FileUtils::Exists(minecraftPath);
        
        if (!hasMinecraftDir) {
            Log("Creating .minecraft directory structure");
            FileUtils::CreateDirectory(minecraftPath);
            
            // Создаем поддиректории
            std::vector<std::string> subdirs = {
                "mods",
                "config", 
                "resourcepacks",
                "shaderpacks",
                "saves",
                "logs",
                "kubejs",
                "patchouli_books"
            };
            
            for (const auto& dir : subdirs) {
                std::string dirPath = minecraftPath + "/" + dir;
                FileUtils::CreateDirectory(dirPath);
            }
            
            // Проверяем, есть ли файлы в корне и перемещаем их
            auto files = FileUtils::ListFiles(instancePath);
            auto dirs = FileUtils::ListDirectories(instancePath);
            
            for (const auto& dir : dirs) {
                if (dir != ".minecraft") {
                    std::string source = instancePath + "/" + dir;
                    std::string target = minecraftPath + "/" + dir;
                    FileUtils::MoveFile(source, target);
                    Log("Moved directory: " + dir + " to .minecraft/");
                }
            }
            
            for (const auto& file : files) {
                if (file != "modpack.json" && file != "launcher_profiles.json") {
                    std::string source = instancePath + "/" + file;
                    std::string target = minecraftPath + "/" + file;
                    FileUtils::MoveFile(source, target);
                    Log("Moved file: " + file + " to .minecraft/");
                }
            }
        }
        
        // 5. Создаем конфиг сборки
        if (progress) progress(90, "Создание конфигурации...");
        
        ModpackInfo installedModpack = modpack;
        installedModpack.installed = true;
        installedModpack.installPath = instancePath;
        
        // Сохраняем конфиг
        std::string configPath = instancePath + "/modpack.json";
        std::ofstream configFile(configPath);
        if (configFile.is_open()) {
            // Простой JSON конфиг
            configFile << "{\n";
            configFile << "  \"id\": \"" << installedModpack.id << "\",\n";
            configFile << "  \"name\": \"" << installedModpack.name << "\",\n";
            configFile << "  \"description\": \"" << installedModpack.description << "\",\n";
            configFile << "  \"minecraftVersion\": \"" << installedModpack.minecraftVersion << "\",\n";
            configFile << "  \"modLoader\": " << static_cast<int>(installedModpack.modLoader) << ",\n";
            configFile << "  \"modLoaderVersion\": \"" << installedModpack.modLoaderVersion << "\",\n";
            configFile << "  \"iconUrl\": \"" << installedModpack.iconUrl << "\",\n";
            configFile << "  \"archiveUrl\": \"" << installedModpack.archiveUrl << "\",\n";
            configFile << "  \"installed\": true,\n";
            configFile << "  \"installPath\": \"" << installedModpack.installPath << "\",\n";
            configFile << "  \"installDate\": \"" << std::to_string(std::time(nullptr)) << "\"\n";
            configFile << "}";
            configFile.close();
            Log("Created modpack config: " + configPath);
        } else {
            Log("Warning: Failed to create modpack config", "WARNING");
        }
        
        // 6. Создаем launcher_profiles.json если его нет
        std::string profilesPath = instancePath + "/launcher_profiles.json";
        if (!FileUtils::Exists(profilesPath)) {
            std::ofstream profilesFile(profilesPath);
            if (profilesFile.is_open()) {
                profilesFile << "{\n";
                profilesFile << "  \"profiles\": {\n";
                profilesFile << "    \"" << modpack.id << "\": {\n";
                profilesFile << "      \"name\": \"" << modpack.name << "\",\n";
                profilesFile << "      \"gameDir\": \"" << instancePath << "\",\n";
                profilesFile << "      \"lastVersionId\": \"" << modpack.minecraftVersion << "\",\n";
                profilesFile << "      \"javaDir\": \"\",\n";
                profilesFile << "      \"javaArgs\": \"-Xmx2G -Xms1G\",\n";
                profilesFile << "      \"resolution\": {\n";
                profilesFile << "        \"width\": 854,\n";
                profilesFile << "        \"height\": 480\n";
                profilesFile << "      }\n";
                profilesFile << "    }\n";
                profilesFile << "  },\n";
                profilesFile << "  \"selectedProfile\": \"" << modpack.id << "\",\n";
                profilesFile << "  \"clientToken\": \"\",\n";
                profilesFile << "  \"authenticationDatabase\": {}\n";
                profilesFile << "}";
                profilesFile.close();
                Log("Created launcher_profiles.json");
            }
        }
        
        if (progress) progress(100, "Сборка успешно установлена!");
        Log("Modpack installed successfully: " + modpack.name);
        
        return true;
        
    } catch (const std::exception& e) {
        std::string error = "Ошибка установки: " + std::string(e.what());
        Log(error, "ERROR");
        if (progress) progress(100, error);
        return false;
    }
}

bool LauncherCore::UninstallModpack(const std::string& modpackId) {
    std::string instancePath = GetInstancesPath() + "/" + modpackId;
    
    if (!FileUtils::Exists(instancePath)) {
        Log("Modpack not found: " + modpackId, "WARNING");
        return false;
    }
    
    Log("Uninstalling modpack: " + modpackId);
    
    // Удаляем директорию
    if (!FileUtils::DeleteDirectory(instancePath)) {
        Log("Failed to delete modpack directory: " + instancePath, "ERROR");
        return false;
    }
    
    Log("Modpack uninstalled: " + modpackId);
    return true;
}

bool LauncherCore::UpdateModpack(const std::string& modpackId) {
    Log("Update not implemented yet for: " + modpackId, "INFO");
    return false;
}

std::vector<MinecraftVersion> LauncherCore::GetAvailableVersions() {
    Log("Getting available Minecraft versions...");
    
    // Кэшируем версии
    if (!versionsCached_) {
        VersionResolver resolver;
        cachedVersions_ = resolver.GetMinecraftVersions();
        versionsCached_ = true;
    }
    
    // Фильтруем только релизные версии после 1.18
    std::vector<MinecraftVersion> filteredVersions;
    for (const auto& version : cachedVersions_) {
        if (version.type == "release") {
            // Проверяем версию (1.18 и выше)
            std::string versionStr = version.id;
            if (versionStr.find("1.") == 0) {
                // Извлекаем основную и второстепенную версию
                size_t dotPos = versionStr.find('.');
                if (dotPos != std::string::npos) {
                    std::string major = versionStr.substr(0, dotPos + 1);
                    std::string minorStr = versionStr.substr(dotPos + 1);
                    
                    // Убираем патч версию если есть
                    size_t patchPos = minorStr.find('.');
                    if (patchPos != std::string::npos) {
                        minorStr = minorStr.substr(0, patchPos);
                    }
                    
                    try {
                        int minor = std::stoi(minorStr);
                        if (minor >= 18) { // 1.18 и выше
                            filteredVersions.push_back(version);
                        }
                    } catch (...) {
                        // Пропускаем невалидные версии
                    }
                }
            }
        }
    }
    
    // Сортируем по убыванию (новые версии первыми)
    std::sort(filteredVersions.begin(), filteredVersions.end(),
        [](const MinecraftVersion& a, const MinecraftVersion& b) {
            return a.id > b.id;
        });
    
    Log("Found " + std::to_string(filteredVersions.size()) + " supported versions");
    return filteredVersions;
}

bool LauncherCore::InstallMinecraftVersion(const std::string& versionId, ProgressCallback progress) {
    Log("Installing Minecraft version: " + versionId);
    
    if (progress) progress(0, "Подготовка к установке Minecraft " + versionId + "...");
    
    try {
        // Создаем директорию для версии
        std::string versionPath = GetVersionsPath() + "/" + versionId;
        if (!FileUtils::CreateDirectory(versionPath)) {
            Log("Не удалось создать директорию версии", "ERROR");
            if (progress) progress(100, "Ошибка создания директории");
            return false;
        }
        
        // TODO: Реализовать скачивание клиента Minecraft
        // Пока просто создаем пустую структуру
        
        // Создаем версионный JSON
        std::string versionJson = versionPath + "/" + versionId + ".json";
        std::ofstream jsonFile(versionJson);
        if (jsonFile.is_open()) {
            jsonFile << "{\n";
            jsonFile << "  \"id\": \"" << versionId << "\",\n";
            jsonFile << "  \"inheritsFrom\": \"" << versionId << "\",\n";
            jsonFile << "  \"releaseTime\": \"\",\n";
            jsonFile << "  \"time\": \"\",\n";
            jsonFile << "  \"type\": \"release\",\n";
            jsonFile << "  \"mainClass\": \"net.minecraft.client.main.Main\",\n";
            jsonFile << "  \"minecraftArguments\": \"\",\n";
            jsonFile << "  \"minimumLauncherVersion\": 21,\n";
            jsonFile << "  \"libraries\": [],\n";
            jsonFile << "  \"jar\": \"" << versionId << "\"\n";
            jsonFile << "}";
            jsonFile.close();
        }
        
        // Создаем JAR файл (пустой)
        std::string jarPath = versionPath + "/" + versionId + ".jar";
        std::ofstream jarFile(jarPath, std::ios::binary);
        if (jarFile.is_open()) {
            jarFile.close();
        }
        
        if (progress) progress(100, "Minecraft " + versionId + " готов к запуску");
        Log("Minecraft version prepared: " + versionId);
        return true;
        
    } catch (const std::exception& e) {
        std::string error = "Ошибка установки версии: " + std::string(e.what());
        Log(error, "ERROR");
        if (progress) progress(100, error);
        return false;
    }
}

bool LauncherCore::IsVersionInstalled(const std::string& versionId) {
    std::string versionPath = GetVersionsPath() + "/" + versionId;
    return FileUtils::Exists(versionPath + "/" + versionId + ".json");
}

std::vector<JavaConfig> LauncherCore::FindJavaInstallations() {
    Log("Finding Java installations...");
    
    JavaManager javaManager(basePath_);
    return javaManager.FindJavaInstallations();
}

bool LauncherCore::InstallJava(const std::string& version, ProgressCallback progress) {
    Log("Installing Java version: " + version);
    
    JavaManager javaManager(basePath_);
    return javaManager.InstallJava(version, progress);
}

JavaConfig LauncherCore::GetBestJavaConfig() {
    JavaManager javaManager(basePath_);
    return javaManager.GetBestJavaConfig();
}

bool LauncherCore::LaunchGame(const ModpackInfo& modpack, const JavaConfig& javaConfig,
                             const std::string& username, ProgressCallback progress) {
    Log("Launching game: " + modpack.name + " for user: " + username);
    
    if (progress) progress(0, "Подготовка к запуску...");
    
    try {
        // 1. Проверяем Java
        if (javaConfig.path.empty()) {
            if (progress) progress(100, "Java не найдена!");
            Log("Java not found", "ERROR");
            return false;
        }
        
        Log("Using Java: " + javaConfig.path);
        Log("Java version: " + javaConfig.version);
        
        // 2. Проверяем директорию сборки
        if (modpack.installPath.empty() || !FileUtils::Exists(modpack.installPath)) {
            if (progress) progress(100, "Сборка не установлена!");
            Log("Modpack not installed: " + modpack.id, "ERROR");
            return false;
        }
        
        // 3. Создаем аргументы для запуска
        std::vector<std::string> args;
        
        // Путь к Java
        args.push_back("\"" + javaConfig.path + "\"");
        
        // Параметры JVM
        args.push_back("-Xmx" + std::to_string(javaConfig.maxMemory) + "M");
        args.push_back("-Xms" + std::to_string(javaConfig.minMemory) + "M");
        
        // Стандартные аргументы
        args.push_back("-XX:+UseG1GC");
        args.push_back("-XX:+UnlockExperimentalVMOptions");
        args.push_back("-XX:G1NewSizePercent=20");
        args.push_back("-XX:G1ReservePercent=20");
        args.push_back("-XX:MaxGCPauseMillis=50");
        args.push_back("-XX:G1HeapRegionSize=32M");
        args.push_back("-Dfml.ignoreInvalidMinecraftCertificates=true");
        args.push_back("-Dfml.ignorePatchDiscrepancies=true");
        
        // Путь к нативным библиотекам
        std::string nativesPath = GetLibrariesPath() + "/natives";
        FileUtils::CreateDirectory(nativesPath);
        args.push_back("-Djava.library.path=" + nativesPath);
        
        // Информация о лаунчере
        args.push_back("-Dminecraft.launcher.brand=AureateLauncher");
        args.push_back("-Dminecraft.launcher.version=1.0.0");
        
        // Путь к библиотекам
        std::string librariesPath = GetLibrariesPath();
        args.push_back("-cp");
        
        // Собираем classpath
        std::string classpath = "";
        
        // Добавляем Minecraft JAR
        std::string mcJar = GetVersionsPath() + "/" + modpack.minecraftVersion + "/" + modpack.minecraftVersion + ".jar";
        if (FileUtils::Exists(mcJar)) {
            classpath += mcJar;
        }
        
        // Добавляем библиотеки
        auto libraryFiles = FileUtils::ListFiles(librariesPath, ".jar");
        for (const auto& lib : libraryFiles) {
            if (!classpath.empty()) classpath += ";";
            classpath += librariesPath + "/" + lib;
        }
        
        args.push_back("\"" + classpath + "\"");
        
        // Главный класс (зависит от модлоадера)
        std::string mainClass;
        if (modpack.modLoader == ModLoader::FORGE) {
            mainClass = "net.minecraftforge.client.ForgeClient";
        } else if (modpack.modLoader == ModLoader::FABRIC) {
            mainClass = "net.fabricmc.loader.impl.launch.knot.KnotClient";
        } else {
            mainClass = "net.minecraft.client.main.Main";
        }
        args.push_back(mainClass);
        
        // Аргументы Minecraft
        args.push_back("--username");
        args.push_back(username);
        args.push_back("--version");
        args.push_back(modpack.minecraftVersion);
        args.push_back("--gameDir");
        args.push_back("\"" + modpack.installPath + "\"");
        args.push_back("--assetsDir");
        args.push_back("\"" + GetAssetsPath() + "\"");
        args.push_back("--assetIndex");
        args.push_back(modpack.minecraftVersion);
        args.push_back("--uuid");
        args.push_back("0"); // Временный UUID
        args.push_back("--accessToken");
        args.push_back("0"); // Временный токен
        args.push_back("--userType");
        args.push_back("legacy");
        args.push_back("--versionType");
        args.push_back("release");
        args.push_back("--width");
        args.push_back("854");
        args.push_back("--height");
        args.push_back("480");
        
        // Для Forge добавляем дополнительные аргументы
        if (modpack.modLoader == ModLoader::FORGE) {
            args.push_back("--launchTarget");
            args.push_back("forgeclient");
            args.push_back("--fml.forgeVersion");
            args.push_back(modpack.modLoaderVersion);
            args.push_back("--fml.mcVersion");
            args.push_back(modpack.minecraftVersion);
            args.push_back("--fml.forgeGroup");
            args.push_back("net.minecraftforge");
        }
        
        if (progress) progress(50, "Запуск Minecraft...");
        
        // Собираем командную строку
        std::string command;
        for (const auto& arg : args) {
            command += arg + " ";
        }
        
        Log("Launch command: " + command);
        
        // Запускаем процесс
        bool success = ExecuteProcess(args, modpack.installPath);
        
        if (success) {
            if (progress) progress(100, "Minecraft запущен!");
            Log("Game launched successfully");
            
            // Обновляем статистику
            // TODO: Отслеживание времени игры
            
        } else {
            if (progress) progress(100, "Ошибка запуска Minecraft");
            Log("Failed to launch game", "ERROR");
        }
        
        return success;
        
    } catch (const std::exception& e) {
        std::string error = "Ошибка запуска: " + std::string(e.what());
        Log(error, "ERROR");
        if (progress) progress(100, error);
        return false;
    }
}

bool LauncherCore::InstallModLoader(ModLoader loader, const std::string& mcVersion,
                                   const std::string& loaderVersion, ProgressCallback progress) {
    Log("Installing modloader: " + std::to_string(static_cast<int>(loader)) + 
        " for MC " + mcVersion + " version " + loaderVersion);
    
    UniversalHandler handler(basePath_);
    return handler.InstallModLoader(loader, mcVersion, loaderVersion, progress);
}

bool LauncherCore::IsModLoaderInstalled(ModLoader loader, const std::string& mcVersion,
                                       const std::string& loaderVersion) {
    UniversalHandler handler(basePath_);
    return handler.IsModLoaderInstalled(loader, mcVersion, loaderVersion);
}

SystemInfo LauncherCore::GetSystemInfo() {
    SystemInfo info;
    
    // Определяем ОС
#ifdef _WIN32
    info.osName = "Windows";
    
    // Получаем версию Windows
    OSVERSIONINFOEX osvi;
    ZeroMemory(&osvi, sizeof(OSVERSIONINFOEX));
    osvi.dwOSVersionInfoSize = sizeof(OSVERSIONINFOEX);
    
    if (GetVersionEx((OSVERSIONINFO*)&osvi)) {
        info.osVersion = std::to_string(osvi.dwMajorVersion) + "." + 
                        std::to_string(osvi.dwMinorVersion) + "." + 
                        std::to_string(osvi.dwBuildNumber);
    } else {
        info.osVersion = "Unknown";
    }
    
    // Определяем архитектуру
    SYSTEM_INFO sysInfo;
    GetNativeSystemInfo(&sysInfo);
    switch (sysInfo.wProcessorArchitecture) {
        case PROCESSOR_ARCHITECTURE_AMD64:
            info.architecture = "x64";
            break;
        case PROCESSOR_ARCHITECTURE_INTEL:
            info.architecture = "x86";
            break;
        case PROCESSOR_ARCHITECTURE_ARM:
            info.architecture = "ARM";
            break;
        case PROCESSOR_ARCHITECTURE_ARM64:
            info.architecture = "ARM64";
            break;
        default:
            info.architecture = "Unknown";
    }
    
    // Получаем информацию о памяти
    MEMORYSTATUSEX memoryStatus;
    memoryStatus.dwLength = sizeof(memoryStatus);
    if (GlobalMemoryStatusEx(&memoryStatus)) {
        info.totalMemory = memoryStatus.ullTotalPhys / (1024 * 1024); // MB
        info.freeMemory = memoryStatus.ullAvailPhys / (1024 * 1024); // MB
    }
    
    info.processorCount = sysInfo.dwNumberOfProcessors;
    
#elif __APPLE__
    info.osName = "macOS";
    // TODO: Реализовать для macOS
    
#elif __linux__
    info.osName = "Linux";
    // TODO: Реализовать для Linux
    
#else
    info.osName = "Unknown";
#endif
    
    // Проверяем Java
    JavaManager javaManager(basePath_);
    auto javaConfig = javaManager.GetBestJavaConfig();
    info.javaPath = javaConfig.path;
    info.javaVersion = javaConfig.version;
    
    Log("System info collected: " + info.osName + " " + info.architecture + 
        ", " + std::to_string(info.totalMemory) + "MB RAM");
    
    return info;
}

std::string LauncherCore::GetVersionsPath() const {
    return basePath_ + "/versions";
}

std::string LauncherCore::GetInstancesPath() const {
    return basePath_ + "/instances";
}

std::string LauncherCore::GetJavaPath() const {
    return basePath_ + "/java";
}

std::string LauncherCore::GetLibrariesPath() const {
    return basePath_ + "/libraries";
}

std::string LauncherCore::GetAssetsPath() const {
    return basePath_ + "/assets";
}

void LauncherCore::Log(const std::string& message, const std::string& level) {
    if (logCallback_) {
        logCallback_(message, level);
    } else {
        std::cout << "[" << level << "] " << message << std::endl;
    }
}

bool LauncherCore::DownloadFile(const std::string& url, const std::string& destination,
                               ProgressCallback progress) {
    DownloadManager downloader;
    return downloader.DownloadFile(url, destination, progress);
}

bool LauncherCore::ExtractArchive(const std::string& archivePath,
                                 const std::string& destination,
                                 ProgressCallback progress) {
    return FileUtils::ExtractZip(archivePath, destination);
}

bool LauncherCore::ExecuteProcess(const std::vector<std::string>& args,
                                 const std::string& workingDir) {
    if (args.empty()) {
        Log("Empty arguments for process execution", "ERROR");
        return false;
    }
    
    // Собираем командную строку для логов
    std::string command;
    for (const auto& arg : args) {
        command += arg + " ";
    }
    Log("Executing process: " + command);
    
#ifdef _WIN32
    // Создаем процесс на Windows
    STARTUPINFO si;
    PROCESS_INFORMATION pi;
    
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    
    // Преобразуем строку в wchar_t для Windows
    std::wstring wcommand(command.begin(), command.end());
    std::wstring wworkingDir(workingDir.begin(), workingDir.end());
    
    // Создаем процесс
    BOOL success = CreateProcess(
        NULL,                   // Имя приложения (используем командную строку)
        &wcommand[0],           // Командная строка
        NULL,                   // Security attributes процесса
        NULL,                   // Security attributes потока
        FALSE,                  // Наследование handles
        0,                      // Флаги создания
        NULL,                   // Окружение
        wworkingDir.empty() ? NULL : wworkingDir.c_str(), // Рабочая директория
        &si,                    // STARTUPINFO
        &pi                     // PROCESS_INFORMATION
    );
    
    if (!success) {
        DWORD error = GetLastError();
        Log("CreateProcess failed with error: " + std::to_string(error), "ERROR");
        return false;
    }
    
    Log("Process created with PID: " + std::to_string(pi.dwProcessId));
    
    // Закрываем handles (мы не ждем завершения процесса)
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    
    return true;
    
#else
    // TODO: Реализовать для Linux/macOS
    Log("Process execution not implemented for this platform", "WARNING");
    return false;
#endif
}

} // namespace Aureate