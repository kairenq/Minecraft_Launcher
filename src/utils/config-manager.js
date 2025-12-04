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
        id: 'draconica-1-18-2',
        name: 'Draconica',
        description: 'Майнкрафт сборка с уклоном в приключения и технологии. Стало скучно и хочется развеяться? Время побегать по миру и заняться сражением с боссами, жуткими монстрами. Устал бегать? Можно заняться изучением индустриальных модов, сделать "бесконечный сундук", в виде МЭ системы, скрафтить сильнейшую броню и инструменты, научиться умножать руду! Сборка имеет более 150 различных модов и 180+ интереснейших квестов.',
        icon: 'assets/modpacks/draconica_logo.jpg',
        minecraftVersion: '1.18.2',
        modLoader: 'forge',
        modLoaderVersion: null,
        installed: false,
        archiveUrl: 'https://github.com/kairenq/Minecraft_Launcher/releases/download/v1.1.3/Draconica1.1.3.zip',
        mods: []
      },
      {
        id: 'skydustry-1-20-1',
        name: 'Skydustry',
        description: 'Тестовая сборка Minecraft 1.20.1 с модами на Forge. Индустриальная сборка с акцентом на автоматизацию, технологии и строительство. Создавайте сложные производственные цепочки, автоматизируйте процессы и стройте масштабные заводы!',
        icon: 'assets/modpacks/skydustry_logo.jpg',
        minecraftVersion: '1.20.1',
        modLoader: 'forge',
        modLoaderVersion: null,
        installed: false,
        archiveUrl: 'https://github.com/kairenq/Minecraft_Launcher/releases/download/v.1.0.0/Skydustry.zip',
        mods: []
      }
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
        configVersion: 3, // Версия конфигурации для миграций

        // Новые функции
        favorites: [], // Избранные сборки (массив ID)
        history: [], // История запусков {modpackId, timestamp, duration}
        stats: {}, // Статистика по сборкам {modpackId: {launches: number, playtime: number}}

        // Кастомизация
        customization: {
          accentColor: '#00d9ff', // Акцентный цвет
          cardSize: 'medium', // small, medium, large
          viewMode: 'grid', // grid, compact
          backgroundImage: null, // Путь к фоновому изображению
          glassmorphism: false, // Включить эффект glassmorphism
          animations: true // Включить анимации
        }
      };
      fs.writeJsonSync(this.configPath, defaultConfig, { spaces: 2 });
    } else {
      // Миграция существующей конфигурации
      const config = fs.readJsonSync(this.configPath);
      let needsUpdate = false;

      if (!config.configVersion || config.configVersion < 3) {
        // Добавляем новые поля если их нет
        if (!config.favorites) {
          config.favorites = [];
          needsUpdate = true;
        }
        if (!config.history) {
          config.history = [];
          needsUpdate = true;
        }
        if (!config.stats) {
          config.stats = {};
          needsUpdate = true;
        }
        if (!config.customization) {
          config.customization = {
            accentColor: '#00d9ff',
            cardSize: 'medium',
            viewMode: 'grid',
            backgroundImage: null,
            glassmorphism: false,
            animations: true
          };
          needsUpdate = true;
        }

        if (needsUpdate) {
          config.configVersion = 3;
          fs.writeJsonSync(this.configPath, config, { spaces: 2 });
          console.log('Config migrated to version 3');
        }
      }
    }

    // Обновление списка сборок - ВСЕГДА пересоздаем с актуальными версиями
    // Проверяем существующие установленные версии
    let installedStates = {};
    if (fs.existsSync(this.modpacksPath)) {
      try {
        const oldModpacks = fs.readJsonSync(this.modpacksPath);
        // Сохраняем статус установки для каждой версии
        oldModpacks.forEach(mp => {
          if (mp.installed) {
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

  // ===== Методы для работы с избранным =====

  toggleFavorite(modpackId) {
    const config = this.getConfig();
    const favorites = config.favorites || [];
    const index = favorites.indexOf(modpackId);

    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(modpackId);
    }

    this.updateConfig({ favorites });
    return favorites.includes(modpackId);
  }

  isFavorite(modpackId) {
    const config = this.getConfig();
    return (config.favorites || []).includes(modpackId);
  }

  getFavorites() {
    const config = this.getConfig();
    return config.favorites || [];
  }

  // ===== Методы для работы с историей =====

  addToHistory(modpackId) {
    const config = this.getConfig();
    const history = config.history || [];

    // Добавляем новую запись в историю
    history.unshift({
      modpackId,
      timestamp: Date.now()
    });

    // Ограничиваем историю 100 записями
    if (history.length > 100) {
      history.splice(100);
    }

    this.updateConfig({ history });
  }

  getHistory(limit = 10) {
    const config = this.getConfig();
    const history = config.history || [];
    return history.slice(0, limit);
  }

  clearHistory() {
    this.updateConfig({ history: [] });
  }

  // ===== Методы для работы со статистикой =====

  updateStats(modpackId, playtime = 0) {
    const config = this.getConfig();
    const stats = config.stats || {};

    if (!stats[modpackId]) {
      stats[modpackId] = {
        launches: 0,
        playtime: 0,
        lastPlayed: Date.now()
      };
    }

    stats[modpackId].launches += 1;
    stats[modpackId].playtime += playtime;
    stats[modpackId].lastPlayed = Date.now();

    this.updateConfig({ stats });
  }

  getStats(modpackId) {
    const config = this.getConfig();
    const stats = config.stats || {};
    return stats[modpackId] || { launches: 0, playtime: 0, lastPlayed: null };
  }

  getAllStats() {
    const config = this.getConfig();
    return config.stats || {};
  }

  // ===== Методы для работы с кастомизацией =====

  updateCustomization(updates) {
    const config = this.getConfig();
    const customization = { ...config.customization, ...updates };
    this.updateConfig({ customization });
    return customization;
  }

  getCustomization() {
    const config = this.getConfig();
    return config.customization || {
      accentColor: '#00d9ff',
      cardSize: 'medium',
      viewMode: 'grid',
      backgroundImage: null,
      glassmorphism: false,
      animations: true
    };
  }
}

module.exports = ConfigManager;
