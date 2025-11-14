const fs = require('fs-extra');
const path = require('path');

class ConfigManager {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.configPath = path.join(launcherDir, 'config.json');
    this.modpacksPath = path.join(launcherDir, 'modpacks.json');

    this.ensureConfigExists();
  }

  getDefaultModpacks() {
    return [
      {
        id: 'vanilla-1-20-1',
        name: 'Minecraft 1.20.1',
        description: 'Последняя стабильная версия Minecraft. Включает новые биомы, мобов и блоки.',
        minecraftVersion: '1.20.1',
        modLoader: 'vanilla',  // 'vanilla', 'forge' или 'fabric'
        modLoaderVersion: null, // Версия модлоадера (для Forge/Fabric)
        installed: false,
        mods: []
      }
      // Чтобы добавить свою сборку, смотрите инструкцию в MODPACKS_GUIDE.md
      // Примеры с модами в MODPACKS_WITH_MODS_GUIDE.md
    ];
  }

  ensureConfigExists() {
    fs.ensureDirSync(this.launcherDir);

    // Создание базовой конфигурации
    if (!fs.existsSync(this.configPath)) {
      const defaultConfig = {
        username: 'Player',
        allocatedMemory: 2048, // MB
        windowWidth: 1200,
        windowHeight: 750,
        theme: 'dark',
        lastModpack: null,
        javaPath: null,
        configVersion: 2 // Версия конфигурации для миграций
      };
      fs.writeJsonSync(this.configPath, defaultConfig, { spaces: 2 });
    }

    // Обновление списка сборок - ВСЕГДА пересоздаем с актуальными версиями
    // Проверяем существующие установленные версии
    let installedStates = {};
    if (fs.existsSync(this.modpacksPath)) {
      try {
        const oldModpacks = fs.readJsonSync(this.modpacksPath);
        // Сохраняем статус установки для каждой версии
        oldModpacks.forEach(mp => {
          if (mp.installed && mp.id.startsWith('vanilla-')) {
            installedStates[mp.id] = true;
          }
        });
      } catch (e) {
        console.error('Error reading old modpacks:', e);
      }
    }

    // Создаем новый список с актуальными данными
    const defaultModpacks = this.getDefaultModpacks();
    // Восстанавливаем статусы установки
    defaultModpacks.forEach(mp => {
      if (installedStates[mp.id]) {
        mp.installed = true;
      }
    });

    fs.writeJsonSync(this.modpacksPath, defaultModpacks, { spaces: 2 });
    console.log('Modpacks list updated:', defaultModpacks.length, 'versions');
  }

  getConfig() {
    return fs.readJsonSync(this.configPath);
  }

  saveConfig(config) {
    fs.writeJsonSync(this.configPath, config, { spaces: 2 });
  }

  updateConfig(updates) {
    const config = this.getConfig();
    const newConfig = { ...config, ...updates };
    this.saveConfig(newConfig);
    return newConfig;
  }

  getModpacks() {
    return fs.readJsonSync(this.modpacksPath);
  }

  getModpack(id) {
    const modpacks = this.getModpacks();
    return modpacks.find(mp => mp.id === id);
  }

  addModpack(modpack) {
    const modpacks = this.getModpacks();
    modpacks.push(modpack);
    fs.writeJsonSync(this.modpacksPath, modpacks, { spaces: 2 });
  }

  updateModpack(id, updates) {
    const modpacks = this.getModpacks();
    const index = modpacks.findIndex(mp => mp.id === id);
    if (index !== -1) {
      modpacks[index] = { ...modpacks[index], ...updates };
      fs.writeJsonSync(this.modpacksPath, modpacks, { spaces: 2 });
    }
  }

  deleteModpack(id) {
    const modpacks = this.getModpacks();
    const filtered = modpacks.filter(mp => mp.id !== id);
    fs.writeJsonSync(this.modpacksPath, filtered, { spaces: 2 });
  }
}

module.exports = ConfigManager;
