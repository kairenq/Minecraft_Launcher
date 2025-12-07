const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');

// ========== ИСПРАВЛЕННЫЙ ИМПОРТ BRIDGE ==========
// Получаем правильный путь к bridge
function getBridgePath() {
  // В режиме разработки
  if (!app.isPackaged) {
    // Путь: src/ui -> src/bridge/index.js
    return path.join(__dirname, '..', 'bridge', 'index.js');
  }
  
  // В собранном приложении (внутри app.asar)
  // Все файлы src/ упакованы в app.asar
  return path.join(process.resourcesPath, 'app.asar', 'src', 'bridge', 'index.js');
}

// Загружаем bridge
const bridge = require(getBridgePath());
// ==============================================

let mainWindow;
let bridgeInstance;

// Получение пути к директории лаунчера
function getLauncherDir() {
  const homeDir = os.homedir();
  return path.join(homeDir, 'Aureate');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
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
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Убираем меню
  mainWindow.setMenu(null);

  // Открыть DevTools в режиме разработки
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Инициализация bridge
  const launcherDir = getLauncherDir();
  bridgeInstance = new bridge.Bridge(launcherDir, mainWindow);
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

// Конфигурация
ipcMain.handle('get-config', async () => {
  return bridgeInstance.getConfig();
});

ipcMain.handle('save-config', async (event, config) => {
  return bridgeInstance.saveConfig(config);
});

// Модпаки
ipcMain.handle('get-modpacks', async () => {
  return bridgeInstance.getModpacks();
});

ipcMain.handle('add-modpack', async (event, modpack) => {
  return bridgeInstance.addModpack(modpack);
});

ipcMain.handle('update-modpack', async (event, id, modpack) => {
  return bridgeInstance.updateModpack(id, modpack);
});

// Избранное
ipcMain.handle('toggle-favorite', async (event, modpackId) => {
  return bridgeInstance.toggleFavorite(modpackId);
});

ipcMain.handle('get-favorites', async () => {
  return bridgeInstance.getFavorites();
});

// История
ipcMain.handle('add-to-history', async (event, modpackId) => {
  return bridgeInstance.addToHistory(modpackId);
});

ipcMain.handle('get-history', async (event, limit) => {
  return bridgeInstance.getHistory(limit);
});

ipcMain.handle('clear-history', async () => {
  return bridgeInstance.clearHistory();
});

// Статистика
ipcMain.handle('update-stats', async (event, modpackId, playtime) => {
  return bridgeInstance.updateStats(modpackId, playtime);
});

ipcMain.handle('get-stats', async (event, modpackId) => {
  return bridgeInstance.getStats(modpackId);
});

ipcMain.handle('get-all-stats', async () => {
  return bridgeInstance.getAllStats();
});

// Кастомизация
ipcMain.handle('update-customization', async (event, updates) => {
  return bridgeInstance.updateCustomization(updates);
});

ipcMain.handle('get-customization', async () => {
  return bridgeInstance.getCustomization();
});

// Проверка и установка Java
ipcMain.handle('check-java', async () => {
  return bridgeInstance.checkJava();
});

ipcMain.handle('download-java', async (event) => {
  return bridgeInstance.downloadJava();
});

// Проверка и установка Minecraft
ipcMain.handle('check-minecraft', async (event, version) => {
  return bridgeInstance.checkMinecraft(version);
});

ipcMain.handle('download-minecraft', async (event, version) => {
  return bridgeInstance.downloadMinecraft(version);
});

// Установка сборки
ipcMain.handle('install-modpack', async (event, modpackId) => {
  return bridgeInstance.installModpack(modpackId);
});

// Запуск Minecraft
ipcMain.handle('launch-minecraft', async (event, options) => {
  return bridgeInstance.launchMinecraft(options);
});

// Системная информация
ipcMain.handle('get-system-info', async () => {
  const totalMemory = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMemory = Math.floor(os.freemem() / 1024 / 1024);

  return {
    platform: os.platform(),
    arch: os.arch(),
    totalMemory: totalMemory,
    freeMemory: freeMemory,
    cpus: os.cpus().length
  };
});

// Директории
ipcMain.handle('open-game-dir', async () => {
  shell.openPath(getLauncherDir());
  return { success: true };
});

ipcMain.handle('get-launcher-dir', async () => {
  return getLauncherDir();
});

// Управление окном
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
