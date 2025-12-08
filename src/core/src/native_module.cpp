#include <napi.h>
#include <string>
#include <vector>
#include <iostream>

namespace Aureate {

// Простой класс для демонстрации
class SimpleDownloader {
public:
    static bool DownloadFile(const std::string& url, const std::string& dest) {
        // Заглушка - в реальности здесь будет HTTP запрос
        std::cout << "[C++] Downloading " << url << " to " << dest << std::endl;
        return true;
    }
    
    static std::vector<std::string> GetModpacks() {
        return {
            "draconica_1.18.2",
            "skydustry"
        };
    }
};

// NAPI обертка
Napi::Value DownloadFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected 2 arguments").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string url = info[0].As<Napi::String>().Utf8Value();
    std::string dest = info[1].As<Napi::String>().Utf8Value();
    
    bool result = SimpleDownloader::DownloadFile(url, dest);
    return Napi::Boolean::New(env, result);
}

Napi::Array GetModpacks(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    auto modpacks = SimpleDownloader::GetModpacks();
    Napi::Array result = Napi::Array::New(env, modpacks.size());
    
    for (size_t i = 0; i < modpacks.size(); i++) {
        result[i] = Napi::String::New(env, modpacks[i]);
    }
    
    return result;
}

Napi::Object GetSystemInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    
    result.Set("platform", Napi::String::New(env, 
#ifdef _WIN32
        "win32"
#elif __APPLE__
        "darwin"
#else
        "linux"
#endif
    ));
    
    result.Set("arch", Napi::String::New(env, 
#ifdef _WIN64
        "x64"
#elif __x86_64__
        "x64"
#elif __aarch64__
        "arm64"
#else
        "unknown"
#endif
    ));
    
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("downloadFile", Napi::Function::New(env, DownloadFile));
    exports.Set("getModpacks", Napi::Function::New(env, GetModpacks));
    exports.Set("getSystemInfo", Napi::Function::New(env, GetSystemInfo));
    
    return exports;
}

NODE_API_MODULE(launcher_core, Init)

} // namespace Aureate