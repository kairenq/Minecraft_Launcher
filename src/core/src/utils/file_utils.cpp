#include "utils/file_utils.h"
#include <iostream>
#include <fstream>
#include <filesystem>

namespace fs = std::filesystem;

namespace Aureate {

bool FileUtils::Exists(const std::string& path) {
    return fs::exists(path);
}

bool FileUtils::CreateDirectory(const std::string& path) {
    try {
        return fs::create_directories(path);
    } catch (...) {
        return false;
    }
}

bool FileUtils::DeleteFile(const std::string& path) {
    try {
        return fs::remove(path);
    } catch (...) {
        return false;
    }
}

bool FileUtils::DeleteDirectory(const std::string& path) {
    try {
        return fs::remove_all(path) > 0;
    } catch (...) {
        return false;
    }
}

std::vector<std::string> FileUtils::ListFiles(const std::string& path, const std::string& extension) {
    std::vector<std::string> files;
    
    try {
        if (!fs::exists(path)) {
            return files;
        }
        
        for (const auto& entry : fs::directory_iterator(path)) {
            if (fs::is_regular_file(entry.path())) {
                std::string filename = entry.path().filename().string();
                if (extension.empty() || filename.find(extension) != std::string::npos) {
                    files.push_back(filename);
                }
            }
        }
    } catch (...) {
        // Ошибка чтения директории
    }
    
    return files;
}

std::vector<std::string> FileUtils::ListDirectories(const std::string& path) {
    std::vector<std::string> dirs;
    
    try {
        if (!fs::exists(path)) {
            return dirs;
        }
        
        for (const auto& entry : fs::directory_iterator(path)) {
            if (fs::is_directory(entry.path())) {
                dirs.push_back(entry.path().filename().string());
            }
        }
    } catch (...) {
        // Ошибка чтения директории
    }
    
    return dirs;
}

bool FileUtils::MoveFile(const std::string& source, const std::string& destination) {
    try {
        fs::rename(source, destination);
        return true;
    } catch (...) {
        return false;
    }
}

bool FileUtils::ExtractZip(const std::string& zipPath, const std::string& destination) {
    // Простая заглушка - в реальности нужна реализация через библиотеку
    std::cout << "[FileUtils] Extract ZIP: " << zipPath << " -> " << destination << std::endl;
    
    // Создаем целевую директорию
    if (!CreateDirectory(destination)) {
        return false;
    }
    
    // TODO: Реализовать настоящую распаковку ZIP
    // Для начала просто копируем файл как есть
    std::ifstream src(zipPath, std::ios::binary);
    if (!src.is_open()) {
        return false;
    }
    
    std::string destFile = destination + "/extracted.zip";
    std::ofstream dst(destFile, std::ios::binary);
    if (!dst.is_open()) {
        src.close();
        return false;
    }
    
    dst << src.rdbuf();
    src.close();
    dst.close();
    
    return true;
}

} // namespace Aureate