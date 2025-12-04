cmake_minimum_required(VERSION 3.15)
project(minecraft_core VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Для Windows
if(WIN32)
    add_compile_definitions(_WIN32_WINNT=0x0601 NOMINMAX WIN32_LEAN_AND_MEAN)
    set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
endif()

# Находим Node.js
find_package(Nodejs REQUIRED)
include_directories(${NODEJS_INCLUDE_DIRS})

# Пути
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/Release)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/Release)

# Основной модуль
add_library(minecraft_core SHARED
    src/core/src/native_module.cpp
    src/core/src/launcher_core.cpp
    src/core/src/version_resolver.cpp
    src/core/src/java_manager.cpp
    src/core/src/download_manager.cpp
    src/core/src/pack_manager.cpp
    src/core/src/modloaders/forge_handler.cpp
    src/core/src/modloaders/fabric_handler.cpp
    src/core/src/modloaders/universal_handler.cpp
    src/core/src/utils/file_utils.cpp
    src/core/src/utils/string_utils.cpp
    src/core/src/utils/process_utils.cpp
)

# Заголовочные файлы
target_include_directories(minecraft_core PRIVATE
    ${NODEJS_INCLUDE_DIRS}
    ${CMAKE_CURRENT_SOURCE_DIR}/src/core/include
)

# Ссылки
target_link_libraries(minecraft_core ${NODEJS_LIBRARY})

# Для Windows
if(WIN32)
    target_link_libraries(minecraft_core
        ws2_32
        wininet
        shell32
        advapi32
    )
endif()

# Для macOS
if(APPLE)
    set_target_properties(minecraft_core PROPERTIES
        MACOSX_RPATH ON
        INSTALL_RPATH "@loader_path"
    )
    target_link_options(minecraft_core PRIVATE -undefined dynamic_lookup)
endif()
