{
  "targets": [{
    "target_name": "launcher_core",
    "sources": [
      "src/native_module.cpp",
      "src/launcher_core.cpp",
      "src/utils/file_utils.cpp",
      "src/utils/string_utils.cpp",
      "src/utils/process_utils.cpp",
      "src/download_manager.cpp",
      "src/pack_manager.cpp",
      "src/version_resolver.cpp",
      "src/java_manager.cpp"
    ],
    "include_dirs": [
      "<!(node -e \"require('node-addon-api').include\")",
      "include",
      "include/utils",
      "include/modloaders"
    ],
    "defines": [
      "NAPI_DISABLE_CPP_EXCEPTIONS",
      "NODE_ADDON_API_DISABLE_DEPRECATED"
    ],
    "cflags!": [
      "-fno-exceptions"
    ],
    "cflags_cc!": [
      "-fno-exceptions"
    ],
    "conditions": [
      ["OS=='win'", {
        "defines": [
          "_WINDOWS",
          "WIN32_LEAN_AND_MEAN",
          "_WIN32_WINNT=0x0A00"
        ],
        "sources": [
          "src/platform/win32_utils.cpp"
        ],
        "libraries": [
          "-lwinhttp",
          "-lole32",
          "-loleaut32",
          "-luuid",
          "-lws2_32",
          "-ladvapi32"
        ]
      }],
      ["OS=='mac'", {
        "defines": [
          "_DARWIN_USE_64_BIT_INODE=1"
        ],
        "xcode_settings": {
          "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
          "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
          "MACOSX_DEPLOYMENT_TARGET": "10.13"
        }
      }],
      ["OS=='linux'", {
        "defines": [
          "_LARGEFILE64_SOURCE",
          "_FILE_OFFSET_BITS=64"
        ],
        "cflags": [
          "-std=c++17"
        ],
        "cflags_cc": [
          "-std=c++17"
        ],
        "libraries": [
          "-lcurl",
          "-lssl",
          "-lcrypto",
          "-lz"
        ]
      }]
    ]
  }]
}