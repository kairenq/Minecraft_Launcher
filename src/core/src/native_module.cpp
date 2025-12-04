#include <napi.h>
#include <memory>
#include <iostream>
#include "launcher_core.h"
#include "version_resolver.h"
#include "java_manager.h"

using namespace Napi;
using namespace MinecraftCore;

// Обертка для вызовов из JS
class MinecraftLauncherJS : public ObjectWrap<MinecraftLauncherJS> {
public:
    static Object Init(Napi::Env env, Object exports) {
        Function func = DefineClass(env, "MinecraftLauncher", {
            InstanceMethod("launch", &MinecraftLauncherJS::Launch),
            InstanceMethod("getInstalledVersions", &MinecraftLauncherJS::GetInstalledVersions),
            InstanceMethod("getJavaVersions", &MinecraftLauncherJS::GetJavaVersions),
            InstanceMethod("validateInstallation", &MinecraftLauncherJS::ValidateInstallation),
            InstanceMethod("installVersion", &MinecraftLauncherJS::InstallVersion),
        });
        
        exports.Set("MinecraftLauncher", func);
        return exports;
    }
    
    MinecraftLauncherJS(const CallbackInfo& info) : ObjectWrap<MinecraftLauncherJS>(info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::Error::New(env, "Path to launcher directory required");
        }
        
        std::string launcherDir = info[0].As<String>().Utf8Value();
        launcher_ = std::make_unique<LauncherCore>(launcherDir);
        javaManager_ = std::make_unique<JavaManager>();
        
        std::cout << "[C++] Launcher initialized with directory: " << launcherDir << std::endl;
    }
    
private:
    std::unique_ptr<LauncherCore> launcher_;
    std::unique_ptr<JavaManager> javaManager_;
    
    // Метод запуска игры
    Napi::Value Launch(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1 || !info[0].IsObject()) {
            throw Napi::Error::New(env, "Launch options object required");
        }
        
        try {
            Napi::Object jsOptions = info[0].As<Object>();
            LaunchOptions options;
            
            // Парсим опции из JS объекта
            if (jsOptions.Has("versionId")) {
                options.versionId = jsOptions.Get("versionId").As<String>().Utf8Value();
            }
            
            if (jsOptions.Has("username")) {
                options.username = jsOptions.Get("username").As<String>().Utf8Value();
            }
            
            if (jsOptions.Has("gameDir")) {
                options.gameDir = jsOptions.Get("gameDir").As<String>().Utf8Value();
            }
            
            if (jsOptions.Has("javaPath")) {
                options.javaPath = jsOptions.Get("javaPath").As<String>().Utf8Value();
            }
            
            if (jsOptions.Has("memory")) {
                options.memory = jsOptions.Get("memory").As<Number>().Int32Value();
            }
            
            if (jsOptions.Has("serverIp")) {
                options.serverIp = jsOptions.Get("serverIp").As<String>().Utf8Value();
            }
            
            if (jsOptions.Has("serverPort")) {
                options.serverPort = jsOptions.Get("serverPort").As<Number>().Int32Value();
            }
            
            if (jsOptions.Has("width")) {
                options.width = jsOptions.Get("width").As<Number>().Int32Value();
            }
            
            if (jsOptions.Has("height")) {
                options.height = jsOptions.Get("height").As<Number>().Int32Value();
            }
            
            if (jsOptions.Has("demo")) {
                options.demo = jsOptions.Get("demo").As<Boolean>().Value();
            }
            
            if (jsOptions.Has("offline")) {
                options.offline = jsOptions.Get("offline").As<Boolean>().Value();
            }
            
            std::cout << "[C++] Launching Minecraft " << options.versionId 
                      << " for user " << options.username << std::endl;
            
            // Запускаем игру
            ProcessResult result = launcher_->Launch(options);
            
            // Возвращаем результат в JS
            Napi::Object jsResult = Napi::Object::New(env);
            jsResult.Set("success", Napi::Boolean::New(env, result.success));
            jsResult.Set("pid", Napi::Number::New(env, result.pid));
            jsResult.Set("message", Napi::String::New(env, result.message));
            jsResult.Set("exitCode", Napi::Number::New(env, result.exitCode));
            
            return jsResult;
            
        } catch (const std::exception& e) {
            throw Napi::Error::New(env, std::string("Launch error: ") + e.what());
        }
    }
    
    // Получение установленных версий
    Napi::Value GetInstalledVersions(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        try {
            std::vector<VersionInfo> versions = launcher_->GetInstalledVersions();
            Napi::Array jsVersions = Napi::Array::New(env, versions.size());
            
            for (size_t i = 0; i < versions.size(); ++i) {
                Napi::Object jsVersion = Napi::Object::New(env);
                jsVersion.Set("id", Napi::String::New(env, versions[i].id));
                jsVersion.Set("name", Napi::String::New(env, versions[i].name));
                jsVersion.Set("type", Napi::String::New(env, versions[i].type));
                jsVersion.Set("modLoader", Napi::String::New(env, versions[i].modLoader));
                jsVersion.Set("minecraftVersion", Napi::String::New(env, versions[i].minecraftVersion));
                jsVersion.Set("javaVersion", Napi::Number::New(env, versions[i].javaVersion));
                
                jsVersions.Set(i, jsVersion);
            }
            
            return jsVersions;
            
        } catch (const std::exception& e) {
            throw Napi::Error::New(env, std::string("Get versions error: ") + e.what());
        }
    }
    
    // Получение Java версий
    Napi::Value GetJavaVersions(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        try {
            std::vector<JavaVersion> javaVersions = javaManager_->FindAllJavaVersions();
            Napi::Array jsJavaVersions = Napi::Array::New(env, javaVersions.size());
            
            for (size_t i = 0; i < javaVersions.size(); ++i) {
                Napi::Object jsJava = Napi::Object::New(env);
                jsJava.Set("path", Napi::String::New(env, javaVersions[i].path));
                jsJava.Set("version", Napi::Number::New(env, javaVersions[i].version));
                jsJava.Set("vendor", Napi::String::New(env, javaVersions[i].vendor));
                jsJava.Set("is64bit", Napi::Boolean::New(env, javaVersions[i].is64bit));
                jsJava.Set("type", Napi::String::New(env, javaVersions[i].type));
                
                jsJavaVersions.Set(i, jsJava);
            }
            
            return jsJavaVersions;
            
        } catch (const std::exception& e) {
            throw Napi::Error::New(env, std::string("Get Java versions error: ") + e.what());
        }
    }
    
    // Валидация установки
    Napi::Value ValidateInstallation(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::Error::New(env, "Version ID required");
        }
        
        try {
            std::string versionId = info[0].As<String>().Utf8Value();
            bool isValid = launcher_->ValidateInstallation(versionId);
            
            return Napi::Boolean::New(env, isValid);
            
        } catch (const std::exception& e) {
            throw Napi::Error::New(env, std::string("Validation error: ") + e.what());
        }
    }
    
    // Установка версии
    Napi::Value InstallVersion(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1 || !info[0].IsString()) {
            throw Napi::Error::New(env, "Version ID required");
        }
        
        try {
            std::string versionId = info[0].As<String>().Utf8Value();
            std::string modLoader = "";
            
            if (info.Length() > 1 && info[1].IsString()) {
                modLoader = info[1].As<String>().Utf8Value();
            }
            
            bool success = launcher_->InstallVersion(versionId, modLoader);
            
            return Napi::Boolean::New(env, success);
            
        } catch (const std::exception& e) {
            throw Napi::Error::New(env, std::string("Install error: ") + e.what());
        }
    }
};

// Инициализация модуля
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return MinecraftLauncherJS::Init(env, exports);
}

NODE_API_MODULE(minecraft_core, Init)
