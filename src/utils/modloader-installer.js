const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const ForgeInstaller = require('./forge-installer'); // Добавляем импорт

class ModLoaderInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.forgeInstaller = new ForgeInstaller(launcherDir); // Создаем экземпляр

    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.librariesDir);

    // Максимальная скорость - агрессивные настройки
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

      // МАКСИМАЛЬНАЯ СКОРОСТЬ - 50 параллельных загрузок
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
   * Установка Forge - используем новый ForgeInstaller
   */
  async installForge(minecraftVersion, forgeVersion, onProgress) {
    try {
      console.log('[FORGE] Используем новый установщик Forge...');
      
      // Если версия не указана - получаем рекомендованную
      if (!forgeVersion) {
        console.log('[FORGE] Версия не указана, получаем рекомендованную...');
        forgeVersion = await this.getRecommendedForgeVersion(minecraftVersion);
        console.log(`[FORGE] Выбрана версия: ${forgeVersion}`);
      }

      // Используем новый ForgeInstaller
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
        mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher' // Forge 1.17+ использует этот класс
      };

    } catch (error) {
      console.error('[FORGE] Ошибка установки:', error.message);
      
      // Пробуем старый метод как fallback
      console.log('[FORGE] Пробуем старый метод установки...');
      try {
        return await this.installForgeLegacy(minecraftVersion, forgeVersion, onProgress);
      } catch (fallbackError) {
        throw new Error(`Не удалось установить Forge: ${error.message}\nFallback также не удался: ${fallbackError.message}`);
      }
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
   * Старый метод установки Forge (как fallback)
   */
  async installForgeLegacy(minecraftVersion, forgeVersion, onProgress) {
    onProgress({ stage: 'Получение данных Forge', percent: 0 });

    const fullForgeVersion = `${minecraftVersion}-${forgeVersion}`;
    const versionId = `${minecraftVersion}-forge-${forgeVersion}`;
    const versionDir = path.join(this.versionsDir, versionId);

    // Проверяем уже установленный
    if (fs.existsSync(path.join(versionDir, `${versionId}.json`))) {
      console.log('[FORGE] Уже установлен, пропускаем');
      onProgress({ stage: 'Forge уже установлен', percent: 100 });
      return { success: true, versionId: versionId };
    }

    onProgress({ stage: 'Загрузка манифеста Forge', percent: 10 });

    // Пробуем скачать манифест Forge
    const manifestUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}.json`;
    
    let forgeManifest;
    try {
      console.log(`[FORGE] Загрузка манифеста: ${manifestUrl}`);
      const response = await axios.get(manifestUrl, this.axiosConfig);
      forgeManifest = response.data;
      console.log('[FORGE] ✓ Манифест загружен');
    } catch (error) {
      console.warn('[FORGE] Не удалось загрузить манифест, создаём базовый:', error.message);
      forgeManifest = await this.createBasicForgeManifest(minecraftVersion, forgeVersion);
    }

    onProgress({ stage: 'Создание профиля Forge', percent: 20 });

    await fs.ensureDir(versionDir);

    // Сохраняем JSON профиль
    const versionJsonPath = path.join(versionDir, `${versionId}.json`);
    await fs.writeJson(versionJsonPath, forgeManifest, { spaces: 2 });
    console.log(`[FORGE] Профиль сохранён`);

    onProgress({ stage: 'Загрузка библиотек Forge', percent: 30 });

    // Скачиваем только критические библиотеки
    const criticalLibraries = (forgeManifest.libraries || [])
      .filter(lib => this.isCriticalForgeLibrary(lib.name));
    
    console.log(`[FORGE] Критических библиотек для загрузки: ${criticalLibraries.length}`);

    const limit = pLimit(10);
    let downloaded = 0;

    const downloadTasks = criticalLibraries.map(lib => {
      return limit(async () => {
        try {
          if (lib.downloads && lib.downloads.artifact) {
            const artifact = lib.downloads.artifact;
            const fullPath = path.join(this.librariesDir, artifact.path.split('/').join(path.sep));

            if (!fs.existsSync(fullPath)) {
              await fs.ensureDir(path.dirname(fullPath));
              
              const libResponse = await axios({
                url: artifact.url,
                method: 'GET',
                responseType: 'stream',
                timeout: 60000,
                ...this.axiosConfig
              });

              const writer = fs.createWriteStream(fullPath);
              await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                libResponse.data.pipe(writer);
              });

              console.log(`[FORGE] ✓ ${path.basename(fullPath)} загружен`);
            }
          }
        } catch (err) {
          console.warn(`[FORGE] Не удалось загрузить библиотеку ${lib.name}:`, err.message);
        }

        downloaded++;
        const progress = 30 + ((downloaded / criticalLibraries.length) * 65);
        onProgress({
          stage: `Библиотеки Forge (${downloaded}/${criticalLibraries.length})`,
          percent: Math.floor(progress)
        });
      });
    });

    await Promise.all(downloadTasks);

    onProgress({ stage: 'Forge установлен', percent: 100 });
    console.log('[FORGE] ✓ Установка завершена');

    return {
      success: true,
      versionId: versionId,
      mainClass: forgeManifest.mainClass || 'net.minecraft.client.main.Main'
    };
  }

  /**
   * Проверка, является ли библиотека критической для Forge
   */
  isCriticalForgeLibrary(libName) {
    const criticalLibs = [
      'net.minecraftforge:fmlcore:',
      'net.minecraftforge:fmlloader:',
      'net.minecraftforge:javafmllanguage:',
      'net.minecraftforge:lowcodelanguage:',
      'net.minecraftforge:mclanguage:',
      'cpw.mods:bootstraplauncher:',
      'cpw.mods:securejarhandler:'
    ];
    
    return criticalLibs.some(critical => libName.includes(critical));
  }

  /**
   * Создание базового манифеста Forge
   */
  async createBasicForgeManifest(minecraftVersion, forgeVersion) {
    const versionId = `${minecraftVersion}-forge-${forgeVersion}`;
    
    return {
      id: versionId,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "release",
      mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
      arguments: {
        game: [],
        jvm: [
          "-Djava.library.path=${natives_directory}",
          "-Dminecraft.launcher.brand=${launcher_name}",
          "-Dminecraft.launcher.version=${launcher_version}",
          "-cp",
          "${classpath}"
        ]
      },
      libraries: [
        {
          name: `net.minecraftforge:fmlcore:${minecraftVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:fmlloader:${minecraftVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:javafmllanguage:${minecraftVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:lowcodelanguage:${minecraftVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:mclanguage:${minecraftVersion}-${forgeVersion}`
        },
        {
          name: `cpw.mods:bootstraplauncher:1.0.0`
        },
        {
          name: `cpw.mods:securejarhandler:1.0.8`
        }
      ]
    };
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
      // Используем метод из ForgeInstaller
      const forgeId = `${minecraftVersion}-forge-${modLoaderVersion}`;
      const forgeDir = path.join(this.versionsDir, forgeId);
      
      return await fs.pathExists(forgeDir) && 
             await fs.pathExists(path.join(forgeDir, `${forgeId}.json`));
    }

    return false;
  }
}

module.exports = ModLoaderInstaller;
