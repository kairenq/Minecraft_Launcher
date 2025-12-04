#include "version_resolver.h"
#include <iostream>
#include <fstream>
#include <filesystem>
#include <sstream>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace MinecraftCore {

namespace fs = std::filesystem;

VersionResolver::VersionResolver(const std::string& versionsDir)
    : versionsDir_(versionsDir) {
    
    if (!fs::exists(versionsDir_)) {
        fs::create_directories(versionsDir_);
    }
}

VersionInfo VersionResolver::AnalyzeVersion(const std::string& versionId) {
    VersionInfo info;
    info.id = versionId;
    
    try {
        std::string jsonContent = ReadVersionFile(versionId);
        
        info.mainClass = ParseMainClass(jsonContent);
        info.assets = ParseAssets(jsonContent);
        info.inheritsFrom = ParseInheritsFrom(jsonContent);
        info.type = ParseVersionType(jsonContent);
        info.modLoader = DetectModLoader(versionId);
        info.minecraftVersion = ExtractMinecraftVersion(versionId);
        info.javaVersion = DetectRequiredJava(info.minecraftVersion);
        
        // Generate display name
        if (info.modLoader == "forge") {
            info.name = "Forge " + info.minecraftVersion;
        } else if (info.modLoader == "fabric") {
            info.name = "Fabric " + info.minecraftVersion;
        } else if (info.modLoader == "quilt") {
            info.name = "Quilt " + info.minecraftVersion;
        } else {
            info.name = "Minecraft " + info.minecraftVersion;
        }
        
        // Get release time from file
        std::string jsonPath = GetVersionJsonPath(versionId);
        if (fs::exists(jsonPath)) {
            auto ftime = fs::last_write_time(jsonPath);
            auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
            );
            std::time_t cftime = std::chrono::system_clock::to_time_t(sctp);
            char buffer[80];
            std::strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", std::localtime(&cftime));
            info.releaseTime = buffer;
        }
        
    } catch (const std::exception& e) {
        std::cerr << "Error analyzing version " << versionId << ": " << e.what() << std::endl;
    }
    
    return info;
}

std::string VersionResolver::DetectModLoader(const std::string& versionId) {
    std::string lowerId = versionId;
    std::transform(lowerId.begin(), lowerId.end(), lowerId.begin(), ::tolower);
    
    if (lowerId.find("forge") != std::string::npos) {
        return "forge";
    } else if (lowerId.find("fabric") != std::string::npos) {
        return "fabric";
    } else if (lowerId.find("quilt") != std::string::npos) {
        return "quilt";
    } else if (lowerId.find("liteloader") != std::string::npos) {
        return "liteloader";
    } else if (lowerId.find("optifine") != std::string::npos) {
        return "optifine";
    } else if (lowerId.find("rift") != std::string::npos) {
        return "rift";
    }
    
    return "vanilla";
}

std::string VersionResolver::ExtractMinecraftVersion(const std::string& versionId) {
    // Patterns for different version formats
    std::vector<std::string> patterns = {
        R"((\d+\.\d+(?:\.\d+)?))",           // 1.20.1, 1.18.2
        R"((\d+w\d+[a-z]))",                 // 23w45a (snapshots)
        R"((\d+\.\d+-pre\d+))",              // 1.20-pre1
        R"((\d+\.\d+-rc\d+))"                // 1.20-rc1
    };
    
    // Try each pattern
    for (const auto& pattern : patterns) {
        size_t start = 0;
        while (start < versionId.length()) {
            size_t found = versionId.find_first_of("0123456789", start);
            if (found == std::string::npos) break;
            
            // Check if this looks like a version number
            size_t end = versionId.find_first_not_of("0123456789.w-rcpre", found);
            if (end == std::string::npos) end = versionId.length();
            
            std::string candidate = versionId.substr(found, end - found);
            
            // Simple validation
            if (candidate.find('.') != std::string::npos || 
                (candidate.find('w') != std::string::npos && candidate.find('a') != std::string::npos)) {
                return candidate;
            }
            
            start = end + 1;
        }
    }
    
    // Fallback: try to extract any numbers
    std::string result;
    for (char c : versionId) {
        if (isdigit(c) || c == '.' || c == 'w' || c == 'a' || c == 'b' || c == '-' || c == 'r' || c == 'c' || c == 'p' || c == 'r' || c == 'e') {
            result += c;
        } else if (!result.empty()) {
            break;
        }
    }
    
    return result.empty() ? versionId : result;
}

int VersionResolver::DetectRequiredJava(const std::string& minecraftVersion) {
    if (minecraftVersion.empty()) {
        return 17; // Default for modern versions
    }
    
    // Extract major.minor version
    size_t firstDot = minecraftVersion.find('.');
    if (firstDot == std::string::npos) {
        return 8; // Fallback
    }
    
    try {
        int major = std::stoi(minecraftVersion.substr(0, firstDot));
        size_t secondDot = minecraftVersion.find('.', firstDot + 1);
        int minor = (secondDot != std::string::npos) ? 
                   std::stoi(minecraftVersion.substr(firstDot + 1, secondDot - firstDot - 1)) :
                   std::stoi(minecraftVersion.substr(firstDot + 1));
        
        // Java version requirements based on Minecraft version
        if (major == 1) {
            if (minor >= 18) return 17; // 1.18+ requires Java 17
            if (minor >= 17) return 16; // 1.17 requires Java 16
            if (minor >= 12) return 8;  // 1.12-1.16 requires Java 8
            return 8;                   // Older versions require Java 8
        }
    } catch (...) {
        // If parsing fails, use default
    }
    
    return 8; // Default fallback
}

std::vector<VersionInfo> VersionResolver::FindInstalledVersions() {
    std::vector<VersionInfo> versions;
    
    if (!fs::exists(versionsDir_)) {
        return versions;
    }
    
    try {
        for (const auto& entry : fs::directory_iterator(versionsDir_)) {
            if (!entry.is_directory()) {
                continue;
            }
            
            std::string versionId = entry.path().filename().string();
            std::string jsonPath = entry.path() / (versionId + ".json");
            
            if (fs::exists(jsonPath)) {
                try {
                    VersionInfo info = AnalyzeVersion(versionId);
                    versions.push_back(info);
                } catch (const std::exception& e) {
                    std::cerr << "Error analyzing version " << versionId << ": " << e.what() << std::endl;
                }
            }
        }
        
        // Sort by release time (newest first)
        std::sort(versions.begin(), versions.end(), 
            [](const VersionInfo& a, const VersionInfo& b) {
                return a.releaseTime > b.releaseTime;
            });
            
    } catch (const std::exception& e) {
        std::cerr << "Error scanning versions directory: " << e.what() << std::endl;
    }
    
    return versions;
}

VersionInfo VersionResolver::GetVersionInfo(const std::string& versionId) {
    return AnalyzeVersion(versionId);
}

bool VersionResolver::VersionExists(const std::string& versionId) {
    std::string jsonPath = GetVersionJsonPath(versionId);
    return fs::exists(jsonPath);
}

bool VersionResolver::ValidateVersion(const std::string& versionId) {
    if (!VersionExists(versionId)) {
        return false;
    }
    
    std::string jarPath = GetVersionJarPath(versionId);
    if (!fs::exists(jarPath)) {
        return false;
    }
    
    // Check if JAR file has reasonable size
    try {
        size_t fileSize = fs::file_size(jarPath);
        if (fileSize < 1024) { // Less than 1KB
            return false;
        }
    } catch (...) {
        return false;
    }
    
    return true;
}

std::vector<std::string> VersionResolver::GetVersionDependencies(const std::string& versionId) {
    std::vector<std::string> dependencies;
    
    try {
        std::string jsonContent = ReadVersionFile(versionId);
        
        // Simple parsing for inheritsFrom
        size_t pos = jsonContent.find("\"inheritsFrom\"");
        if (pos != std::string::npos) {
            size_t start = jsonContent.find('"', pos + 14);
            size_t end = jsonContent.find('"', start + 1);
            if (start != std::string::npos && end != std::string::npos) {
                std::string parent = jsonContent.substr(start + 1, end - start - 1);
                if (!parent.empty()) {
                    dependencies.push_back(parent);
                }
            }
        }
        
    } catch (const std::exception& e) {
        std::cerr << "Error getting dependencies: " << e.what() << std::endl;
    }
    
    return dependencies;
}

// Private helper methods
std::string VersionResolver::ReadVersionFile(const std::string& versionId) {
    std::string jsonPath = GetVersionJsonPath(versionId);
    
    std::ifstream file(jsonPath);
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open version JSON: " + jsonPath);
    }
    
    std::stringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

std::string VersionResolver::GetVersionJsonPath(const std::string& versionId) {
    return versionsDir_ + "/" + versionId + "/" + versionId + ".json";
}

std::string VersionResolver::GetVersionJarPath(const std::string& versionId) {
    return versionsDir_ + "/" + versionId + "/" + versionId + ".jar";
}

std::string VersionResolver::ParseMainClass(const std::string& jsonContent) {
    size_t pos = jsonContent.find("\"mainClass\"");
    if (pos == std::string::npos) {
        return "net.minecraft.client.main.Main";
    }
    
    size_t start = jsonContent.find('"', pos + 11);
    size_t end = jsonContent.find('"', start + 1);
    
    if (start != std::string::npos && end != std::string::npos) {
        return jsonContent.substr(start + 1, end - start - 1);
    }
    
    return "net.minecraft.client.main.Main";
}

std::string VersionResolver::ParseAssets(const std::string& jsonContent) {
    size_t pos = jsonContent.find("\"assets\"");
    if (pos == std::string::npos) {
        return "1.18"; // Default assets index
    }
    
    size_t start = jsonContent.find('"', pos + 8);
    size_t end = jsonContent.find('"', start + 1);
    
    if (start != std::string::npos && end != std::string::npos) {
        return jsonContent.substr(start + 1, end - start - 1);
    }
    
    return "1.18";
}

std::string VersionResolver::ParseInheritsFrom(const std::string& jsonContent) {
    size_t pos = jsonContent.find("\"inheritsFrom\"");
    if (pos == std::string::npos) {
        return "";
    }
    
    size_t start = jsonContent.find('"', pos + 14);
    size_t end = jsonContent.find('"', start + 1);
    
    if (start != std::string::npos && end != std::string::npos) {
        return jsonContent.substr(start + 1, end - start - 1);
    }
    
    return "";
}

std::string VersionResolver::ParseVersionType(const std::string& jsonContent) {
    size_t pos = jsonContent.find("\"type\"");
    if (pos == std::string::npos) {
        return "release";
    }
    
    size_t start = jsonContent.find('"', pos + 6);
    size_t end = jsonContent.find('"', start + 1);
    
    if (start != std::string::npos && end != std::string::npos) {
        return jsonContent.substr(start + 1, end - start - 1);
    }
    
    return "release";
}

std::string VersionResolver::GetOsName() {
    #ifdef _WIN32
        return "windows";
    #elif __APPLE__
        return "macos";
    #else
        return "linux";
    #endif
}

std::string VersionResolver::GetArchitecture() {
    #ifdef _WIN32
        #ifdef _WIN64
            return "x64";
        #else
            return "x86";
        #endif
    #elif __APPLE__
        #ifdef __x86_64__
            return "x64";
        #elif __arm64__
            return "arm64";
        #else
            return "unknown";
        #endif
    #else
        // Linux
        struct utsname unameData;
        if (uname(&unameData) == 0) {
            std::string arch = unameData.machine;
            if (arch == "x86_64") return "x64";
            if (arch == "i386" || arch == "i686") return "x86";
            if (arch.find("arm") != std::string::npos) return "arm";
            if (arch.find("aarch64") != std::string::npos) return "arm64";
        }
        return "unknown";
    #endif
}

} // namespace MinecraftCore
