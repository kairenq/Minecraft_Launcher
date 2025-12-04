const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const ForgeInstaller = require('./forge-installer');

class ModLoaderInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.forgeInstaller = new ForgeInstaller(launcherDir);

    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.librariesDir);

    this.axiosConfig = {
      timeout: 30000,
      maxRedirects: 10,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
  }

  /**
   * Установка модлоадера (Forge или Fabric)
   */
  async install(modLoader, minecraftVersion, modLoaderVersion, onProgress) {
    console.log(`\n=== УСТАНОВКА MODLOADER ===`);
    console.log(`Тип: ${modLoader}`);
    console.log(`Minecraft: ${minecraftVersion}`);
    console.log(`Версия модлоадера: ${modLoaderVersion || 'auto'}`);

    if (modLoader === 'vanilla') {
      console.log('Vanilla Minecraft - модлоадер не требуется');
      return { success: true };
    }

    if (modLoader === 'fabric') {
      return await this.installFabric(minecraftVersion, modLoaderVersion, onProgress);
    } else if (modLoader === 'forge') {
      return await this.installForge(minecraftVersion, modLoaderVersion, onProgress);
    } else {
      throw new Error(`Неизвестный модлоадер: ${modLoader}`);
    }
  }

  /**
   * Установка Fabric - полностью автоматическая
   */
  async installFabric(minecraftVersion, loaderVersion, onProgress) {
    try {
      onProgress({ stage: 'Получение данных Fabric', percent: 0 });

      // Если версия не указана - берём последнюю стабильную
      if (!loaderVersion) {
        console.log('[FABRIC] Версия не указана, получаем последнюю...');
        const loaders = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}`, this.axiosConfig);
        if (loaders.data.length === 0) {
          throw new Error(`Fabric не найден для Minecraft ${minecraftVersion}`);
        }
        loaderVersion = loaders.data[0].loader.version;
        console.log(`[FABRIC] Выбрана версия: ${loaderVersion}`);
      }

      const versionId = `fabric-loader-${loaderVersion}-${minecraftVersion}`;
      const versionDir = path.join(this.versionsDir, versionId);

      // Проверяем уже установленный
      if (fs.existsSync(path.join(versionDir, `${versionId}.json`))) {
        console.log('[FABRIC] Уже установлен, пропускаем');
        onProgress({ stage: 'Fabric уже установлен', percent: 100 });
        return { success: true, versionId: versionId };
      }

      // Скачиваем профиль Fabric
      onProgress({ stage: 'Загрузка профиля Fabric', percent: 10 });
      const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}/${loaderVersion}/profile/json`;
      console.log(`[FABRIC] Загрузка профиля: ${profileUrl}`);

      const response = await axios.get(profileUrl, this.axiosConfig);
      const fabricProfile = response.data;

      await fs.ensureDir(versionDir);

      // Сохраняем JSON профиль
      const versionJsonPath = path.join(versionDir, `${versionId}.json`);
      await fs.writeJson(versionJsonPath, fabricProfile, { spaces: 2 });
      console.log(`[FABRIC] Профиль сохранён`);

      onProgress({ stage: 'Загрузка библиотек Fabric', percent: 30 });

      // Скачиваем библиотеки Fabric параллельно
      const libraries = fabricProfile.libraries || [];
      console.log(`[FABRIC] Библиотек для загрузки: ${libraries.length}`);

      const limit = pLimit(50);
      let downloaded = 0;

      const downloadTasks = libraries.map(lib => {
        return limit(async () => {
          if (lib.url && lib.name) {
            const parts = lib.name.split(':');
            if (parts.length < 3) {
              console.warn(`[FABRIC] Неверный формат библиотеки: ${lib.name}`);
              return;
            }
            const [group, artifact, version] = parts;
            const groupPath = group.replace(/\./g, '/');
            const libPath = `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;
            const fullPath = path.join(this.librariesDir, groupPath.replace(/\//g, path.sep), artifact, version, `${artifact}-${version}.jar`);

            if (!fs.existsSync(fullPath)) {
              const url = `${lib.url}${libPath}`;

              try {
                await fs.ensureDir(path.dirname(fullPath));
                const libResponse = await axios({
                  url: url,
                  method: 'GET',
                  responseType: 'stream',
                  ...this.axiosConfig
                });

                const writer = fs.createWriteStream(fullPath);
                await new Promise((resolve, reject) => {
                  writer.on('finish', resolve);
                  writer.on('error', reject);
                  libResponse.data.pipe(writer);
                });
              } catch (err) {
                console.warn(`[FABRIC] Не удалось загрузить ${artifact}: ${err.message}`);
              }
            }

            downloaded++;
            const progress = 30 + ((downloaded / libraries.length) * 65);
            onProgress({
              stage: `Библиотеки Fabric (${downloaded}/${libraries.length})`,
              percent: Math.floor(progress)
            });
          }
        });
      });

      await Promise.all(downloadTasks);

      onProgress({ stage: 'Fabric установлен', percent: 100 });
      console.log('[FABRIC] ✓ Установка завершена');

      return {
        success: true,
        versionId: versionId,
        mainClass: fabricProfile.mainClass
      };

    } catch (error) {
      console.error('[FABRIC] Ошибка установки:', error.message);
      throw new Error(`Не удалось установить Fabric: ${error.message}`);
    }
  }

  /**
   * Установка Forge - с улучшенной проверкой
   */
  async installForge(minecraftVersion, forgeVersion, onProgress) {
    try {
      console.log('[FORGE] Используем ForgeInstaller...');
      
      // Если версия не указана - получаем рекомендованную
      if (!forgeVersion) {
        console.log('[FORGE] Версия не указана, получаем рекомендованную...');
        forgeVersion = await this.getRecommendedForgeVersion(minecraftVersion);
        console.log(`[FORGE] Выбрана версия: ${forgeVersion}`);
      }

      // Проверяем базовый Minecraft
      await this.checkBaseMinecraft(minecraftVersion);

      // ПРЯМОЙ ВЫЗОВ ForgeInstaller
      onProgress({ stage: 'Запуск установки Forge', percent: 5 });
      const versionId = await this.forgeInstaller.installForge(
        minecraftVersion, 
        forgeVersion, 
        onProgress
      );

      // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА после установки
      onProgress({ stage: 'Проверка установки', percent: 95 });
      await this.verifyForgeInstallation(versionId);

      onProgress({ stage: 'Forge установлен', percent: 100 });
      console.log('[FORGE] ✓ Установка завершена');

      return {
        success: true,
        versionId: versionId,
        mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher'
      };

    } catch (error) {
      console.error('[FORGE] Ошибка установки:', error.message);
      throw new Error(`Не удалось установить Forge: ${error.message}`);
    }
  }

  /**
   * Проверка базового Minecraft
   */
  async checkBaseMinecraft(minecraftVersion) {
    const baseVersionDir = path.join(this.versionsDir, minecraftVersion);
    const baseVersionJar = path.join(baseVersionDir, `${minecraftVersion}.jar`);

    if (!fs.existsSync(baseVersionJar)) {
      throw new Error(`Базовый Minecraft ${minecraftVersion} не установлен. Сначала установите Minecraft.`);
    }

    const stats = await fs.stat(baseVersionJar);
    if (stats.size < 1000000) {
      throw new Error(`Базовый Minecraft JAR поврежден (${(stats.size / 1024 / 1024).toFixed(2)} MB). Переустановите Minecraft.`);
    }

    console.log(`[FORGE] ✓ Базовый Minecraft найден: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }

  /**
   * Проверка установки Forge
   */
  async verifyForgeInstallation(versionId) {
    const forgeDir = path.join(this.versionsDir, versionId);
    const forgeJar = path.join(forgeDir, `${versionId}.jar`);
    const forgeJson = path.join(forgeDir, `${versionId}.json`);
    
    console.log(`[VERIFY] Проверка установки Forge ${versionId}...`);

    if (!fs.existsSync(forgeDir)) {
      throw new Error(`Папка Forge не создана: ${forgeDir}`);
    }

    if (!fs.existsSync(forgeJar)) {
      throw new Error(`Forge JAR не создан: ${forgeJar}`);
    }

    if (!fs.existsSync(forgeJson)) {
      throw new Error(`Forge JSON не создан: ${forgeJson}`);
    }

    const jarStats = await fs.stat(forgeJar);
    const jsonStats = await fs.stat(forgeJson);

    console.log(`[VERIFY] ✓ Forge JAR: ${(jarStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[VERIFY] ✓ Forge JSON: ${(jsonStats.size / 1024).toFixed(2)} KB`);

    if (jarStats.size < 1000) {
      console.warn(`[VERIFY] ⚠️  ВНИМАНИЕ: Forge JAR слишком маленький (${jarStats.size} байт)`);
      console.warn(`[VERIFY] ⚠️  Это может привести к ошибке при запуске!`);
    }

    // Проверяем что JSON валиден
    try {
      const jsonData = await fs.readJson(forgeJson);
      if (!jsonData.mainClass) {
        throw new Error('JSON не содержит mainClass');
      }
      console.log(`[VERIFY] ✓ JSON валиден, mainClass: ${jsonData.mainClass}`);
    } catch (error) {
      throw new Error(`Forge JSON поврежден: ${error.message}`);
    }

    console.log('[VERIFY] ✓ Forge установлен корректно');
  }

  /**
   * Получение рекомендованной версии Forge
   */
  async getRecommendedForgeVersion(minecraftVersion) {
    try {
      console.log('[FORGE] Получение рекомендованной версии...');
      
      const promotions = await axios.get(
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', 
        this.axiosConfig
      );
      
      const promoKey = `${minecraftVersion}-recommended`;
      let forgeVersion = promotions.data.promos[promoKey];

      if (!forgeVersion) {
        const latestKey = `${minecraftVersion}-latest`;
        forgeVersion = promotions.data.promos[latestKey];
      }

      if (!forgeVersion) {
        throw new Error(`Forge не найден для Minecraft ${minecraftVersion}`);
      }

      console.log(`[FORGE] Найдена версия: ${forgeVersion}`);
      return forgeVersion;
    } catch (error) {
      console.warn('[FORGE] Не удалось получить рекомендованную версию:', error.message);
      
      // Fallback версии для популярных версий Minecraft
      const fallbackVersions = {
        '1.18.2': '40.2.0',
        '1.19.2': '43.2.0',
        '1.19.4': '45.1.0',
        '1.20.1': '47.1.0',
        '1.20.4': '49.0.0'
      };
      
      if (fallbackVersions[minecraftVersion]) {
        console.log(`[FORGE] Используем fallback версию: ${fallbackVersions[minecraftVersion]}`);
        return fallbackVersions[minecraftVersion];
      }
      
      throw new Error(`Не удалось определить версию Forge для ${minecraftVersion}`);
    }
  }

  /**
   * Проверка установки модлоадера
   */
  async checkInstalled(modLoader, minecraftVersion, modLoaderVersion) {
    if (modLoader === 'vanilla') {
      return true;
    }

    if (modLoader === 'fabric') {
      const versionId = modLoaderVersion
        ? `fabric-loader-${modLoaderVersion}-${minecraftVersion}`
        : `fabric-loader-*-${minecraftVersion}`;

      const versionDir = path.join(this.versionsDir, versionId);
      if (fs.existsSync(versionDir)) {
        return true;
      }

      const versions = fs.readdirSync(this.versionsDir);
      for (const v of versions) {
        if (v.startsWith('fabric-loader-') && v.endsWith(`-${minecraftVersion}`)) {
          return true;
        }
      }

      return false;
    }

    if (modLoader === 'forge') {
      // Определяем версию Forge
      let forgeVersion = modLoaderVersion;
      if (!forgeVersion) {
        try {
          forgeVersion = await this.getRecommendedForgeVersion(minecraftVersion);
        } catch (error) {
          console.warn('[CHECK] Не удалось определить версию Forge:', error.message);
          return false;
        }
      }

      const forgeId = `${minecraftVersion}-forge-${forgeVersion}`;
      const forgeDir = path.join(this.versionsDir, forgeId);
      const forgeJsonPath = path.join(forgeDir, `${forgeId}.json`);
      const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
      
      // Проверяем что оба файла существуют и не пустые
      const dirExists = await fs.pathExists(forgeDir);
      const jsonExists = await fs.pathExists(forgeJsonPath);
      const jarExists = await fs.pathExists(forgeJarPath);
      
      console.log(`[CHECK] Forge ${forgeId}: dir=${dirExists}, json=${jsonExists}, jar=${jarExists}`);
      
      if (!dirExists || !jsonExists || !jarExists) {
        return false;
      }

      // Проверяем размеры файлов
      try {
        const jarStats = await fs.stat(forgeJarPath);
        const jsonStats = await fs.stat(forgeJsonPath);
        
        if (jarStats.size < 1000) {
          console.warn(`[CHECK] ⚠️  Forge JAR слишком маленький: ${jarStats.size} байт`);
          return false;
        }
        
        if (jsonStats.size < 100) {
          console.warn(`[CHECK] ⚠️  Forge JSON слишком маленький: ${jsonStats.size} байт`);
          return false;
        }
        
        return true;
      } catch (error) {
        console.warn(`[CHECK] Ошибка проверки размеров: ${error.message}`);
        return false;
      }
    }

    return false;
  }
}

module.exports = ModLoaderInstaller;
