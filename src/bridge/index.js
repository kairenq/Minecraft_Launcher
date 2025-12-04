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
    
    // Создаем необходимые директории
    fs.ensureDirSync(this.launcherDir);
    fs.ensureDirSync(this.instancesDir);
    
    // Инициализируем конфиг по умолчанию
    this.initConfig();
    
    // Загружаем нативные модули C++
    this.loadNativeModule();
  }

  async loadNativeModule() {
    try {
      // Путь к скомпилированному модулю
      const nativeModulePath = path.join(__dirname, '../core/build/Release/launcher_core.node');
      if (fs.existsSync(nativeModulePath)) {
        this.nativeModule = require(nativeModulePath);
        console.log('Native C++ module loaded successfully');
      } else {
        console.log('Native module not found, using JavaScript fallback');
        this.nativeModule = null;
      }
    } catch (error) {
      console.error('Failed to load native module:', error);
      this.nativeModule = null;
    }
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
        },
        favorites: [],
        history: [],
        stats: {}
      };
      fs.writeJsonSync(this.configPath, defaultConfig, { spaces: 2 });
    }

    if (!fs.existsSync(this.modpacksPath)) {
      // ТВОИ РЕАЛЬНЫЕ СБОРКИ
      const defaultModpacks = [
        {
          id: 'draconica_1.18.2',
          name: 'Draconica Modpack',
          description: 'Модпак в стиле средневековья с драконами и магией. Полностью переработанный мир с уникальными механиками и атмосферой.',
          minecraftVersion: '1.18.2',
          modLoader: 'forge',
          modLoaderVersion: '40.2.0',
          icon: 'https://raw.githubusercontent.com/kairenq/Minecraft_Launcher/main/assets/draconica_icon.png',
          archiveUrl: 'https://github.com/kairenq/Minecraft_Launcher/releases/download/v1.1.3/Draconica1.1.3.zip',
          installed: false,
          stats: {
            launches: 0,
            playtime: 0
          }
        },
        {
          id: 'skydustry',
          name: 'Skydustry',
          description: 'Парящий в облаках техномагический модпак с механикой полёта и автоматизацией. Уникальные биомы на летающих островах.',
          minecraftVersion: '1.20.1',
          modLoader: 'forge',
          modLoaderVersion: '47.2.0',
          icon: 'https://raw.githubusercontent.com/kairenq/Minecraft_Launcher/main/assets/skydustry_icon.png',
          archiveUrl: 'https://github.com/kairenq/Minecraft_Launcher/releases/download/v.1.0.0/Skydustry.zip',
          installed: false,
          stats: {
            launches: 0,
            playtime: 0
          }
        }
      ];
      
      // Проверяем установленные сборки
      defaultModpacks.forEach(modpack => {
        const instanceDir = path.join(this.instancesDir, modpack.id);
        if (fs.existsSync(instanceDir)) {
          const configFile = path.join(instanceDir, 'modpack.json');
          if (fs.existsSync(configFile)) {
            modpack.installed = true;
          }
        }
      });
      
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

  getModpack(modpackId) {
    const modpacks = this.getModpacks();
    return modpacks.find(m => m.id === modpackId);
  }

  updateModpack(modpackId, updatedModpack) {
    try {
      const modpacks = this.getModpacks();
      const index = modpacks.findIndex(m => m.id === modpackId);
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

  // Установка сборки с реальным скачиванием
  async installModpack(modpackId) {
    return new Promise(async (resolve, reject) => {
      try {
        const modpacks = this.getModpacks();
        const modpack = modpacks.find(m => m.id === modpackId);
        
        if (!modpack) {
          reject(new Error('Modpack not found'));
          return;
        }

        console.log(`\n=== НАЧАЛО УСТАНОВКИ СБОРКИ ===`);
        console.log(`Сборка: ${modpack.name} (${modpackId})`);
        console.log(`Minecraft: ${modpack.minecraftVersion}`);
        console.log(`Модлоадер: ${modpack.modLoader || 'vanilla'}`);
        console.log(`URL архива: ${modpack.archiveUrl}`);

        // 1. Создаем директорию для сборки
        this.sendInstallStatus(modpackId, 'preparing');
        const instanceDir = path.join(this.instancesDir, modpackId);
        await fs.ensureDir(instanceDir);
        console.log(`[INSTALL] Директория сборки: ${instanceDir}`);

        // 2. Скачиваем архив
        console.log(`[INSTALL] Скачивание архива: ${modpack.archiveUrl}`);
        this.sendInstallStatus(modpackId, 'downloading-archive');
        
        const archivePath = path.join(instanceDir, 'modpack.zip');
        
        // Используем native модуль если доступен, иначе fallback на JS
        if (this.nativeModule) {
          // Используем C++ для скачивания
          const success = await new Promise((resolve, reject) => {
            this.nativeModule.downloadFile(modpack.archiveUrl, archivePath, 
              (progress, stage) => {
                this.sendProgress('archive', stage, progress, modpack.minecraftVersion);
              },
              (error) => {
                if (error) reject(error);
                else resolve(true);
              }
            );
          });
          
          if (!success) {
            throw new Error('Failed to download archive with native module');
          }
        } else {
          // Fallback на JavaScript реализацию
          await this.downloadWithFallback(modpack.archiveUrl, archivePath, modpackId);
        }

        // 3. Распаковываем архив
        console.log(`[INSTALL] Распаковка архива`);
        this.sendInstallStatus(modpackId, 'extracting');
        
        const extract = require('extract-zip');
        await extract(archivePath, { dir: instanceDir });
        
        // Удаляем архив после распаковки
        await fs.remove(archivePath);

        // 4. Проверяем структуру и создаем .minecraft если нужно
        await this.fixMinecraftStructure(instanceDir);

        // 5. Создаем конфиг сборки
        modpack.installed = true;
        modpack.installDate = new Date().toISOString();
        modpack.installPath = instanceDir;
        
        await fs.writeJson(path.join(instanceDir, 'modpack.json'), modpack, { spaces: 2 });
        
        // Обновляем основной список
        await this.updateModpack(modpackId, modpack);

        // 6. Завершение
        this.sendInstallStatus(modpackId, 'completed');
        console.log(`[INSTALL] ✓ Сборка "${modpack.name}" успешно установлена!`);
        
        resolve({ success: true });

      } catch (error) {
        console.error('[INSTALL] Ошибка установки:', error);
        
        // Отправляем статус ошибки
        this.sendInstallStatus(modpackId, 'error', error.message);

        // Формируем понятное сообщение об ошибке
        let userMessage = 'Ошибка установки';
        if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
          userMessage = 'Не удалось подключиться к серверу. Проверьте интернет-соединение.';
        } else if (error.message.includes('404')) {
          userMessage = 'Архив сборки не найден на сервере.';
        } else if (error.message.includes('ENOSPC')) {
          userMessage = 'Недостаточно места на диске для установки.';
        }

        reject(new Error(`${userMessage}\n\nТехнические детали: ${error.message}`));
      }
    });
  }

  // Fallback скачивание на JS
  async downloadWithFallback(url, destination, modpackId) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const fs = require('fs');
      
      const file = fs.createWriteStream(destination);
      let receivedBytes = 0;
      let totalBytes = 0;
      
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        totalBytes = parseInt(response.headers['content-length'], 10);
        
        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            const progress = Math.round((receivedBytes / totalBytes) * 100);
            this.sendProgress('archive', `Загрузка: ${Math.round(receivedBytes / 1024 / 1024)}/${Math.round(totalBytes / 1024 / 1024)}MB`, progress);
          }
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log(`[DOWNLOAD] Файл скачан: ${receivedBytes} байт`);
          resolve();
        });
        
      }).on('error', (error) => {
        fs.unlink(destination, () => {}); // Удаляем частично скачанный файл
        reject(error);
      });
    });
  }

  // Исправление структуры .minecraft
  async fixMinecraftStructure(instanceDir) {
    console.log(`[FIX] Проверка структуры в: ${instanceDir}`);
    
    const files = await fs.readdir(instanceDir);
    const dirs = files.filter(file => {
      const stat = fs.statSync(path.join(instanceDir, file));
      return stat.isDirectory();
    });
    
    console.log(`[FIX] Найдено директорий: ${dirs.length}`);
    
    // Проверяем наличие .minecraft или похожей структуры
    let hasMinecraftDir = false;
    for (const dir of dirs) {
      if (dir === '.minecraft' || dir.toLowerCase().includes('minecraft')) {
        hasMinecraftDir = true;
        console.log(`[FIX] Найдена Minecraft директория: ${dir}`);
        break;
      }
    }
    
    // Если нет .minecraft, создаем структуру
    if (!hasMinecraftDir) {
      console.log(`[FIX] Создаем структуру .minecraft`);
      const mcDir = path.join(instanceDir, '.minecraft');
      await fs.ensureDir(mcDir);
      
      // Создаем поддиректории
      const subdirs = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves', 'logs'];
      for (const subdir of subdirs) {
        await fs.ensureDir(path.join(mcDir, subdir));
      }
      
      // Если в корне есть моды, перемещаем их
      const rootMods = path.join(instanceDir, 'mods');
      if (await fs.pathExists(rootMods)) {
        console.log(`[FIX] Перемещаем моды из корня в .minecraft/mods`);
        const mcMods = path.join(mcDir, 'mods');
        const modFiles = await fs.readdir(rootMods);
        
        for (const modFile of modFiles) {
          const src = path.join(rootMods, modFile);
          const dst = path.join(mcMods, modFile);
          await fs.move(src, dst, { overwrite: true });
        }
        
        await fs.remove(rootMods);
      }
      
      // Перемещаем другие возможные файлы
      for (const dir of dirs) {
        if (dir !== 'mods') {
          const src = path.join(instanceDir, dir);
          const dst = path.join(mcDir, dir);
          await fs.move(src, dst, { overwrite: true });
        }
      }
    }
    
    console.log(`[FIX] Структура исправлена`);
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
}

module.exports = { Bridge };