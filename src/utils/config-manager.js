const fs = require('fs-extra');
const path = require('path');

class ConfigManager {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.configPath = path.join(launcherDir, 'config.json');
    this.modpacksPath = path.join(launcherDir, 'modpacks.json');

    this.ensureConfigExists();
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
        javaPath: null
      };
      fs.writeJsonSync(this.configPath, defaultConfig, { spaces: 2 });
    }

    // Создание списка сборок по умолчанию
    if (!fs.existsSync(this.modpacksPath)) {
      const defaultModpacks = [
        {
          id: 'vanilla-1-20-1',
          name: 'Minecraft 1.20.1',
          description: 'Последняя стабильная версия Minecraft. Включает новые биомы, мобов и блоки.',
          minecraftVersion: '1.20.1',
          installed: false,
          mods: []
        },
        {
          id: 'vanilla-1-19-4',
          name: 'Minecraft 1.19.4',
          description: 'The Wild Update - новые биомы болот и глубокой тьмы, Warden и Ancient Cities.',
          minecraftVersion: '1.19.4',
          installed: false,
          mods: []
        },
        {
          id: 'vanilla-1-18-2',
          name: 'Minecraft 1.18.2',
          description: 'Caves & Cliffs - обновленная генерация мира, новые пещеры и горы.',
          minecraftVersion: '1.18.2',
          installed: false,
          mods: []
        },
        {
          id: 'vanilla-1-16-5',
          name: 'Minecraft 1.16.5',
          description: 'Nether Update - обновленный ад с новыми биомами, мобами и блоками. Популярна для модов.',
          minecraftVersion: '1.16.5',
          installed: false,
          mods: []
        },
        {
          id: 'vanilla-1-12-2',
          name: 'Minecraft 1.12.2',
          description: 'Классическая версия с огромным количеством модов. Самая популярная версия для модпаков.',
          minecraftVersion: '1.12.2',
          installed: false,
          mods: []
        }
      ];
      fs.writeJsonSync(this.modpacksPath, defaultModpacks, { spaces: 2 });
    }
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
