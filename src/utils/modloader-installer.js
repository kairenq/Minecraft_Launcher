const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const ForgeInstaller = require('./forge-installer'); // ИСПОЛЬЗУЕМ ForgeInstaller вместо ForgeDownloader

class ModLoaderInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.forgeInstaller = new ForgeInstaller(launcherDir); // ИСПОЛЬЗУЕМ ForgeInstaller

    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.librariesDir);

    this.axiosConfig = {
      timeout: 30000,
      maxRedirects: 10,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
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
   * Установка Forge - используем ForgeInstaller
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

      // ИСПОЛЬЗУЕМ ForgeInstaller для установки
      const versionId = await this.forgeInstaller.installForge(
        minecraftVersion, 
        forgeVersion, 
        onProgress
      );

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
   * Получение рекомендованной версии Forge
   */
  async getRecommendedForgeVersion(minecraftVersion) {
    try {
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
      // Проверяем через ForgeInstaller
      const forgeId = `${minecraftVersion}-forge-${modLoaderVersion}`;
      const forgeDir = path.join(this.versionsDir, forgeId);
      
      return await fs.pathExists(forgeDir) && 
             await fs.pathExists(path.join(forgeDir, `${forgeId}.json`));
    }

    return false;
  }
}

module.exports = ModLoaderInstaller;
