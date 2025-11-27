const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// Импорт утилит
const MinecraftDownloader = require('../utils/minecraft-downloader');
const JavaDownloader = require('../utils/java-downloader');
const MinecraftLauncher = require('../utils/minecraft-launcher');
const ConfigManager = require('../utils/config-manager');
const ModLoaderInstaller = require('../utils/modloader-installer');
const ModsDownloader = require('../utils/mods-downloader');
const ArchiveDownloader = require('../utils/archive-downloader');

let mainWindow;
let configManager;
let minecraftDownloader;
let javaDownloader;
let minecraftLauncher;
let modLoaderInstaller;
let modsDownloader;
let archiveDownloader;

// Получение пути к директории лаунчера
function getLauncherDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, 'Aureate');
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

  // Убираем меню (File, Edit, View и т.д.)
  mainWindow.setMenu(null);

  // Открыть DevTools в режиме разработки
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Инициализация утилит
  minecraftDownloader = new MinecraftDownloader(getLauncherDir());
  javaDownloader = new JavaDownloader(getLauncherDir());
  minecraftLauncher = new MinecraftLauncher(getLauncherDir());
  modLoaderInstaller = new ModLoaderInstaller(getLauncherDir());
  modsDownloader = new ModsDownloader(getLauncherDir());
  archiveDownloader = new ArchiveDownloader(getLauncherDir());
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

// ========== IPC Handlers ==========

// Получение конфигурации
ipcMain.handle('get-config', async () => {
  return configManager.getConfig();
});

// Сохранение конфигурации
ipcMain.handle('save-config', async (event, config) => {
  const oldConfig = configManager.getConfig();
  configManager.saveConfig(config);

  // Применение изменения размера окна
  if (mainWindow && (config.windowWidth !== oldConfig.windowWidth || config.windowHeight !== oldConfig.windowHeight)) {
    mainWindow.setSize(config.windowWidth, config.windowHeight);
    console.log(`Window resized to ${config.windowWidth}x${config.windowHeight}`);
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

// ===== Избранное =====
ipcMain.handle('toggle-favorite', async (event, modpackId) => {
  const isFavorite = configManager.toggleFavorite(modpackId);
  return { isFavorite };
});

ipcMain.handle('get-favorites', async () => {
  return configManager.getFavorites();
});

// ===== История =====
ipcMain.handle('add-to-history', async (event, modpackId) => {
  configManager.addToHistory(modpackId);
  return { success: true };
});

ipcMain.handle('get-history', async (event, limit) => {
  return configManager.getHistory(limit);
});

ipcMain.handle('clear-history', async () => {
  configManager.clearHistory();
  return { success: true };
});

// ===== Статистика =====
ipcMain.handle('update-stats', async (event, modpackId, playtime) => {
  configManager.updateStats(modpackId, playtime);
  return { success: true };
});

ipcMain.handle('get-stats', async (event, modpackId) => {
  return configManager.getStats(modpackId);
});

ipcMain.handle('get-all-stats', async () => {
  return configManager.getAllStats();
});

// ===== Кастомизация =====
ipcMain.handle('update-customization', async (event, updates) => {
  return configManager.updateCustomization(updates);
});

ipcMain.handle('get-customization', async () => {
  return configManager.getCustomization();
});

// Проверка установки Java
ipcMain.handle('check-java', async () => {
  return await javaDownloader.checkJava();
});

// Загрузка Java
ipcMain.handle('download-java', async (event) => {
  return new Promise((resolve, reject) => {
    javaDownloader.download(
      (progress) => {
        mainWindow.webContents.send('download-progress', {
          type: 'java',
          stage: progress.stage || 'Загрузка Java',
          percent: progress.percent || 0
        });
      },
      (error) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true });
        }
      }
    );
  });
});

// Проверка установки Minecraft
ipcMain.handle('check-minecraft', async (event, version) => {
  return await minecraftDownloader.checkMinecraft(version);
});

// Загрузка Minecraft
ipcMain.handle('download-minecraft', async (event, version) => {
  return new Promise((resolve, reject) => {
    minecraftDownloader.download(
      version,
      (progress) => {
        mainWindow.webContents.send('download-progress', {
          type: 'minecraft',
          version: version,
          stage: progress.stage || 'Загрузка Minecraft',
          percent: progress.percent || 0
        });
      },
      (error) => {
        if (error) {
          reject(error);
        } else {
          resolve({ success: true });
        }
      }
    );
  });
});

// Запуск Minecraft
ipcMain.handle('launch-minecraft', async (event, options) => {
  const config = configManager.getConfig();
  const modpack = configManager.getModpack(options.modpackId);

  if (!modpack) {
    throw new Error('Modpack not found');
  }

  return new Promise((resolve, reject) => {
    minecraftLauncher.launch({
      version: options.version,
      username: options.username || config.username || 'Player',
      memory: options.memory || config.allocatedMemory || 2048,
      javaPath: javaDownloader.getJavaPath(),
      gameDir: path.join(getLauncherDir(), 'instances', options.modpackId || 'default'),
      modLoader: modpack.modLoader || 'vanilla',
      modLoaderVersion: modpack.modLoaderVersion
    }, (error, process) => {
      if (error) {
        reject(error);
      } else {
        mainWindow.webContents.send('game-started', { pid: process.pid });
        resolve({ success: true, pid: process.pid });
      }
    });
  });
});

// Открыть директорию игры
ipcMain.handle('open-game-dir', async () => {
  const gameDir = getLauncherDir();
  await fs.ensureDir(gameDir);
  shell.openPath(gameDir);
  return { success: true };
});

// Получить путь к директории лаунчера
ipcMain.handle('get-launcher-dir', async () => {
  return getLauncherDir();
});

// Получить системную информацию
ipcMain.handle('get-system-info', async () => {
  const totalMemory = Math.floor(os.totalmem() / 1024 / 1024); // MB
  const freeMemory = Math.floor(os.freemem() / 1024 / 1024); // MB

  return {
    platform: os.platform(),
    arch: os.arch(),
    totalMemory: totalMemory,
    freeMemory: freeMemory,
    cpus: os.cpus().length
  };
});

// Установка сборки
ipcMain.handle('install-modpack', async (event, modpackId) => {
  try {
    const modpack = configManager.getModpack(modpackId);
    if (!modpack) {
      throw new Error('Modpack not found');
    }

    console.log(`\n=== НАЧАЛО УСТАНОВКИ СБОРКИ ===`);
    console.log(`Сборка: ${modpack.name} (${modpackId})`);
    console.log(`Minecraft: ${modpack.minecraftVersion}`);
    console.log(`Модлоадер: ${modpack.modLoader || 'vanilla'}`);

    // 1. Проверка и загрузка Java
    const javaInstalled = await javaDownloader.checkJava();
    if (!javaInstalled) {
      console.log('[INSTALL] Java не установлена, начинаем загрузку...');
      mainWindow.webContents.send('install-status', {
        modpackId: modpackId,
        status: 'downloading-java'
      });

      await new Promise((resolve, reject) => {
        javaDownloader.download(
          (progress) => {
            mainWindow.webContents.send('download-progress', {
              modpackId: modpackId,
              type: 'java',
              stage: progress.stage || 'Загрузка Java',
              percent: progress.percent || 0
            });
          },
          (error) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });
      console.log('[INSTALL] ✓ Java установлена');
    } else {
      console.log('[INSTALL] ✓ Java уже установлена');
    }

    // 2. Загрузка Minecraft
    mainWindow.webContents.send('install-status', {
      modpackId: modpackId,
      status: 'downloading-minecraft'
    });

    const minecraftInstalled = await minecraftDownloader.checkMinecraft(modpack.minecraftVersion);
    if (!minecraftInstalled) {
      console.log(`[INSTALL] Minecraft ${modpack.minecraftVersion} не установлен, начинаем загрузку...`);
      await new Promise((resolve, reject) => {
        minecraftDownloader.download(
          modpack.minecraftVersion,
          (progress) => {
            mainWindow.webContents.send('download-progress', {
              modpackId: modpackId,
              type: 'minecraft',
              version: modpack.minecraftVersion,
              stage: progress.stage || 'Загрузка Minecraft',
              percent: progress.percent || 0
            });
          },
          (error) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });
      console.log(`[INSTALL] ✓ Minecraft ${modpack.minecraftVersion} установлен`);
    } else {
      console.log(`[INSTALL] ✓ Minecraft ${modpack.minecraftVersion} уже установлен`);
    }

    // 3. Установка модлоадера (Forge/Fabric) - С ПРОВЕРКОЙ
    if (modpack.modLoader && modpack.modLoader !== 'vanilla') {
      console.log(`[INSTALL] Проверка модлоадера: ${modpack.modLoader}`);
      
      // ПРОВЕРЯЕМ УСТАНОВЛЕН ЛИ УЖЕ МОДЛОАДЕР
      const isModLoaderInstalled = await modLoaderInstaller.checkInstalled(
        modpack.modLoader,
        modpack.minecraftVersion,
        modpack.modLoaderVersion
      );

      if (!isModLoaderInstalled) {
        console.log(`[INSTALL] Модлоадер ${modpack.modLoader} не установлен, начинаем установку...`);
        mainWindow.webContents.send('install-status', {
          modpackId: modpackId,
          status: 'installing-modloader'
        });

        await modLoaderInstaller.install(
          modpack.modLoader,
          modpack.minecraftVersion,
          modpack.modLoaderVersion,
          (progress) => {
            mainWindow.webContents.send('download-progress', {
              modpackId: modpackId,
              type: 'modloader',
              modLoader: modpack.modLoader,
              stage: progress.stage || 'Установка модлоадера',
              percent: progress.percent || 0
            });
          }
        );
        console.log(`[INSTALL] ✓ Модлоадер ${modpack.modLoader} установлен`);
      } else {
        console.log(`[INSTALL] ✓ Модлоадер ${modpack.modLoader} уже установлен, пропускаем`);
        mainWindow.webContents.send('download-progress', {
          modpackId: modpackId,
          type: 'modloader',
          modLoader: modpack.modLoader,
          stage: 'Модлоадер уже установлен',
          percent: 100
        });
      }
    }

    // 4. Установка модов/контента
    const instanceDir = path.join(getLauncherDir(), 'instances', modpackId);
    await fs.ensureDir(instanceDir);
    console.log(`[INSTALL] Директория сборки: ${instanceDir}`);

    // Способ 1: Из архива (приоритет)
    if (modpack.archiveUrl) {
      console.log(`[INSTALL] Установка из архива: ${modpack.archiveUrl}`);
      mainWindow.webContents.send('install-status', {
        modpackId: modpackId,
        status: 'installing-archive'
      });

      await archiveDownloader.downloadAndExtract(
        modpack.archiveUrl,
        instanceDir,
        (progress) => {
          mainWindow.webContents.send('download-progress', {
            modpackId: modpackId,
            type: 'archive',
            stage: progress.stage || 'Загрузка архива сборки',
            percent: progress.percent || 0
          });
        }
      );

      console.log(`[INSTALL] ✓ Архив установлен`);

    // Способ 2: Отдельные моды
    } else if (modpack.mods && modpack.mods.length > 0) {
      console.log(`[INSTALL] Установка ${modpack.mods.length} модов`);
      mainWindow.webContents.send('install-status', {
        modpackId: modpackId,
        status: 'installing-mods'
      });

      await modsDownloader.downloadMods(
        modpack.mods,
        instanceDir,
        (progress) => {
          mainWindow.webContents.send('download-progress', {
            modpackId: modpackId,
            type: 'mods',
            stage: progress.stage || 'Загрузка модов',
            percent: progress.percent || 0
          });
        }
      );

      console.log(`[INSTALL] ✓ Моды установлены`);
    } else {
      console.log(`[INSTALL] Сборка без дополнительного контента (только модлоадер)`);
    }

    // Отметить сборку как установленную
    modpack.installed = true;
    configManager.updateModpack(modpackId, modpack);

    mainWindow.webContents.send('install-status', {
      modpackId: modpackId,
      status: 'completed'
    });

    console.log(`[INSTALL] ✓ Сборка "${modpack.name}" успешно установлена!`);
    return { success: true };

  } catch (error) {
    console.error('[INSTALL] Ошибка установки:', error);

    // Отправляем статус ошибки
    mainWindow.webContents.send('install-status', {
      modpackId: modpackId,
      status: 'error',
      error: error.message
    });

    // Формируем понятное сообщение об ошибке
    let userMessage = 'Ошибка установки';

    if (error.message.includes('JSON')) {
      userMessage = 'Ошибка скачивания файлов конфигурации. Проверьте интернет-соединение и попробуйте снова.';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      userMessage = 'Не удалось подключиться к серверам Mojang. Проверьте интернет-соединение.';
    } else if (error.message.includes('404')) {
      userMessage = 'Файлы версии не найдены на сервере Mojang. Возможно, версия больше не поддерживается.';
    } else if (error.message.includes('ENOSPC')) {
      userMessage = 'Недостаточно места на диске для установки.';
    } else if (error.message.includes('ENOENT') && error.message.includes('forge-installer.jar')) {
      userMessage = 'Ошибка установки Forge. Файл установщика не найден. Попробуйте переустановить сборку.';
    }

    throw new Error(`${userMessage}\n\nТехнические детали: ${error.message}`);
  }
});

// ===== Управление окном (для frameless окна) =====
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

console.log('Minecraft Launcher started successfully');
