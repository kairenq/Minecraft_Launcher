const path = require('path');
const fs = require('fs-extra');
const { spawn, execSync } = require('child_process');

class Bridge {
  constructor(launcherDir, mainWindow) {
    this.launcherDir = launcherDir;
    this.mainWindow = mainWindow;
    this.configPath = path.join(launcherDir, 'config.json');
    this.modpacksPath = path.join(launcherDir, 'modpacks.json');
    this.instancesDir = path.join(launcherDir, 'instances');
    this.versionsDir = path.join(launcherDir, 'versions');
    this.javaDir = path.join(launcherDir, 'java');
    
    // Создаем необходимые директории
    fs.ensureDirSync(this.launcherDir);
    fs.ensureDirSync(this.instancesDir);
    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.javaDir);
    
    // Инициализируем конфиг по умолчанию
    this.initConfig();
  }

  initConfig() {
    if (!fs.existsSync(this.configPath)) {
      const defaultConfig = {
        username: 'Player',
        allocatedMemory: 2048,
        windowWidth: 1200,
        windowHeight: 750,
        theme: 'dark',
        background: 'none',
        customBackgrounds: [],
        customization: {
          accentColor: '#00d9ff',
          cardSize: 'medium',
          viewMode: 'grid',
          glassmorphism: false
        }
      };
      fs.writeJsonSync(this.configPath, defaultConfig, { spaces: 2 });
    }

    if (!fs.existsSync(this.modpacksPath)) {
      const defaultModpacks = [];
      fs.writeJsonSync(this.modpacksPath, defaultModpacks, { spaces: 2 });
    }
  }

  // Конфигурация
  getConfig() {
    try {
      return fs.readJsonSync(this.configPath);
    } catch (error) {
      console.error('Failed to read config:', error);
      return this.initConfig();
    }
  }

  saveConfig(config) {
    try {
      fs.writeJsonSync(this.configPath, config, { spaces: 2 });
      
      // Применяем изменение размера окна
      if (this.mainWindow) {
        this.mainWindow.setSize(config.windowWidth, config.windowHeight);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Failed to save config:', error);
      return { success: false, error: error.message };
    }
  }

  // Модпаки
  getModpacks() {
    try {
      return fs.readJsonSync(this.modpacksPath);
    } catch (error) {
      console.error('Failed to read modpacks:', error);
      return [];
    }
  }

  addModpack(modpack) {
    try {
      const modpacks = this.getModpacks();
      modpacks.push(modpack);
      fs.writeJsonSync(this.modpacksPath, modpacks, { spaces: 2 });
      return { success: true };
    } catch (error) {
      console.error('Failed to add modpack:', error);
      return { success: false, error: error.message };
    }
  }

  updateModpack(id, updatedModpack) {
    try {
      const modpacks = this.getModpacks();
      const index = modpacks.findIndex(m => m.id === id);
      if (index !== -1) {
        modpacks[index] = { ...modpacks[index], ...updatedModpack };
        fs.writeJsonSync(this.modpacksPath, modpacks, { spaces: 2 });
        return { success: true };
      }
      return { success: false, error: 'Modpack not found' };
    } catch (error) {
      console.error('Failed to update modpack:', error);
      return { success: false, error: error.message };
    }
  }

  // Избранное
  toggleFavorite(modpackId) {
    const config = this.getConfig();
    if (!config.favorites) config.favorites = [];
    
    const index = config.favorites.indexOf(modpackId);
    if (index === -1) {
      config.favorites.push(modpackId);
    } else {
      config.favorites.splice(index, 1);
    }
    
    this.saveConfig(config);
    return { isFavorite: index === -1 };
  }

  getFavorites() {
    const config = this.getConfig();
    return config.favorites || [];
  }

  // История
  addToHistory(modpackId) {
    const config = this.getConfig();
    if (!config.history) config.history = [];
    
    // Удаляем если уже есть
    const index = config.history.indexOf(modpackId);
    if (index !== -1) {
      config.history.splice(index, 1);
    }
    
    // Добавляем в начало
    config.history.unshift(modpackId);
    
    // Ограничиваем историю 50 элементами
    config.history = config.history.slice(0, 50);
    
    this.saveConfig(config);
    return { success: true };
  }

  getHistory(limit = 10) {
    const config = this.getConfig();
    const history = config.history || [];
    return limit ? history.slice(0, limit) : history;
  }

  clearHistory() {
    const config = this.getConfig();
    config.history = [];
    this.saveConfig(config);
    return { success: true };
  }

  // Статистика
  updateStats(modpackId, playtime) {
    const config = this.getConfig();
    if (!config.stats) config.stats = {};
    if (!config.stats[modpackId]) config.stats[modpackId] = { launches: 0, playtime: 0 };
    
    config.stats[modpackId].launches += 1;
    config.stats[modpackId].playtime += playtime;
    
    this.saveConfig(config);
    return { success: true };
  }

  getStats(modpackId) {
    const config = this.getConfig();
    const stats = config.stats || {};
    return stats[modpackId] || { launches: 0, playtime: 0 };
  }

  getAllStats() {
    const config = this.getConfig();
    return config.stats || {};
  }

  // Кастомизация
  updateCustomization(updates) {
    const config = this.getConfig();
    config.customization = { ...config.customization, ...updates };
    this.saveConfig(config);
    return { success: true };
  }

  getCustomization() {
    const config = this.getConfig();
    return config.customization || {};
  }

  // Java
  async checkJava() {
    try {
      // Проверяем системную Java
      execSync('java -version', { stdio: 'ignore' });
      return { installed: true, isSystem: true };
    } catch (error) {
      // Проверяем Java в директории лаунчера
      const bundledJavaPath = this.getBundledJavaPath();
      if (fs.existsSync(bundledJavaPath)) {
        return { installed: true, isSystem: false };
      }
      return { installed: false };
    }
  }

  getBundledJavaPath() {
    const platform = process.platform;
    if (platform === 'win32') {
      return path.join(this.javaDir, 'bin', 'java.exe');
    } else if (platform === 'darwin') {
      return path.join(this.javaDir, 'Contents', 'Home', 'bin', 'java');
    } else {
      return path.join(this.javaDir, 'bin', 'java');
    }
  }

  async downloadJava() {
    return new Promise((resolve, reject) => {
      // Здесь будет вызов C++ модуля для загрузки Java
      // Пока используем заглушку
      const simulateProgress = () => {
        let progress = 0;
        const interval = setInterval(() => {
          progress += 10;
          this.sendProgress('java', 'Загрузка Java', progress);
          
          if (progress >= 100) {
            clearInterval(interval);
            this.sendProgress('java', 'Установка Java', 100);
            setTimeout(() => resolve({ success: true }), 1000);
          }
        }, 200);
      };
      
      simulateProgress();
    });
  }

  // Minecraft
  async checkMinecraft(version) {
    const versionDir = path.join(this.versionsDir, version);
    return fs.existsSync(versionDir);
  }

  async downloadMinecraft(version) {
    return new Promise((resolve, reject) => {
      // Здесь будет вызов C++ модуля
      const simulateProgress = () => {
        let progress = 0;
        const interval = setInterval(() => {
          progress += 5;
          this.sendProgress('minecraft', `Загрузка Minecraft ${version}`, progress, version);
          
          if (progress >= 100) {
            clearInterval(interval);
            this.sendProgress('minecraft', 'Установка Minecraft', 100, version);
            setTimeout(() => resolve({ success: true }), 1000);
          }
        }, 200);
      };
      
      simulateProgress();
    });
  }

  // Установка сборки
  async installModpack(modpackId) {
    return new Promise(async (resolve, reject) => {
      try {
        const modpacks = this.getModpacks();
        const modpack = modpacks.find(m => m.id === modpackId);
        
        if (!modpack) {
          reject(new Error('Modpack not found'));
          return;
        }

        this.sendInstallStatus(modpackId, 'downloading-java');
        
        // 1. Проверка и установка Java
        const javaStatus = await this.checkJava();
        if (!javaStatus.installed) {
          await this.downloadJava();
        } else {
          this.sendProgress('java', 'Java уже установлена', 100);
        }

        // 2. Установка Minecraft
        this.sendInstallStatus(modpackId, 'downloading-minecraft');
        const mcInstalled = await this.checkMinecraft(modpack.minecraftVersion);
        if (!mcInstalled) {
          await this.downloadMinecraft(modpack.minecraftVersion);
        } else {
          this.sendProgress('minecraft', 'Minecraft уже установлен', 100, modpack.minecraftVersion);
        }

        // 3. Установка модлоадера
        if (modpack.modLoader && modpack.modLoader !== 'vanilla') {
          this.sendInstallStatus(modpackId, 'installing-modloader');
          // Здесь будет вызов C++ модуля для установки модлоадера
          this.sendProgress('modloader', `Установка ${modpack.modLoader}`, 100, modpack.modLoader);
        }

        // 4. Установка модов
        this.sendInstallStatus(modpackId, 'installing-mods');
        // Здесь будет вызов C++ модуля для установки модов

        // Помечаем сборку как установленную
        modpack.installed = true;
        this.updateModpack(modpackId, modpack);

        this.sendInstallStatus(modpackId, 'completed');
        resolve({ success: true });

      } catch (error) {
        this.sendInstallStatus(modpackId, 'error', error.message);
        reject(error);
      }
    });
  }

  // Запуск Minecraft
  async launchMinecraft(options) {
    return new Promise((resolve, reject) => {
      // Здесь будет вызов C++ модуля для запуска
      // Пока используем заглушку
      setTimeout(() => {
        this.mainWindow.webContents.send('game-started', { pid: 12345 });
        resolve({ success: true, pid: 12345 });
      }, 2000);
    });
  }

  // Вспомогательные методы для отправки событий
  sendProgress(type, stage, percent, version = null, modLoader = null) {
    const data = { type, stage, percent };
    if (version) data.version = version;
    if (modLoader) data.modLoader = modLoader;
    
    this.mainWindow.webContents.send('download-progress', data);
  }

  sendInstallStatus(modpackId, status, error = null) {
    const data = { modpackId, status };
    if (error) data.error = error;
    
    this.mainWindow.webContents.send('install-status', data);
  }

  getModpack(modpackId) {
    const modpacks = this.getModpacks();
    return modpacks.find(m => m.id === modpackId);
  }
}

module.exports = { Bridge };
