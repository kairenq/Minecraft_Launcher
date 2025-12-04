cmake_minimum_required(VERSION 3.14)
project(AureateLauncherCore)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Настройки для разных платформ
if(WIN32)
    add_definitions(-DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0A00)
    set(PLATFORM_LIBS winhttp.lib)
else()
    find_package(CURL REQUIRED)
    set(PLATFORM_LIBS ${CURL_LIBRARIES})
endif()

# Настройки для Node Addon API
find_package(Nodejs REQUIRED)
include_directories(${NODEJS_INCLUDE_DIRS})

# Ищем NAN (Native Abstractions for Node.js)
find_path(NAN_INCLUDE_DIR NAMES nan.h
    PATHS ${NODEJS_INCLUDE_DIRS}/../src
    DOC "Path to NAN headers")

# Ищем node-addon-api
find_path(NAPI_INCLUDE_DIR NAMES napi.h
    PATHS ${NODEJS_INCLUDE_DIRS}/../src
    DOC "Path to node-addon-api headers")

include_directories(${NAN_INCLUDE_DIR} ${NAPI_INCLUDE_DIR})

# Ищем nlohmann/json
find_package(nlohmann_json 3.2.0 REQUIRED)

# Ищем zlib для работы с ZIP
find_package(ZLIB REQUIRED)

# Ищем OpenSSL для HTTPS
find_package(OpenSSL REQUIRED)

# Основная библиотека
add_library(launcher_core SHARED
    src/launcher_core.cpp
    src/version_resolver.cpp
    src/java_manager.cpp
    src/download_manager.cpp
    src/pack_manager.cpp
    src/modloaders/forge_handler.cpp
    src/modloaders/fabric_handler.cpp
    src/modloaders/universal_handler.cpp
    src/utils/file_utils.cpp
    src/utils/string_utils.cpp
    src/utils/process_utils.cpp
    src/native_module.cpp
)

target_include_directories(launcher_core PRIVATE 
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${NAN_INCLUDE_DIR}
    ${NAPI_INCLUDE_DIR}
    ${NODEJS_INCLUDE_DIRS}
)

target_link_libraries(launcher_core
    ${PLATFORM_LIBS}
    ZLIB::ZLIB
    OpenSSL::SSL
    OpenSSL::Crypto
    nlohmann_json::nlohmann_json
)

# Установка
install(TARGETS launcher_core
    DESTINATION ${CMAKE_BINARY_DIR}/Release)