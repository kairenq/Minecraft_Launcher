const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');

class ModLoaderInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');

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
   * Установка Forge - ПОЛНОСТЬЮ АВТОМАТИЧЕСКАЯ
   */
  async installForge(minecraftVersion, forgeVersion, onProgress) {
    try {
      onProgress({ stage: 'Получение данных Forge', percent: 0 });

      // Если версия не указана - берём рекомендованную
      if (!forgeVersion) {
        console.log('[FORGE] Версия не указана, получаем рекомендованную...');
        const promotions = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', this.axiosConfig);
        const promoKey = `${minecraftVersion}-recommended`;
        forgeVersion = promotions.data.promos[promoKey];

        if (!forgeVersion) {
          const latestKey = `${minecraftVersion}-latest`;
          forgeVersion = promotions.data.promos[latestKey];
        }

        if (!forgeVersion) {
          throw new Error(`Forge не найден для Minecraft ${minecraftVersion}`);
        }

        console.log(`[FORGE] Выбрана версия: ${forgeVersion}`);
      }

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

      // Пробуем несколько вариантов URL для манифеста Forge
      const possibleUrls = [
        // Современный формат
        `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}.json`,
        `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}.json`,

        // Формат с installer
        `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}-installer.json`,

        // Старые форматы
        `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}-universal.json`,
        `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}-universal.json`,

        // Альтернативные зеркала
        `https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}.json`
      ];

      let forgeManifest = null;
      let manifestUrl = null;

      for (const url of possibleUrls) {
        try {
          console.log(`[FORGE] Пробуем: ${url}`);
          const response = await axios.get(url, this.axiosConfig);
          forgeManifest = response.data;
          manifestUrl = url;
          console.log(`[FORGE] ✓ Манифест найден`);
          break;
        } catch (err) {
          console.log(`[FORGE] ❌ Не удалось загрузить с ${url}`);
        }
      }

      if (!forgeManifest) {
        // Альтернативный метод - создаём минимальный манифест вручную
        console.log('[FORGE] Создаём манифест вручную...');
        forgeManifest = await this.createForgeManifest(minecraftVersion, forgeVersion);
      }

      onProgress({ stage: 'Создание профиля Forge', percent: 20 });

      await fs.ensureDir(versionDir);

      // Сохраняем JSON профиль
      const versionJsonPath = path.join(versionDir, `${versionId}.json`);
      await fs.writeJson(versionJsonPath, forgeManifest, { spaces: 2 });
      console.log(`[FORGE] Профиль сохранён`);

      onProgress({ stage: 'Загрузка библиотек Forge', percent: 30 });

      // Скачиваем библиотеки Forge
      const libraries = forgeManifest.libraries || [];
      console.log(`[FORGE] Библиотек для загрузки: ${libraries.length}`);

      // МАКСИМАЛЬНАЯ СКОРОСТЬ - 50 параллельных загрузок
      const limit = pLimit(50);
      let downloaded = 0;

      const downloadTasks = libraries.map(lib => {
        return limit(async () => {
          try {
            let artifact = null;
            let libName = '';

            if (lib.downloads && lib.downloads.artifact) {
              artifact = lib.downloads.artifact;
              libName = lib.name;
            } else if (lib.name) {
              // Создаём artifact вручную
              const parts = lib.name.split(':');
              if (parts.length < 3) {
                console.warn(`[FORGE] Неверный формат библиотеки: ${lib.name}`);
                return;
              }
              const [group, name, version] = parts;
              const groupPath = group.replace(/\./g, '/');
              const jarName = `${name}-${version}.jar`;
              const libPath = `${groupPath}/${name}/${version}/${jarName}`;

              const baseUrl = lib.url || 'https://libraries.minecraft.net/';
              artifact = {
                path: libPath,
                url: `${baseUrl}${libPath}`,
                sha1: null
              };
              libName = lib.name;
            }

            if (!artifact) return;

            // Конвертируем Unix-style путь в platform-specific
            const normalizedPath = artifact.path.split('/').join(path.sep);
            const fullPath = path.join(this.librariesDir, normalizedPath);

            if (!fs.existsSync(fullPath)) {
              await fs.ensureDir(path.dirname(fullPath));

              // Попытка загрузки с retry логикой
              let retries = 3;
              let lastError = null;

              for (let attempt = 0; attempt < retries; attempt++) {
                try {
                  const libResponse = await axios({
                    url: artifact.url,
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

                  // Успешно загружено
                  break;
                } catch (err) {
                  lastError = err;
                  if (attempt < retries - 1) {
                    console.warn(`[FORGE] Попытка ${attempt + 1}/${retries} не удалась для ${libName}, повторяем...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                  }
                }
              }

              if (lastError && !fs.existsSync(fullPath)) {
                console.warn(`[FORGE] Не удалось загрузить ${libName} после ${retries} попыток - пропускаем`);
              }
            }

            downloaded++;
            const progress = 30 + ((downloaded / libraries.length) * 65);
            onProgress({
              stage: `Библиотеки Forge (${downloaded}/${libraries.length})`,
              percent: Math.floor(progress)
            });

          } catch (err) {
            console.warn(`[FORGE] Не удалось загрузить библиотеку: ${err.message}`);
            // Не падаем, продолжаем загрузку остальных библиотек
          }
        });
      });

      await Promise.all(downloadTasks);

      onProgress({ stage: 'Forge установлен', percent: 100 });
      console.log('[FORGE] ✓ Установка завершена');

      return {
        success: true,
        versionId: versionId,
        mainClass: forgeManifest.mainClass
      };

    } catch (error) {
      console.error('[FORGE] Ошибка установки:', error.message);
      throw new Error(`Не удалось установить Forge: ${error.message}`);
    }
  }

  /**
   * Создание базового манифеста Forge если не удалось скачать
   */
  async createForgeManifest(minecraftVersion, forgeVersion) {
    console.log('[FORGE] Создаём базовый манифест...');

    const fullVersion = `${minecraftVersion}-${forgeVersion}`;

    return {
      id: `${minecraftVersion}-forge-${forgeVersion}`,
      inheritsFrom: minecraftVersion,
      releaseTime: new Date().toISOString(),
      time: new Date().toISOString(),
      type: 'release',
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      arguments: {
        game: [
          '--launchTarget', 'forgeclient'
        ],
        jvm: []
      },
      libraries: [
        {
          name: `net.minecraftforge:forge:${fullVersion}`,
          url: 'https://maven.minecraftforge.net/',
          downloads: {
            artifact: {
              path: `net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-client.jar`,
              url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-client.jar`,
              sha1: null
            }
          }
        },
        {
          name: `net.minecraftforge:forge:${fullVersion}:universal`,
          url: 'https://maven.minecraftforge.net/',
          downloads: {
            artifact: {
              path: `net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-universal.jar`,
              url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-universal.jar`,
              sha1: null
            }
          }
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
      const versions = fs.readdirSync(this.versionsDir);
      for (const v of versions) {
        if (v.includes('forge') && v.includes(minecraftVersion)) {
          return true;
        }
      }
      return false;
    }

    return false;
  }
}

module.exports = ModLoaderInstaller;
