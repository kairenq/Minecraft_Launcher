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

              const [group, name, version, classifier] = parts;
              const groupPath = group.replace(/\./g, '/');

              // Если есть classifier (4-я часть), добавляем его к имени JAR
              const jarName = classifier
                ? `${name}-${version}-${classifier}.jar`
                : `${name}-${version}.jar`;

              const libPath = `${groupPath}/${name}/${version}/${jarName}`;

              // Определяем правильный базовый URL
              // Для Forge/FML библиотек используем maven.minecraftforge.net
              let baseUrl = lib.url || 'https://libraries.minecraft.net/';

              // Если библиотека от minecraftforge - используем их Maven
              if (group.includes('minecraftforge') || group.includes('cpw.mods')) {
                baseUrl = 'https://maven.minecraftforge.net/';
              }

              artifact = {
                path: libPath,
                url: `${baseUrl}${libPath}`,
                sha1: null
              };
              libName = lib.name;

              console.log(`[FORGE] Парсинг библиотеки: ${lib.name} -> ${jarName} (URL: ${baseUrl})`);
            }

            if (!artifact) return;

            // Конвертируем Unix-style путь в platform-specific
            const normalizedPath = artifact.path.split('/').join(path.sep);
            const fullPath = path.join(this.librariesDir, normalizedPath);

            if (!fs.existsSync(fullPath)) {
              await fs.ensureDir(path.dirname(fullPath));

              // Критичные библиотеки Forge, без которых игра не запустится
              const criticalLibs = ['fmlcore', 'fmlloader', 'javafmllanguage', 'lowcodelanguage', 'mclanguage'];
              const isCritical = criticalLibs.some(critLib => libName.includes(critLib));

              // Попытка загрузки с retry логикой
              // Для критичных библиотек используем больше попыток
              let retries = isCritical ? 5 : 3;
              let lastError = null;

              for (let attempt = 0; attempt < retries; attempt++) {
                try {
                  const libResponse = await axios({
                    url: artifact.url,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 60000, // 60 секунд
                    ...this.axiosConfig
                  });

                  const writer = fs.createWriteStream(fullPath);
                  await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                    libResponse.data.pipe(writer);
                  });

                  // Успешно загружено
                  if (isCritical) {
                    console.log(`[FORGE] ✓ Критичная библиотека загружена: ${libName}`);
                  }
                  break;
                } catch (err) {
                  lastError = err;
                  if (attempt < retries - 1) {
                    const delay = 2000 * (attempt + 1); // 2s, 4s, 6s, 8s, 10s
                    console.warn(`[FORGE] Попытка ${attempt + 1}/${retries} не удалась для ${libName}: ${err.message}`);
                    console.warn(`[FORGE] Повторная попытка через ${delay/1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                  }
                }
              }

              if (lastError && !fs.existsSync(fullPath)) {
                if (isCritical) {
                  // КРИТИЧНЫЕ библиотеки - выбрасываем ошибку!
                  throw new Error(`Не удалось загрузить критичную библиотеку ${libName} после ${retries} попыток.\nURL: ${artifact.url}\nОшибка: ${lastError.message}\n\nЭта библиотека необходима для запуска Forge. Проверьте подключение к интернету и повторите установку.`);
                } else {
                  console.warn(`[FORGE] ⚠️  Не удалось загрузить ${libName} после ${retries} попыток - пропускаем (${lastError.message})`);
                }
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

      // Создаём специальные Minecraft client библиотеки для Forge 1.17+
      // Эти файлы обычно создаются Forge installer, но мы можем создать их из оригинального клиента
      onProgress({ stage: 'Создание клиентских библиотек', percent: 85 });
      await this.createMinecraftClientLibraries(minecraftVersion, forgeVersion);

      // Скачиваем win_args.txt и unix_args.txt для Forge 1.17+ (если они есть)
      onProgress({ stage: 'Загрузка Forge аргументов', percent: 95 });
      const forgeArgsDir = path.join(this.librariesDir, 'net', 'minecraftforge', 'forge', fullForgeVersion);
      await fs.ensureDir(forgeArgsDir);

      const argsFiles = ['win_args.txt', 'unix_args.txt'];
      for (const argsFile of argsFiles) {
        const argsUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/${argsFile}`;
        const argsPath = path.join(forgeArgsDir, argsFile);

        try {
          console.log(`[FORGE] Скачивание ${argsFile}...`);
          const response = await axios({
            url: argsUrl,
            method: 'GET',
            responseType: 'text',
            ...this.axiosConfig
          });

          await fs.writeFile(argsPath, response.data, 'utf8');
          console.log(`[FORGE] ✓ ${argsFile} скачан`);
        } catch (err) {
          console.warn(`[FORGE] ⚠️  Не удалось скачать ${argsFile}: ${err.message}`);
          console.warn(`[FORGE]    Это нормально для старых версий Forge (до 1.17)`);
        }
      }

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
   * Извлечение version.json из официального Forge installer
   */
  async createForgeManifest(minecraftVersion, forgeVersion) {
    console.log('[FORGE] Скачиваем официальный installer для извлечения version.json...');

    const fullVersion = `${minecraftVersion}-${forgeVersion}`;
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;

    try {
      // Скачиваем installer JAR во временную директорию
      const tempDir = path.join(require('os').tmpdir(), 'forge-installer-' + Date.now());
      await fs.ensureDir(tempDir);
      const installerPath = path.join(tempDir, 'installer.jar');

      console.log(`[FORGE] Загрузка installer: ${installerUrl}`);
      const response = await axios({
        url: installerUrl,
        method: 'GET',
        responseType: 'stream',
        ...this.axiosConfig
      });

      const writer = fs.createWriteStream(installerPath);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.pipe(writer);
      });

      console.log('[FORGE] ✓ Installer скачан, извлекаем version.json...');

      // Извлекаем version.json из installer JAR
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(installerPath);
      const versionJsonEntry = zip.getEntry('version.json');

      if (!versionJsonEntry) {
        throw new Error('version.json не найден в installer');
      }

      const versionJson = JSON.parse(versionJsonEntry.getData().toString('utf8'));
      console.log(`[FORGE] ✓ version.json извлечён (${versionJson.libraries?.length || 0} библиотек)`);

      // Извлекаем win_args.txt и unix_args.txt если они есть
      const winArgsEntry = zip.getEntry('data/win_args.txt');
      const unixArgsEntry = zip.getEntry('data/unix_args.txt');

      if (winArgsEntry || unixArgsEntry) {
        const forgeArgsDir = path.join(this.librariesDir, 'net', 'minecraftforge', 'forge', fullVersion);
        await fs.ensureDir(forgeArgsDir);

        if (winArgsEntry) {
          const winArgsPath = path.join(forgeArgsDir, 'win_args.txt');
          await fs.writeFile(winArgsPath, winArgsEntry.getData());
          console.log('[FORGE] ✓ win_args.txt извлечён');
        }

        if (unixArgsEntry) {
          const unixArgsPath = path.join(forgeArgsDir, 'unix_args.txt');
          await fs.writeFile(unixArgsPath, unixArgsEntry.getData());
          console.log('[FORGE] ✓ unix_args.txt извлечён');
        }
      }

      // Очищаем временную директорию
      await fs.remove(tempDir);

      // Корректируем ID версии если нужно
      versionJson.id = `${minecraftVersion}-forge-${forgeVersion}`;

      return versionJson;

    } catch (error) {
      console.error('[FORGE] ❌ Не удалось извлечь version.json из installer:', error.message);
      throw new Error(`Не удалось получить официальный манифест Forge: ${error.message}`);
    }
  }

  /**
   * Создание специальных Minecraft client библиотек для Forge 1.17+
   * Эти файлы обычно создаются Forge installer из оригинального клиента
   */
  async createMinecraftClientLibraries(minecraftVersion, forgeVersion) {
    console.log('[FORGE] ========================================');
    console.log('[FORGE] НАЧАЛО: Создание клиентских библиотек Minecraft');
    console.log(`[FORGE] Версия Minecraft: ${minecraftVersion}`);
    console.log(`[FORGE] Версия Forge: ${forgeVersion}`);
    console.log('[FORGE] ========================================');

    const fullForgeVersion = `${minecraftVersion}-${forgeVersion}`;
    const argsFilePath = path.join(this.librariesDir, 'net', 'minecraftforge', 'forge', fullForgeVersion,
      process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt');

    console.log(`[FORGE] Путь к args файлу: ${argsFilePath}`);
    console.log(`[FORGE] Args файл существует: ${fs.existsSync(argsFilePath)}`);

    // Читаем win_args.txt чтобы найти какие client библиотеки нужны
    let clientLibPaths = [];

    try {
      if (fs.existsSync(argsFilePath)) {
        const argsContent = await fs.readFile(argsFilePath, 'utf8');
        console.log(`[FORGE] Args файл прочитан, длина: ${argsContent.length} символов`);

        // Ищем пути вида libraries/net/minecraft/client/...
        const matches = argsContent.match(/libraries\/net\/minecraft\/(?:client|server)\/[^;:\s]+\.jar/g);
        if (matches) {
          clientLibPaths = matches.map(p => p.replace(/\/server\//g, '/client/').replace(/server-/g, 'client-'));
          console.log(`[FORGE] Найдено ${clientLibPaths.length} клиентских библиотек в args файле`);
          console.log(`[FORGE] Библиотеки: ${clientLibPaths.join(', ')}`);
        } else {
          console.log(`[FORGE] В args файле не найдено паттернов библиотек`);
        }
      } else {
        console.log(`[FORGE] Args файл не найден, будем использовать стандартные пути`);
      }
    } catch (err) {
      console.warn(`[FORGE] Ошибка чтения args файла: ${err.message}`);
      console.warn(`[FORGE] Stack trace:`, err.stack);
    }

    // Если не нашли в args файле, используем стандартные пути для версии
    if (clientLibPaths.length === 0) {
      console.log('[FORGE] Переходим к стандартным путям для версии...');

      // Стандартный формат для Forge 1.17+
      // MCP версия обычно в формате YYYYMMDD.HHMMSS
      const mcpVersions = {
        '1.18.2': '20220404.173914',
        '1.19': '20220607.102129',
        '1.19.2': '20220805.130853',
        '1.19.3': '20221207.122022',
        '1.19.4': '20230314.122934',
        '1.20': '20230608.053357',
        '1.20.1': '20230612.114412',
        '1.20.2': '20230921.090717',
        '1.20.4': '20231210.123242',
        '1.20.6': '20240429.130120',
        '1.21': '20240613.152323',
        '1.21.1': '20240801.141236'
      };

      const mcpVersion = mcpVersions[minecraftVersion];
      console.log(`[FORGE] MCP версия для ${minecraftVersion}: ${mcpVersion || 'НЕ НАЙДЕНА'}`);

      if (mcpVersion) {
        const versionString = `${minecraftVersion}-${mcpVersion}`;
        clientLibPaths = [
          `libraries/net/minecraft/client/${versionString}/client-${versionString}.jar`,
          `libraries/net/minecraft/client/${versionString}/client-${versionString}-extra.jar`
        ];
        console.log(`[FORGE] Используем стандартный MCP версии: ${mcpVersion}`);
        console.log(`[FORGE] Пути для загрузки:`);
        clientLibPaths.forEach(p => console.log(`[FORGE]   - ${p}`));
      } else {
        console.log(`[FORGE] ⚠️  ВНИМАНИЕ: Версия ${minecraftVersion} не поддерживается, client JAR не будут загружены`);
        console.log(`[FORGE] Пропускаем создание client библиотек`);
        return; // Выходим, если версия не поддерживается
      }
    }

    // Скачиваем каждую клиентскую библиотеку
    console.log(`[FORGE] Обработка ${clientLibPaths.length} клиентских библиотек...`);

    for (let i = 0; i < clientLibPaths.length; i++) {
      const libPath = clientLibPaths[i];
      console.log(`[FORGE] ----------------------------------------`);
      console.log(`[FORGE] Обработка библиотеки ${i + 1}/${clientLibPaths.length}`);
      console.log(`[FORGE] Путь: ${libPath}`);

      const relativePath = libPath.replace(/^libraries\//, '');
      const fullPath = path.join(this.librariesDir, relativePath.split('/').join(path.sep));
      const dirPath = path.dirname(fullPath);

      console.log(`[FORGE] Полный путь: ${fullPath}`);
      console.log(`[FORGE] Директория: ${dirPath}`);

      // Проверяем существует ли уже И имеет ли правильный размер
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeInMB = stats.size / (1024 * 1024);

        // Если файл слишком маленький (< 1 MB), удаляем его и перезагружаем
        if (sizeInMB < 1) {
          console.log(`[FORGE] ⚠️  ${path.basename(fullPath)} поврежден (${sizeInMB.toFixed(2)} MB), перезагрузка...`);
          fs.unlinkSync(fullPath);
        } else {
          console.log(`[FORGE] ✓ ${path.basename(fullPath)} уже существует (${sizeInMB.toFixed(2)} MB)`);
          continue;
        }
      } else {
        console.log(`[FORGE] Файл не существует, нужно скачать`);
      }

      await fs.ensureDir(dirPath);
      console.log(`[FORGE] Директория создана/проверена`);

      // Определяем тип файла и URL для скачивания
      const fileName = path.basename(fullPath);
      console.log(`[FORGE] Имя файла: ${fileName}`);

      // КРИТИЧНО: Скачиваем настоящие JAR из Maven Forge вместо создания пустых
      if (fileName.includes('client-')) {
        console.log(`[FORGE] Это client JAR файл, начинаем скачивание...`);

        // Извлекаем версию из имени файла (например, 1.18.2-20220404.173914)
        const versionMatch = fileName.match(/client-([\d.-]+)(?:-extra)?\.jar/);
        if (versionMatch) {
          const clientVersion = versionMatch[1];
          const isExtra = fileName.includes('-extra.jar');

          console.log(`[FORGE] Версия client: ${clientVersion}`);
          console.log(`[FORGE] Это extra файл: ${isExtra}`);

          // URL на Maven Forge
          const jarName = isExtra ? `client-${clientVersion}-extra.jar` : `client-${clientVersion}.jar`;
          const mavenUrl = `https://maven.minecraftforge.net/net/minecraft/client/${clientVersion}/${jarName}`;

          console.log(`[FORGE] 🌐 Начинаю скачивание ${fileName}...`);
          console.log(`[FORGE] 📍 URL: ${mavenUrl}`);

          // Скачиваем с retry логикой
          let retries = 5;
          let success = false;

          for (let attempt = 0; attempt < retries; attempt++) {
            console.log(`[FORGE] 🔄 Попытка ${attempt + 1}/${retries}...`);

            try {
              const response = await axios({
                url: mavenUrl,
                method: 'GET',
                responseType: 'stream',
                timeout: 120000, // 2 минуты для больших файлов
                ...this.axiosConfig
              });

              console.log(`[FORGE] ✓ Ответ получен, статус: ${response.status}`);
              console.log(`[FORGE] ✓ Content-Type: ${response.headers['content-type']}`);
              console.log(`[FORGE] ✓ Content-Length: ${response.headers['content-length']} bytes`);

              const writer = fs.createWriteStream(fullPath);
              await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', (err) => {
                  console.error(`[FORGE] ❌ Ошибка записи файла: ${err.message}`);
                  reject(err);
                });
                response.data.on('error', (err) => {
                  console.error(`[FORGE] ❌ Ошибка потока данных: ${err.message}`);
                  reject(err);
                });
                response.data.pipe(writer);
              });

              console.log(`[FORGE] ✓ Файл записан на диск`);

              // Проверяем размер файла после загрузки
              const stats = fs.statSync(fullPath);
              const sizeInMB = stats.size / (1024 * 1024);

              console.log(`[FORGE] 📊 Размер скачанного файла: ${sizeInMB.toFixed(2)} MB`);

              if (sizeInMB < 1 && !isExtra) {
                throw new Error(`Загруженный файл слишком мал: ${sizeInMB.toFixed(2)} MB (ожидалось ~15-20 MB)`);
              }

              console.log(`[FORGE] ✅ ${fileName} успешно скачан (${sizeInMB.toFixed(2)} MB)`);
              success = true;
              break;

            } catch (err) {
              console.error(`[FORGE] ❌ Попытка ${attempt + 1}/${retries} не удалась`);
              console.error(`[FORGE] ❌ Ошибка: ${err.message}`);
              if (err.response) {
                console.error(`[FORGE] ❌ HTTP статус: ${err.response.status}`);
                console.error(`[FORGE] ❌ HTTP статус текст: ${err.response.statusText}`);

                // Если это -extra.jar и получили 404, это не критично
                if (isExtra && err.response.status === 404) {
                  console.log(`[FORGE] ⚠️  Файл ${fileName} не найден на сервере (это нормально для -extra.jar)`);
                  console.log(`[FORGE] ✓ Пропускаем опциональный -extra.jar файл`);
                  success = true;
                  break; // Выходим из цикла retry
                }
              }

              // Удаляем поврежденный файл если он был создан
              if (fs.existsSync(fullPath)) {
                console.log(`[FORGE] 🗑️  Удаляем поврежденный файл...`);
                fs.unlinkSync(fullPath);
              }

              if (attempt < retries - 1) {
                const delay = 3000 * (attempt + 1); // 3s, 6s, 9s, 12s, 15s
                console.warn(`[FORGE] ⏳ Повторная попытка через ${delay/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          }

          if (!success) {
            // Если это -extra.jar, это не критично
            if (isExtra) {
              console.warn(`[FORGE] ⚠️  Не удалось скачать опциональный файл ${fileName}, продолжаем без него`);
            } else {
              const errorMsg = `Не удалось скачать ${fileName} после ${retries} попыток из ${mavenUrl}`;
              console.error(`[FORGE] ❌❌❌ КРИТИЧЕСКАЯ ОШИБКА: ${errorMsg}`);
              throw new Error(errorMsg);
            }
          }
        } else {
          console.warn(`[FORGE] ⚠️  Не удалось распарсить версию из имени файла: ${fileName}`);
        }
      } else if (fileName.includes('-srg.jar')) {
        // srg.jar - это клиент с SRG названиями
        // Для простоты создаём пустой JAR (Forge должен работать и без него)
        console.log(`[FORGE] Создание ${fileName}...`);
        await this.createMinimalJar(fullPath, 'Minecraft Client SRG');
        console.log(`[FORGE] ✓ ${fileName} создан`);
      } else {
        // Неизвестный тип - создаём пустой JAR
        console.log(`[FORGE] Создание ${fileName}...`);
        await this.createMinimalJar(fullPath, 'Minecraft Client Library');
        console.log(`[FORGE] ✓ ${fileName} создан`);
      }
    }

    console.log('[FORGE] ========================================');
    console.log('[FORGE] ✅ ЗАВЕРШЕНО: Все клиентские библиотеки обработаны');
    console.log('[FORGE] ========================================');
  }

  /**
   * Создание минимального JAR файла с манифестом
   */
  async createMinimalJar(jarPath, manifestName) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();

    // Добавляем манифест
    const manifest = `Manifest-Version: 1.0\nCreated-By: Aureate Launcher\nName: ${manifestName}\n`;
    zip.addFile('META-INF/MANIFEST.MF', Buffer.from(manifest, 'utf8'));

    // Сохраняем JAR
    zip.writeZip(jarPath);
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
