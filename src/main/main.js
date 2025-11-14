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

let mainWindow;
let configManager;
let minecraftDownloader;
let javaDownloader;
let minecraftLauncher;
let modLoaderInstaller;
let modsDownloader;

// Получение пути к директории лаунчера
function getLauncherDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, '.minecraft-custom-launcher');
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
    frame: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../../assets/icon.png')
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

    // 1. Проверка и загрузка Java
    const javaInstalled = await javaDownloader.checkJava();
    if (!javaInstalled) {
      mainWindow.webContents.send('install-status', {
        modpackId: modpackId,
        status: 'downloading-java'
      });

      await new Promise((resolve, reject) => {
        javaDownloader.download(
          (progress) => {
            mainWindow.webContents.send('download-progress', {
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
    }

    // 2. Загрузка Minecraft
    mainWindow.webContents.send('install-status', {
      modpackId: modpackId,
      status: 'downloading-minecraft'
    });

    const minecraftInstalled = await minecraftDownloader.checkMinecraft(modpack.minecraftVersion);
    if (!minecraftInstalled) {
      await new Promise((resolve, reject) => {
        minecraftDownloader.download(
          modpack.minecraftVersion,
          (progress) => {
            mainWindow.webContents.send('download-progress', {
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
    }

    // 3. Установка модлоадера (Forge/Fabric)
    if (modpack.modLoader && modpack.modLoader !== 'vanilla') {
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
            type: 'modloader',
            modLoader: modpack.modLoader,
            stage: progress.stage || 'Установка модлоадера',
            percent: progress.percent || 0
          });
        }
      );
    }

    // 4. Установка модов (если есть)
    if (modpack.mods && modpack.mods.length > 0) {
      mainWindow.webContents.send('install-status', {
        modpackId: modpackId,
        status: 'installing-mods'
      });

      const instanceDir = path.join(getLauncherDir(), 'instances', modpackId);
      await fs.ensureDir(instanceDir);

      await modsDownloader.downloadMods(
        modpack.mods,
        instanceDir,
        (progress) => {
          mainWindow.webContents.send('download-progress', {
            type: 'mods',
            stage: progress.stage || 'Загрузка модов',
            percent: progress.percent || 0
          });
        }
      );
    }

    // Отметить сборку как установленную
    modpack.installed = true;
    configManager.updateModpack(modpackId, modpack);

    mainWindow.webContents.send('install-status', {
      modpackId: modpackId,
      status: 'completed'
    });

    return { success: true };
  } catch (error) {
    console.error('Ошибка установки:', error);

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
    }

    throw new Error(`${userMessage}\n\nТехнические детали: ${error.message}`);
  }
});

console.log('Minecraft Launcher started successfully');
