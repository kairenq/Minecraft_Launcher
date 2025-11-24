const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');
const ForgeDownloader = require('./forge-downloader'); // ИМПОРТИРУЕМ НОВЫЙ КЛАСС

class ModLoaderInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.forgeDownloader = new ForgeDownloader(launcherDir); // ИСПОЛЬЗУЕМ НОВЫЙ КЛАСС

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
   * Установка Forge - используем новый ForgeDownloader
   */
  async installForge(minecraftVersion, forgeVersion, onProgress) {
    try {
      console.log('[FORGE] Используем новый ForgeDownloader...');
      
      // Если версия не указана - получаем рекомендованную
      if (!forgeVersion) {
        console.log('[FORGE] Версия не указана, получаем рекомендованную...');
        forgeVersion = await this.getRecommendedForgeVersion(minecraftVersion);
        console.log(`[FORGE] Выбрана версия: ${forgeVersion}`);
      }

      // 1. СКАЧИВАЕМ FORGE INSTALLER через ForgeDownloader
      const { forgeJarPath, versionId } = await this.forgeDownloader.downloadForgeInstaller(
        minecraftVersion, 
        forgeVersion, 
        onProgress
      );

      // 2. Устанавливаем Forge через установщик
      onProgress({ stage: 'Установка Forge', percent: 40 });
      await this.runForgeInstaller(forgeJarPath, minecraftVersion, forgeVersion);

      // 3. Создаем или загружаем профиль Forge
      onProgress({ stage: 'Создание профиля Forge', percent: 80 });
      await this.createForgeProfile(minecraftVersion, forgeVersion, versionId);

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
   * Запуск Forge installer
   */
  async runForgeInstaller(forgeJarPath, minecraftVersion, forgeVersion) {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      
      // Определяем аргументы для установщика
      const args = ['-jar', forgeJarPath, '--installServer']; // Или --installClient
      
      const javaProcess = spawn('java', args, {
        cwd: path.dirname(forgeJarPath)
      });

      let output = '';
      javaProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log('[FORGE INSTALLER]', data.toString().trim());
      });

      javaProcess.stderr.on('data', (data) => {
        output += data.toString();
        console.error('[FORGE INSTALLER ERROR]', data.toString().trim());
      });

      javaProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[FORGE] ✓ Установщик завершился успешно');
          resolve(output);
        } else {
          reject(new Error(`Forge installer failed with code ${code}\n${output}`));
        }
      });

      javaProcess.on('error', (error) => {
        reject(new Error(`Failed to start Java: ${error.message}`));
      });
    });
  }

  /**
   * Создание профиля Forge
   */
  async createForgeProfile(minecraftVersion, forgeVersion, versionId) {
    const versionDir = path.join(this.versionsDir, versionId);
    
    // Пробуем скачать официальный манифест
    try {
      const fullForgeVersion = `${minecraftVersion}-${forgeVersion}`;
      const manifestUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}.json`;
      
      console.log(`[FORGE] Загрузка манифеста: ${manifestUrl}`);
      const response = await axios.get(manifestUrl, this.axiosConfig);
      const forgeManifest = response.data;

      // Сохраняем JSON профиль
      const versionJsonPath = path.join(versionDir, `${versionId}.json`);
      await fs.writeJson(versionJsonPath, forgeManifest, { spaces: 2 });
      console.log(`[FORGE] ✓ Официальный профиль сохранён`);

    } catch (error) {
      console.warn('[FORGE] Не удалось загрузить официальный манифест, создаём базовый:', error.message);
      
      // Создаем базовый профиль
      const basicProfile = await this.createBasicForgeManifest(minecraftVersion, forgeVersion);
      const versionJsonPath = path.join(versionDir, `${versionId}.json`);
      await fs.writeJson(versionJsonPath, basicProfile, { spaces: 2 });
      console.log(`[FORGE] ✓ Базовый профиль создан`);
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
      // Используем метод из ForgeDownloader
      return await this.forgeDownloader.checkForgeInstallerExists(minecraftVersion, modLoaderVersion);
    }

    return false;
  }
}

module.exports = ModLoaderInstaller;
