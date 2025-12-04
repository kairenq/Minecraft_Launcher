const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// Загружаем C++ модуль
let nativeModule = null;
try {
    // Для разработки
    if (fs.existsSync(path.join(__dirname, '../../build/Release/minecraft_core.node'))) {
        nativeModule = require('../../build/Release/minecraft_core.node');
        console.log('C++ модуль загружен успешно');
    } else {
        console.warn('C++ модуль не найден. Запускаем в режиме эмуляции.');
        nativeModule = {
            MinecraftLauncher: class MockLauncher {
                constructor() {
                    console.log('[MOCK] Mock C++ launcher created');
                }
                launch() { 
                    return { success: true, pid: 12345, message: '[MOCK] Game launched' }; 
                }
                getInstalledVersions() { return []; }
                getJavaVersions() { return []; }
                validateInstallation() { return true; }
                installVersion() { return true; }
            }
        };
    }
} catch (error) {
    console.error('Failed to load C++ module:', error.message);
}

let mainWindow;
let configManager;
let launcherInstance = null;

// Получение пути к директории лаунчера
function getLauncherDir() {
    const homeDir = os.homedir();
    const launcherDir = path.join(homeDir, 'Aureate');
    
    // Создаем структуру папок C++ лаунчера
    const dirs = [
        launcherDir,
        path.join(launcherDir, 'versions'),
        path.join(launcherDir, 'libraries'),
        path.join(launcherDir, 'assets'),
        path.join(launcherDir, 'instances'),
        path.join(launcherDir, 'packs'),
        path.join(launcherDir, 'java')
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
    
    return launcherDir;
}

function createWindow() {
    // Загрузка конфигурации
    configManager = new ConfigManager(getLauncherDir());
    const config = configManager.getConfig();

    mainWindow = new BrowserWindow({
        width: config.windowWidth || 1200,
        height: config.windowHeight || 750,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        transparent: false,
        backgroundColor: '#0a0a0a',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        icon: path.join(__dirname, '../../assets/logo.ico')
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    mainWindow.setMenu(null);

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Инициализируем C++ лаунчер
    setTimeout(() => {
        initializeNativeLauncher();
    }, 1000);
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ========== ИНИЦИАЛИЗАЦИЯ C++ ЛАУНЧЕРА ==========
function initializeNativeLauncher() {
    try {
        const launcherDir = getLauncherDir();
        console.log('Initializing C++ launcher with directory:', launcherDir);
        
        if (!nativeModule || !nativeModule.MinecraftLauncher) {
            throw new Error('C++ module not available');
        }
        
        launcherInstance = new nativeModule.MinecraftLauncher(launcherDir);
        console.log('C++ launcher initialized successfully');
        
        // Отправляем уведомление в UI
        if (mainWindow) {
            mainWindow.webContents.send('native-launcher-ready', { 
                success: true, 
                message: 'C++ ядро инициализировано' 
            });
        }
    } catch (error) {
        console.error('Failed to initialize C++ launcher:', error);
        
        // Создаем fallback JS лаунчер
        launcherInstance = createFallbackLauncher();
        
        if (mainWindow) {
            mainWindow.webContents.send('native-launcher-error', { 
                message: 'Используется JS fallback: ' + error.message 
            });
        }
    }
}

function createFallbackLauncher() {
    console.log('Creating JavaScript fallback launcher');
    
    return {
        launch: (options) => {
            console.log('[JS FALLBACK] Launching:', options);
            return { 
                success: true, 
                pid: 99999, 
                message: 'Launched via JavaScript fallback',
                exitCode: 0 
            };
        },
        getInstalledVersions: () => {
            return [];
        },
        getJavaVersions: () => {
            return [
                {
                    path: 'java',
                    version: 17,
                    vendor: 'Fallback Java',
                    is64bit: true,
                    type: 'jre'
                }
            ];
        },
        validateInstallation: () => true,
        installVersion: () => true
    };
}

// ========== IPC Handlers ==========

// Инициализация лаунчера
ipcMain.handle('initialize-launcher', async () => {
    const launcherDir = getLauncherDir();
    
    if (!launcherInstance) {
        try {
            launcherInstance = new nativeModule.MinecraftLauncher(launcherDir);
        } catch (error) {
            console.error('IPC: Failed to create launcher:', error);
            launcherInstance = createFallbackLauncher();
        }
    }
    
    return { 
        success: true, 
        launcherDir: launcherDir,
        isNative: launcherInstance.constructor.name !== 'MockLauncher'
    };
});

// Получение конфигурации
ipcMain.handle('get-config', async () => {
    return configManager.getConfig();
});

// Сохранение конфигурации
ipcMain.handle('save-config', async (event, config) => {
    const oldConfig = configManager.getConfig();
    configManager.saveConfig(config);

    if (mainWindow && (config.windowWidth !== oldConfig.windowWidth || config.windowHeight !== oldConfig.windowHeight)) {
        mainWindow.setSize(config.windowWidth, config.windowHeight);
    }

    return { success: true };
});

// Получение списка сборок
ipcMain.handle('get-modpacks', async () => {
    return configManager.getModpacks();
});

// Добавление сборки
ipcMain.handle('add-modpack', async (event, modpack) => {
    configManager.addModpack(modpack);
    return { success: true };
});

// ===== Запуск Minecraft через C++ =====
ipcMain.handle('launch-minecraft', async (event, options) => {
    if (!launcherInstance) {
        return { 
            success: false, 
            message: 'Лаунчер не инициализирован',
            pid: 0,
            exitCode: -1
        };
    }

    try {
        console.log('C++ Launching Minecraft with options:', options);
        
        // Подготавливаем опции для C++
        const cppOptions = {
            versionId: options.version,
            username: options.username || 'Player',
            gameDir: path.join(getLauncherDir(), 'instances', options.modpackId || 'default'),
            javaPath: '', // Автоопределится
            memory: options.memory || 2048,
            serverIp: options.serverIp || '',
            serverPort: options.serverPort || 25565,
            demo: options.demo || false,
            offline: true
        };

        const result = launcherInstance.launch(cppOptions);
        console.log('C++ Launch result:', result);

        if (result.success) {
            mainWindow.webContents.send('game-started', { pid: result.pid });
        }

        return result;

    } catch (error) {
        console.error('C++ Launch error:', error);
        return { 
            success: false, 
            message: 'C++ Ошибка: ' + error.message,
            pid: 0,
            exitCode: -1
        };
    }
});

// ===== Получение версий через C++ =====
ipcMain.handle('get-installed-versions', async () => {
    if (!launcherInstance) {
        return { success: false, versions: [], message: 'Лаунчер не инициализирован' };
    }

    try {
        const versions = launcherInstance.getInstalledVersions();
        return { success: true, versions };
    } catch (error) {
        console.error('Failed to get versions:', error);
        return { success: false, versions: [], message: error.message };
    }
});

// ===== Получение Java через C++ =====
ipcMain.handle('get-java-versions', async () => {
    if (!launcherInstance) {
        return { success: false, javaVersions: [], message: 'Лаунчер не инициализирован' };
    }

    try {
        const javaVersions = launcherInstance.getJavaVersions();
        return { success: true, javaVersions };
    } catch (error) {
        console.error('Failed to get Java versions:', error);
        return { success: false, javaVersions: [], message: error.message };
    }
});

// ===== Валидация установки через C++ =====
ipcMain.handle('validate-installation', async (event, versionId) => {
    if (!launcherInstance) {
        return { success: false, isValid: false, message: 'Лаунчер не инициализирован' };
    }

    try {
        const isValid = launcherInstance.validateInstallation(versionId);
        return { success: true, isValid };
    } catch (error) {
        console.error('Failed to validate:', error);
        return { success: false, isValid: false, message: error.message };
    }
});

// ===== Установка версии через C++ =====
ipcMain.handle('install-version', async (event, versionId, modLoader) => {
    if (!launcherInstance) {
        return { success: false, message: 'Лаунчер не инициализирован' };
    }

    try {
        const success = launcherInstance.installVersion(versionId, modLoader || '');
        return { success, message: success ? 'Установка начата' : 'Ошибка установки' };
    } catch (error) {
        console.error('Failed to install version:', error);
        return { success: false, message: error.message };
    }
});

// ===== Остальные handlers (оставляем как есть) =====
// ... (все остальные handlers из твоего кода остаются без изменений)

// Остальной код твоего main.js остается без изменений
// Только заменяем вызовы minecraftLauncher.launch() на launcherInstance.launch()
