#include "java_manager.h"
#include <iostream>
#include <fstream>
#include <filesystem>
#include <sstream>
#include <algorithm>
#include <cstdlib>

#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#include <tchar.h>
#include <strsafe.h>
#pragma comment(lib, "shell32.lib")
#else
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>
#include <pwd.h>
#endif

namespace MinecraftCore {

namespace fs = std::filesystem;

JavaManager::JavaManager() {
    ScanSystemForJava();
}

std::vector<JavaVersion> JavaManager::FindAllJavaVersions() {
    return installedJava_;
}

JavaVersion JavaManager::FindSuitableJava(const std::string& minecraftVersion) {
    int requiredVersion = 8; // Default
    
    // Determine required Java version based on Minecraft version
    if (minecraftVersion.find("1.18") == 0 || 
        minecraftVersion.find("1.19") == 0 ||
        minecraftVersion.find("1.20") == 0) {
        requiredVersion = 17;
    } else if (minecraftVersion.find("1.17") == 0) {
        requiredVersion = 16;
    } else if (minecraftVersion.find("1.12") == 0 ||
               minecraftVersion.find("1.13") == 0 ||
               minecraftVersion.find("1.14") == 0 ||
               minecraftVersion.find("1.15") == 0 ||
               minecraftVersion.find("1.16") == 0) {
        requiredVersion = 8;
    }
    
    std::cout << "[JavaManager] Looking for Java " << requiredVersion << "+ for Minecraft " << minecraftVersion << std::endl;
    
    // Find the best matching Java version
    JavaVersion bestMatch;
    for (const auto& java : installedJava_) {
        if (java.version >= requiredVersion) {
            if (bestMatch.path.empty() || java.version < bestMatch.version) {
                bestMatch = java; // Prefer lower version that still meets requirements
            }
        }
    }
    
    if (!bestMatch.path.empty()) {
        std::cout << "[JavaManager] Selected Java: " << bestMatch.path 
                  << " (version " << bestMatch.version << ")" << std::endl;
    } else {
        std::cout << "[JavaManager] No suitable Java found for version " << requiredVersion << "+" << std::endl;
    }
    
    return bestMatch;
}

JavaVersion JavaManager::FindJavaByVersion(int minVersion, int maxVersion) {
    JavaVersion bestMatch;
    
    for (const auto& java : installedJava_) {
        if (java.version >= minVersion && (maxVersion == 0 || java.version <= maxVersion)) {
            if (bestMatch.path.empty() || java.version < bestMatch.version) {
                bestMatch = java;
            }
        }
    }
    
    return bestMatch;
}

bool JavaManager::ValidateJavaPath(const std::string& javaPath) {
    if (javaPath.empty() || !fs::exists(javaPath)) {
        return false;
    }
    
    try {
        JavaVersion info = GetJavaInfo(javaPath);
        return info.version > 0;
    } catch (...) {
        return false;
    }
}

JavaVersion JavaManager::GetJavaInfo(const std::string& javaPath) {
    return CheckJavaInstallation(javaPath);
}

std::string JavaManager::AutoDetectJavaPath(const std::string& minecraftVersion) {
    JavaVersion suitableJava = FindSuitableJava(minecraftVersion);
    return suitableJava.path;
}

bool JavaManager::DownloadJava(int version, const std::string& installDir) {
    std::cout << "[JavaManager] Java download not implemented yet. Version: " 
              << version << ", Directory: " << installDir << std::endl;
    return false;
}

void JavaManager::ScanSystemForJava() {
    installedJava_.clear();
    
    std::vector<std::string> searchPaths = GetJavaSearchPaths();
    
    for (const auto& path : searchPaths) {
        if (fs::exists(path)) {
            try {
                JavaVersion javaInfo = CheckJavaInstallation(path);
                if (javaInfo.version > 0) {
                    installedJava_.push_back(javaInfo);
                    std::cout << "[JavaManager] Found Java: " << path 
                              << " (version " << javaInfo.version << ")" << std::endl;
                }
            } catch (const std::exception& e) {
                // Silently skip invalid Java installations
            }
        }
    }
    
    // Sort by version (highest first)
    std::sort(installedJava_.begin(), installedJava_.end(),
        [](const JavaVersion& a, const JavaVersion& b) {
            return a.version > b.version;
        });
    
    std::cout << "[JavaManager] Total Java installations found: " << installedJava_.size() << std::endl;
}

std::vector<std::string> JavaManager::GetJavaSearchPaths() {
    std::vector<std::string> paths;
    
    #ifdef _WIN32
        // Common Java paths on Windows
        char programFiles[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROGRAM_FILES, NULL, 0, programFiles))) {
            std::string pf(programFiles);
            
            // Check for various Java installations
            std::vector<std::string> javaDirs = {
                pf + "\\Java",
                pf + "\\AdoptOpenJDK",
                pf + "\\Eclipse Foundation",
                pf + "\\Amazon Corretto",
                pf + "\\Microsoft",
                pf + "\\BellSoft",
                "C:\\Program Files (x86)\\Java",
                "C:\\Java",
                "C:\\jdk",
                "C:\\jre"
            };
            
            for (const auto& dir : javaDirs) {
                if (fs::exists(dir)) {
                    // Look for java.exe in bin directories
                    for (const auto& entry : fs::recursive_directory_iterator(dir)) {
                        if (entry.path().filename() == "java.exe") {
                            paths.push_back(entry.path().string());
                        }
                    }
                }
            }
        }
        
        // Check JAVA_HOME environment variable
        char* javaHome = nullptr;
        size_t len = 0;
        _dupenv_s(&javaHome, &len, "JAVA_HOME");
        if (javaHome != nullptr) {
            std::string javaHomePath(javaHome);
            free(javaHome);
            
            std::string javaExe = javaHomePath + "\\bin\\java.exe";
            if (fs::exists(javaExe)) {
                paths.push_back(javaExe);
            }
        }
        
        // Check PATH for java.exe
        char* pathEnv = nullptr;
        _dupenv_s(&pathEnv, &len, "PATH");
        if (pathEnv != nullptr) {
            std::string pathStr(pathEnv);
            free(pathEnv);
            
            std::istringstream iss(pathStr);
            std::string pathItem;
            while (std::getline(iss, pathItem, ';')) {
                std::string javaExe = pathItem + "\\java.exe";
                if (fs::exists(javaExe)) {
                    paths.push_back(javaExe);
                }
            }
        }
        
    #else
        // Unix-like systems (Linux/macOS)
        
        // Check JAVA_HOME
        const char* javaHome = std::getenv("JAVA_HOME");
        if (javaHome != nullptr) {
            std::string javaPath = std::string(javaHome) + "/bin/java";
            if (fs::exists(javaPath)) {
                paths.push_back(javaPath);
            }
        }
        
        // Common installation directories
        std::vector<std::string> commonPaths = {
            "/usr/bin/java",
            "/usr/local/bin/java",
            "/opt/java/bin/java",
            "/usr/lib/jvm/default/bin/java",
            "/usr/lib/jvm/default-java/bin/java"
        };
        
        #ifdef __APPLE__
            // macOS specific paths
            commonPaths.insert(commonPaths.end(), {
                "/Library/Java/JavaVirtualMachines",
                "/System/Library/Java/JavaVirtualMachines",
                "/usr/local/opt/openjdk/bin/java"
            });
        #else
            // Linux specific paths
            commonPaths.insert(commonPaths.end(), {
                "/usr/lib/jvm",
                "/usr/local/java",
                "/opt/jdk",
                "/opt/jre"
            });
        #endif
        
        for (const auto& path : commonPaths) {
            if (fs::exists(path)) {
                paths.push_back(path);
            }
        }
        
        // Check PATH
        const char* pathEnv = std::getenv("PATH");
        if (pathEnv != nullptr) {
            std::string pathStr(pathEnv);
            std::istringstream iss(pathStr);
            std::string pathItem;
            while (std::getline(iss, pathItem, ':')) {
                std::string javaPath = pathItem + "/java";
                if (fs::exists(javaPath)) {
                    paths.push_back(javaPath);
                }
            }
        }
    #endif
    
    // Remove duplicates
    std::sort(paths.begin(), paths.end());
    paths.erase(std::unique(paths.begin(), paths.end()), paths.end());
    
    return paths;
}

JavaVersion JavaManager::CheckJavaInstallation(const std::string& javaPath) {
    JavaVersion info;
    info.path = javaPath;
    
    std::string versionOutput = GetJavaVersionOutput(javaPath);
    if (versionOutput.empty()) {
        return info; // Invalid Java
    }
    
    info.version = ParseJavaVersion(versionOutput);
    info.vendor = ParseJavaVendor(versionOutput);
    info.is64bit = Check64Bit(javaPath);
    
    // Determine type
    if (versionOutput.find("OpenJDK") != std::string::npos) {
        info.type = "openjdk";
    } else if (versionOutput.find("Java(TM)") != std::string::npos) {
        info.type = "oracle";
    } else if (versionOutput.find("GraalVM") != std::string::npos) {
        info.type = "graalvm";
    } else {
        info.type = "unknown";
    }
    
    // Determine architecture
    #ifdef _WIN32
        info.architecture = info.is64bit ? "x64" : "x86";
    #else
        info.architecture = info.is64bit ? "64-bit" : "32-bit";
    #endif
    
    return info;
}

std::string JavaManager::GetJavaVersionOutput(const std::string& javaPath) {
    #ifdef _WIN32
        std::string command = "\"" + javaPath + "\" -version 2>&1";
        
        FILE* pipe = _popen(command.c_str(), "r");
        if (!pipe) {
            return "";
        }
        
        char buffer[128];
        std::string result = "";
        while (fgets(buffer, sizeof(buffer), pipe) != NULL) {
            result += buffer;
        }
        
        _pclose(pipe);
        return result;
        
    #else
        std::string command = javaPath + " -version 2>&1";
        
        FILE* pipe = popen(command.c_str(), "r");
        if (!pipe) {
            return "";
        }
        
        char buffer[128];
        std::string result = "";
        while (fgets(buffer, sizeof(buffer), pipe) != NULL) {
            result += buffer;
        }
        
        pclose(pipe);
        return result;
    #endif
}

int JavaManager::ParseJavaVersion(const std::string& versionOutput) {
    // Look for version patterns like:
    // 1.8.0_352, 11.0.17, 17.0.5, 21-ea
    
    size_t versionPos = versionOutput.find("version \"");
    if (versionPos == std::string::npos) {
        return 0;
    }
    
    versionPos += 9; // Skip "version \""
    size_t versionEnd = versionOutput.find("\"", versionPos);
    if (versionEnd == std::string::npos) {
        return 0;
    }
    
    std::string versionStr = versionOutput.substr(versionPos, versionEnd - versionPos);
    
    // Extract major version
    try {
        if (versionStr.find("1.") == 0) {
            // Java 8 and earlier: "1.8.0_352"
            size_t dotPos = versionStr.find('.', 2);
            if (dotPos != std::string::npos) {
                std::string minorStr = versionStr.substr(2, dotPos - 2);
                return std::stoi(minorStr) + 0; // Java 1.8 = version 8
            }
        } else {
            // Java 9+: "11.0.17", "17.0.5"
            size_t dotPos = versionStr.find('.');
            std::string majorStr = (dotPos != std::string::npos) ? 
                                   versionStr.substr(0, dotPos) : versionStr;
            
            // Handle EA/beta versions like "21-ea"
            size_t dashPos = majorStr.find('-');
            if (dashPos != std::string::npos) {
                majorStr = majorStr.substr(0, dashPos);
            }
            
            return std::stoi(majorStr);
        }
    } catch (...) {
        // Parsing failed
    }
    
    return 0;
}

std::string JavaManager::ParseJavaVendor(const std::string& versionOutput) {
    // Look for vendor information
    if (versionOutput.find("OpenJDK") != std::string::npos) {
        return "OpenJDK";
    } else if (versionOutput.find("Java(TM)") != std::string::npos) {
        return "Oracle";
    } else if (versionOutput.find("GraalVM") != std::string::npos) {
        return "GraalVM";
    } else if (versionOutput.find("AdoptOpenJDK") != std::string::npos) {
        return "AdoptOpenJDK";
    } else if (versionOutput.find("Eclipse") != std::string::npos) {
        return "Eclipse Foundation";
    } else if (versionOutput.find("Amazon") != std::string::npos) {
        return "Amazon Corretto";
    } else if (versionOutput.find("Microsoft") != std::string::npos) {
        return "Microsoft";
    } else if (versionOutput.find("BellSoft") != std::string::npos) {
        return "BellSoft Liberica";
    }
    
    return "Unknown";
}

bool JavaManager::Check64Bit(const std::string& javaPath) {
    std::string versionOutput = GetJavaVersionOutput(javaPath);
    
    // Check for 64-bit indicators
    if (versionOutput.find("64-Bit") != std::string::npos ||
        versionOutput.find("64-bit") != std::string::npos ||
        versionOutput.find("x86_64") != std::string::npos ||
        versionOutput.find("x64") != std::string::npos ||
        versionOutput.find("amd64") != std::string::npos) {
        return true;
    }
    
    // Check for 32-bit indicators
    if (versionOutput.find("32-Bit") != std::string::npos ||
        versionOutput.find("32-bit") != std::string::npos ||
        versionOutput.find("x86") != std::string::npos ||
        versionOutput.find("i386") != std::string::npos) {
        return false;
    }
    
    #ifdef _WIN32
        // On Windows, we can check the PE header
        DWORD binaryType;
        if (GetBinaryTypeA(javaPath.c_str(), &binaryType)) {
            return (binaryType == SCS_64BIT_BINARY);
        }
    #endif
    
    // Default to true for modern systems
    return true;
}

void JavaManager::LoadCache() {
    // TODO: Implement caching of Java installations
}

void JavaManager::SaveCache() {
    // TODO: Implement caching of Java installations
}

} // namespace MinecraftCore
