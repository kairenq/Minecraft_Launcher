#include "launcher_core.h"
#include "version_resolver.h"
#include "java_manager.h"
#include <iostream>
#include <fstream>
#include <filesystem>
#include <cstdlib>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <tlhelp32.h>
#else
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#endif

namespace MinecraftCore {

namespace fs = std::filesystem;

LauncherCore::LauncherCore(const std::string& launcherDir)
    : launcherDir_(launcherDir)
    , versionsDir_(launcherDir + "/versions")
    , librariesDir_(launcherDir + "/libraries")
    , assetsDir_(launcherDir + "/assets")
    , forgeHandler_(nullptr)
    , fabricHandler_(nullptr)
    , universalHandler_(nullptr) {
    
    // Создаем необходимые директории
    fs::create_directories(versionsDir_);
    fs::create_directories(librariesDir_);
    fs::create_directories(assetsDir_);
    
    Log("LauncherCore initialized with directory: " + launcherDir_);
}

LauncherCore::~LauncherCore() {
    // Cleanup handlers
}

void LauncherCore::Log(const std::string& message) {
    std::cout << "[LauncherCore] " << message << std::endl;
    if (logCallback_) {
        logCallback_(message);
    }
}

void LauncherCore::Progress(int percent, const std::string& message) {
    if (progressCallback_) {
        progressCallback_(percent, message);
    }
}

bool LauncherCore::CheckFileExists(const std::string& path) {
    return fs::exists(path);
}

bool LauncherCore::EnsureDirectory(const std::string& path) {
    return fs::create_directories(path);
}

ProcessResult LauncherCore::Launch(const LaunchOptions& options) {
    ProcessResult result;
    
    try {
        Log("Starting launch process for version: " + options.versionId);
        Progress(10, "Preparing to launch...");
        
        // 1. Проверяем существование версии
        VersionResolver resolver(versionsDir_);
        if (!resolver.VersionExists(options.versionId)) {
            result.message = "Version not found: " + options.versionId;
            result.success = false;
            return result;
        }
        
        Progress(20, "Validating installation...");
        
        // 2. Валидируем установку
        if (!ValidateInstallation(options.versionId)) {
            result.message = "Installation validation failed for " + options.versionId;
            result.success = false;
            return result;
        }
        
        Progress(30, "Preparing Java...");
        
        // 3. Определяем Java
        JavaManager javaManager;
        std::string javaPath = options.javaPath;
        
        if (javaPath.empty()) {
            VersionInfo versionInfo = resolver.GetVersionInfo(options.versionId);
            JavaVersion suitableJava = javaManager.FindSuitableJava(versionInfo.minecraftVersion);
            
            if (suitableJava.path.empty()) {
                result.message = "No suitable Java found for " + versionInfo.minecraftVersion;
                result.success = false;
                return result;
            }
            
            javaPath = suitableJava.path;
            Log("Using auto-detected Java: " + javaPath + " (version " + std::to_string(suitableJava.version) + ")");
        }
        
        // 4. Проверяем Java
        if (!javaManager.ValidateJavaPath(javaPath)) {
            result.message = "Invalid Java path: " + javaPath;
            result.success = false;
            return result;
        }
        
        Progress(50, "Building launch arguments...");
        
        // 5. Создаем команду запуска (упрощенная версия)
        std::string command = "\"" + javaPath + "\"";
        command += " -Xmx" + std::to_string(options.memory) + "M";
        command += " -Xms" + std::to_string(options.memory / 2) + "M";
        
        // 6. Добавляем JAR файл
        std::string versionJar = versionsDir_ + "/" + options.versionId + "/" + options.versionId + ".jar";
        if (!CheckFileExists(versionJar)) {
            result.message = "Version JAR not found: " + versionJar;
            result.success = false;
            return result;
        }
        
        command += " -jar \"" + versionJar + "\"";
        
        // 7. Добавляем аргументы игры
        command += " --username \"" + options.username + "\"";
        command += " --version \"" + options.versionId + "\"";
        
        if (!options.gameDir.empty()) {
            EnsureDirectory(options.gameDir);
            command += " --gameDir \"" + options.gameDir + "\"";
        }
        
        if (options.demo) {
            command += " --demo";
        }
        
        if (!options.serverIp.empty()) {
            command += " --server " + options.serverIp;
            if (options.serverPort != 25565) {
                command += " --port " + std::to_string(options.serverPort);
            }
        }
        
        command += " --width " + std::to_string(options.width);
        command += " --height " + std::to_string(options.height);
        
        Log("Launch command: " + command);
        Progress(80, "Starting Minecraft...");
        
        // 8. Запускаем процесс
        #ifdef _WIN32
            STARTUPINFOA si;
            PROCESS_INFORMATION pi;
            
            ZeroMemory(&si, sizeof(si));
            si.cb = sizeof(si);
            ZeroMemory(&pi, sizeof(pi));
            
            char cmd[4096];
            strcpy_s(cmd, command.c_str());
            
            if (CreateProcessA(
                NULL,           // No module name (use command line)
                cmd,            // Command line
                NULL,           // Process handle not inheritable
                NULL,           // Thread handle not inheritable
                FALSE,          // Set handle inheritance to FALSE
                0,              // No creation flags
                NULL,           // Use parent's environment block
                options.gameDir.empty() ? NULL : options.gameDir.c_str(), // Starting directory
                &si,            // Pointer to STARTUPINFO structure
                &pi             // Pointer to PROCESS_INFORMATION structure
            )) {
                result.pid = pi.dwProcessId;
                result.success = true;
                result.message = "Minecraft launched successfully with PID: " + std::to_string(result.pid);
                
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
            } else {
                result.success = false;
                result.message = "Failed to create process. Error code: " + std::to_string(GetLastError());
            }
        #else
            // Linux/macOS implementation
            pid_t pid = fork();
            
            if (pid == 0) {
                // Child process
                std::vector<char*> args;
                std::string token;
                std::istringstream tokenStream(command);
                
                while (std::getline(tokenStream, token, ' ')) {
                    char* arg = new char[token.length() + 1];
                    std::strcpy(arg, token.c_str());
                    args.push_back(arg);
                }
                args.push_back(nullptr);
                
                if (!options.gameDir.empty()) {
                    chdir(options.gameDir.c_str());
                }
                
                execvp(args[0], args.data());
                
                // If execvp returns, there was an error
                std::cerr << "Failed to execute command" << std::endl;
                exit(1);
            } else if (pid > 0) {
                // Parent process
                result.pid = pid;
                result.success = true;
                result.message = "Minecraft launched successfully with PID: " + std::to_string(result.pid);
            } else {
                result.success = false;
                result.message = "Failed to fork process";
            }
        #endif
        
        Progress(100, "Launch completed");
        Log(result.message);
        
    } catch (const std::exception& e) {
        result.success = false;
        result.message = std::string("Launch error: ") + e.what();
        Log("Error during launch: " + result.message);
    }
    
    return result;
}

std::vector<VersionInfo> LauncherCore::GetInstalledVersions() {
    std::vector<VersionInfo> versions;
    
    try {
        VersionResolver resolver(versionsDir_);
        versions = resolver.FindInstalledVersions();
        
        Log("Found " + std::to_string(versions.size()) + " installed versions");
        
    } catch (const std::exception& e) {
        Log("Error getting installed versions: " + std::string(e.what()));
    }
    
    return versions;
}

bool LauncherCore::InstallVersion(const std::string& versionId, const std::string& modLoader) {
    Log("Installing version: " + versionId + " with modloader: " + modLoader);
    Progress(0, "Starting installation...");
    
    // TODO: Implement version installation logic
    // This will handle downloading and setting up Minecraft versions
    
    Progress(100, "Installation completed");
    return true; // Placeholder
}

bool LauncherCore::ValidateInstallation(const std::string& versionId) {
    try {
        std::string versionPath = versionsDir_ + "/" + versionId;
        std::string versionJson = versionPath + "/" + versionId + ".json";
        std::string versionJar = versionPath + "/" + versionId + ".jar";
        
        if (!CheckFileExists(versionPath)) {
            Log("Version directory not found: " + versionPath);
            return false;
        }
        
        if (!CheckFileExists(versionJson)) {
            Log("Version JSON not found: " + versionJson);
            return false;
        }
        
        if (!CheckFileExists(versionJar)) {
            Log("Version JAR not found: " + versionJar);
            return false;
        }
        
        // Check file sizes (basic validation)
        size_t jarSize = fs::file_size(versionJar);
        if (jarSize < 1024) { // Less than 1KB
            Log("Version JAR is too small: " + std::to_string(jarSize) + " bytes");
            return false;
        }
        
        Log("Installation validation passed for: " + versionId);
        return true;
        
    } catch (const std::exception& e) {
        Log("Validation error for " + versionId + ": " + e.what());
        return false;
    }
}

std::vector<std::string> LauncherCore::GetMissingFiles(const std::string& versionId) {
    std::vector<std::string> missingFiles;
    
    try {
        std::string versionPath = versionsDir_ + "/" + versionId;
        std::string versionJson = versionPath + "/" + versionId + ".json";
        
        if (!CheckFileExists(versionJson)) {
            missingFiles.push_back(versionJson);
            return missingFiles;
        }
        
        // TODO: Parse JSON and check for required libraries
        // For now, just check basic files
        
        std::vector<std::string> requiredFiles = {
            versionPath + "/" + versionId + ".jar",
            versionPath + "/" + versionId + ".json"
        };
        
        for (const auto& file : requiredFiles) {
            if (!CheckFileExists(file)) {
                missingFiles.push_back(file);
            }
        }
        
    } catch (const std::exception& e) {
        Log("Error checking missing files: " + std::string(e.what()));
    }
    
    return missingFiles;
}

} // namespace MinecraftCore
