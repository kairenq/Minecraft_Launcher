#ifndef VERSION_RESOLVER_H
#define VERSION_RESOLVER_H

#include <string>
#include <vector>
#include <map>
#include <memory>
#include "launcher_core.h"

namespace Aureate {

class VersionResolver {
public:
    VersionResolver();
    ~VersionResolver();
    
    // Получение версий Minecraft
    std::vector<MinecraftVersion> GetMinecraftVersions(bool refresh = false);
    
    // Получение версий Forge
    std::vector<std::string> GetForgeVersions(const std::string& mcVersion);
    
    // Получение версий Fabric
    std::vector<std::string> GetFabricVersions(const std::string& mcVersion);
    
    // Получение версий Quilt
    std::vector<std::string> GetQuiltVersions(const std::string& mcVersion);
    
    // Получение версий Neoforge
    std::vector<std::string> GetNeoforgeVersions(const std::string& mcVersion);
    
    // Получение manifest для версии
    std::string GetVersionManifest(const std::string& versionId);
    
    // Получение URL для загрузки
    std::string GetForgeInstallerUrl(const std::string& mcVersion, const std::string& forgeVersion);
    std::string GetFabricInstallerUrl(const std::string& mcVersion, const std::string& fabricVersion);
    std::string GetQuiltInstallerUrl(const std::string& mcVersion, const std::string& quiltVersion);
    std::string GetNeoforgeInstallerUrl(const std::string& mcVersion, const std::string& neoforgeVersion);
    
    // Проверка совместимости
    bool IsCompatible(const std::string& mcVersion, ModLoader loader, const std::string& loaderVersion);
    
    // Получение рекомендованной версии
    std::string GetRecommendedForgeVersion(const std::string& mcVersion);
    std::string GetRecommendedFabricVersion(const std::string& mcVersion);
    std::string GetRecommendedJavaVersion(const std::string& mcVersion);
    
private:
    // Кэшированные данные
    std::vector<MinecraftVersion> cachedMinecraftVersions_;
    std::map<std::string, std::vector<std::string>> cachedForgeVersions_;
    std::map<std::string, std::vector<std::string>> cachedFabricVersions_;
    std::map<std::string, std::vector<std::string>> cachedQuiltVersions_;
    std::map<std::string, std::vector<std::string>> cachedNeoforgeVersions_;
    
    // Загрузка данных из интернета
    bool LoadMinecraftVersions();
    bool LoadForgeVersions(const std::string& mcVersion);
    bool LoadFabricVersions(const std::string& mcVersion);
    bool LoadQuiltVersions(const std::string& mcVersion);
    bool LoadNeoforgeVersions(const std::string& mcVersion);
    
    // HTTP запросы
    std::string HttpGet(const std::string& url);
    std::vector<std::string> ParseJsonArray(const std::string& json, const std::string& key);
    std::map<std::string, std::string> ParseJsonObject(const std::string& json);
    
    // Время последнего обновления
    std::map<std::string, long long> lastUpdateTime_;
    const long long CACHE_DURATION = 3600000; // 1 час в миллисекундах
};

} // namespace Aureate

#endif // VERSION_RESOLVER_H