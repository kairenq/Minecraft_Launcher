#include <napi.h>
#include "launcher_core.h"

using namespace Napi;
using namespace Aureate;

class LauncherCoreWrapper : public ObjectWrap<LauncherCoreWrapper> {
public:
    static Object Init(Napi::Env env, Object exports) {
        HandleScope scope(env);
        
        Function func = DefineClass(env, "LauncherCore", {
            InstanceMethod("initialize", &LauncherCoreWrapper::Initialize),
            InstanceMethod("getAvailableModpacks", &LauncherCoreWrapper::GetAvailableModpacks),
            InstanceMethod("installModpack", &LauncherCoreWrapper::InstallModpack),
            InstanceMethod("downloadFile", &LauncherCoreWrapper::DownloadFile),
            InstanceMethod("getSystemInfo", &LauncherCoreWrapper::GetSystemInfo)
        });
        
        constructor = Persistent(func);
        constructor.SuppressDestruct();
        exports.Set("LauncherCore", func);
        
        return exports;
    }
    
    LauncherCoreWrapper(const CallbackInfo& args) : ObjectWrap(args) {
        Napi::Env env = args.Env();
        
        if (args.Length() < 1 || !args[0].IsString()) {
            Napi::TypeError::New(env, "String expected for basePath").ThrowAsJavaScriptException();
            return;
        }
        
        std::string basePath = args[0].As<String>().Utf8Value();
        core_ = std::make_unique<LauncherCore>(basePath);
    }
    
private:
    std::unique_ptr<LauncherCore> core_;
    static FunctionReference constructor;
    
    Napi::Value Initialize(const CallbackInfo& args) {
        Napi::Env env = args.Env();
        bool result = core_->Initialize();
        return Napi::Boolean::New(env, result);
    }
    
    Napi::Value GetAvailableModpacks(const CallbackInfo& args) {
        Napi::Env env = args.Env();
        auto modpacks = core_->GetAvailableModpacks();
        
        Array result = Array::New(env, modpacks.size());
        
        for (size_t i = 0; i < modpacks.size(); i++) {
            Object modpackObj = Object::New(env);
            modpackObj.Set("id", modpacks[i].id);
            modpackObj.Set("name", modpacks[i].name);
            modpackObj.Set("description", modpacks[i].description);
            modpackObj.Set("minecraftVersion", modpacks[i].minecraftVersion);
            modpackObj.Set("modLoader", static_cast<int>(modpacks[i].modLoader));
            modpackObj.Set("modLoaderVersion", modpacks[i].modLoaderVersion);
            modpackObj.Set("iconUrl", modpacks[i].iconUrl);
            modpackObj.Set("archiveUrl", modpacks[i].archiveUrl);
            modpackObj.Set("installed", modpacks[i].installed);
            
            result.Set(i, modpackObj);
        }
        
        return result;
    }
    
    Napi::Value InstallModpack(const CallbackInfo& args) {
        Napi::Env env = args.Env();
        
        if (args.Length() < 1 || !args[0].IsObject()) {
            Napi::TypeError::New(env, "Object expected for modpack").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        Object modpackObj = args[0].As<Object>();
        
        ModpackInfo modpack;
        modpack.id = modpackObj.Get("id").As<String>().Utf8Value();
        modpack.name = modpackObj.Get("name").As<String>().Utf8Value();
        modpack.description = modpackObj.Get("description").As<String>().Utf8Value();
        modpack.minecraftVersion = modpackObj.Get("minecraftVersion").As<String>().Utf8Value();
        modpack.modLoader = static_cast<ModLoader>(modpackObj.Get("modLoader").As<Number>().Int32Value());
        modpack.modLoaderVersion = modpackObj.Get("modLoaderVersion").As<String>().Utf8Value();
        modpack.archiveUrl = modpackObj.Get("archiveUrl").As<String>().Utf8Value();
        
        // Получаем callback для прогресса
        Function progressCallback;
        if (args.Length() > 1 && args[1].IsFunction()) {
            progressCallback = args[1].As<Function>();
        }
        
        // Получаем callback для завершения
        Function completionCallback;
        if (args.Length() > 2 && args[2].IsFunction()) {
            completionCallback = args[2].As<Function>();
        }
        
        // Запускаем установку в отдельном потоке
        auto worker = new InstallModpackWorker(
            core_.get(),
            modpack,
            progressCallback,
            completionCallback
        );
        
        worker->Queue();
        
        return env.Undefined();
    }
    
    Napi::Value DownloadFile(const CallbackInfo& args) {
        Napi::Env env = args.Env();
        
        if (args.Length() < 2) {
            Napi::TypeError::New(env, "Expected 2 arguments: url, destination").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        std::string url = args[0].As<String>().Utf8Value();
        std::string destination = args[1].As<String>().Utf8Value();
        
        // Получаем callback для прогресса
        Function progressCallback;
        if (args.Length() > 2 && args[2].IsFunction()) {
            progressCallback = args[2].As<Function>();
        }
        
        // Получаем callback для завершения
        Function completionCallback;
        if (args.Length() > 3 && args[3].IsFunction()) {
            completionCallback = args[3].As<Function>();
        }
        
        // Запускаем загрузку в отдельном потоке
        auto worker = new DownloadFileWorker(
            core_.get(),
            url,
            destination,
            progressCallback,
            completionCallback
        );
        
        worker->Queue();
        
        return env.Undefined();
    }
    
    Napi::Value GetSystemInfo(const CallbackInfo& args) {
        Napi::Env env = args.Env();
        SystemInfo info = core_->GetSystemInfo();
        
        Object result = Object::New(env);
        result.Set("osName", info.osName);
        result.Set("osVersion", info.osVersion);
        result.Set("architecture", info.architecture);
        result.Set("totalMemory", static_cast<double>(info.totalMemory));
        result.Set("freeMemory", static_cast<double>(info.freeMemory));
        result.Set("processorCount", info.processorCount);
        result.Set("javaVersion", info.javaVersion);
        result.Set("javaPath", info.javaPath);
        
        return result;
    }
    
    // Worker для установки модпака
    class InstallModpackWorker : public AsyncWorker {
    public:
        InstallModpackWorker(LauncherCore* core,
                           const ModpackInfo& modpack,
                           Function progressCallback,
                           Function callback)
            : AsyncWorker(callback), core_(core), modpack_(modpack),
              progressCallback_(progressCallback) {}
        
        void Execute() override {
            // Здесь будет установка через C++
            // Пока просто симуляция
            std::this_thread::sleep_for(std::chrono::seconds(2));
            result_ = true;
        }
        
        void OnProgress(const char* data, size_t count) override {
            if (!progressCallback_.IsEmpty()) {
                std::string progress(data, count);
                // Вызываем JavaScript callback
                progressCallback_.Call({ String::New(Env(), progress) });
            }
        }
        
        void OnOK() override {
            if (!Callback().IsEmpty()) {
                Callback().Call({ Env().Null(), Boolean::New(Env(), result_) });
            }
        }
        
    private:
        LauncherCore* core_;
        ModpackInfo modpack_;
        Function progressCallback_;
        bool result_;
    };
    
    // Worker для загрузки файла
    class DownloadFileWorker : public AsyncWorker {
    public:
        DownloadFileWorker(LauncherCore* core,
                         const std::string& url,
                         const std::string& destination,
                         Function progressCallback,
                         Function callback)
            : AsyncWorker(callback), core_(core), url_(url),
              destination_(destination), progressCallback_(progressCallback) {}
        
        void Execute() override {
            // Используем DownloadManager для загрузки
            DownloadManager downloader;
            result_ = downloader.DownloadFile(url_, destination_,
                [this](int percent, const std::string& stage) {
                    std::string progress = std::to_string(percent) + "% - " + stage;
                    this->OnProgress(progress.c_str(), progress.length());
                });
        }
        
        void OnProgress(const char* data, size_t count) override {
            if (!progressCallback_.IsEmpty()) {
                std::string progress(data, count);
                Napi::HandleScope scope(Env());
                
                // Парсим прогресс
                size_t percentPos = progress.find('%');
                if (percentPos != std::string::npos) {
                    int percent = std::stoi(progress.substr(0, percentPos));
                    std::string stage = progress.substr(percentPos + 3); // " - "
                    
                    progressCallback_.Call({
                        Number::New(Env(), percent),
                        String::New(Env(), stage)
                    });
                }
            }
        }
        
        void OnOK() override {
            if (!Callback().IsEmpty()) {
                Callback().Call({ Env().Null(), Boolean::New(Env(), result_) });
            }
        }
        
    private:
        LauncherCore* core_;
        std::string url_;
        std::string destination_;
        Function progressCallback_;
        bool result_;
    };
};

FunctionReference LauncherCoreWrapper::constructor;

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return LauncherCoreWrapper::Init(env, exports);
}

NODE_API_MODULE(launcher_core, Init)