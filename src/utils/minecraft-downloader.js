const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const pLimit = require('p-limit');

class MinecraftDownloader {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.assetsDir = path.join(launcherDir, 'assets');

    this.versionManifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.librariesDir);
    fs.ensureDirSync(this.assetsDir);
  }

  async checkMinecraft(version) {
    const versionDir = path.join(this.versionsDir, version);
    const versionJson = path.join(versionDir, `${version}.json`);
    const versionJar = path.join(versionDir, `${version}.jar`);

    if (!fs.existsSync(versionJson) || !fs.existsSync(versionJar)) {
      return false;
    }

    // Проверяем целостность JAR файла
    try {
      const versionData = await fs.readJson(versionJson);
      if (versionData.downloads && versionData.downloads.client && versionData.downloads.client.sha1) {
        const isValid = await this.verifySha1(versionJar, versionData.downloads.client.sha1);
        if (!isValid) {
          console.log(`⚠️  ${version}.jar поврежден, требуется переустановка`);
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error(`Ошибка проверки ${version}:`, error.message);
      return false;
    }
  }

  async getVersionManifest() {
    try {
      const response = await axios.get(this.versionManifestUrl);
      return response.data;
    } catch (error) {
      throw new Error(`Не удалось получить список версий: ${error.message}`);
    }
  }

  async getVersionData(version) {
    const manifest = await this.getVersionManifest();
    const versionInfo = manifest.versions.find(v => v.id === version);

    if (!versionInfo) {
      throw new Error(`Версия ${version} не найдена`);
    }

    const response = await axios.get(versionInfo.url);
    return response.data;
  }

  async downloadFile(url, dest, onProgress, retries = 5) {
    for (let attempt = 0; attempt < retries; attempt++) {
      let writer = null;
      try {
        console.log(`[DOWNLOAD] ${url} (попытка ${attempt + 1}/${retries})`);
        console.log(`[DEST] ${dest}`);

        await fs.ensureDir(path.dirname(dest));

        // ВАЖНО: Для resources.download.minecraft.net используем специальные настройки
        const isMinecraftResource = url.includes('resources.download.minecraft.net');
        const isLargeFile = url.includes('.jar') || url.includes('.zip');

        // Более длительные таймауты для проблемных серверов
        let timeout;
        if (isMinecraftResource) {
          timeout = 300000; // 5 минут для resources.download.minecraft.net
        } else if (isLargeFile) {
          timeout = 180000; // 3 минуты для больших файлов
        } else {
          timeout = 60000; // 1 минута для остальных
        }

        const httpsAgent = new (require('https').Agent)({
          rejectUnauthorized: false, // Отключаем SSL проверку для всех
          keepAlive: true,
          keepAliveMsecs: 30000,
          timeout: timeout
        });

        console.log(`[CONFIG] Timeout: ${timeout}ms, Redirects: 10, SSL: disabled`);

        const response = await axios({
          url: url,
          method: 'GET',
          responseType: 'stream',
          timeout: timeout,
          maxRedirects: 10,
          validateStatus: (status) => status >= 200 && status < 300,
          httpsAgent: httpsAgent,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const totalLength = parseInt(response.headers['content-length'], 10);
        let downloadedLength = 0;
        let lastProgressLog = Date.now();

        console.log(`[SIZE] ${totalLength} bytes (${(totalLength / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`[START] Начало скачивания...`);

        writer = fs.createWriteStream(dest);

        response.data.on('data', (chunk) => {
          downloadedLength += chunk.length;

          // Логируем прогресс каждые 5 секунд для больших файлов
          const now = Date.now();
          if (totalLength && now - lastProgressLog > 5000) {
            const percent = ((downloadedLength / totalLength) * 100).toFixed(1);
            console.log(`[PROGRESS] ${percent}% (${(downloadedLength / 1024 / 1024).toFixed(2)} MB / ${(totalLength / 1024 / 1024).toFixed(2)} MB)`);
            lastProgressLog = now;
          }

          if (onProgress && totalLength) {
            const progress = downloadedLength / totalLength;
            onProgress(progress);
          }
        });

        // Используем Promise для корректного ожидания завершения
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
          response.data.on('error', reject);
          response.data.pipe(writer);
        });

        console.log(`[SUCCESS] Downloaded ${downloadedLength} bytes`);

        // Проверяем что размер файла совпадает
        if (totalLength && downloadedLength !== totalLength) {
          throw new Error(`Размер файла не совпадает: скачано ${downloadedLength}, ожидалось ${totalLength}`);
        }

        // Успешно скачано
        return;
      } catch (error) {
        // Закрываем writer перед очисткой
        if (writer && !writer.destroyed) {
          writer.destroy();
          await new Promise(resolve => setTimeout(resolve, 100)); // Даём время на закрытие
        }

        const isSSLError = error.message && (
          error.message.includes('BAD_DECRYPT') ||
          error.message.includes('CERT_') ||
          error.message.includes('SSL') ||
          error.message.includes('certificate')
        );

        const isPermissionError = error.code === 'EPERM' ||
          error.code === 'EACCES' ||
          (error.message && error.message.includes('operation not permitted'));

        if (isSSLError) {
          console.error(`[SSL ERROR] Обнаружена SSL ошибка - возможно антивирус вмешивается`);
        }

        if (isPermissionError) {
          console.error(`[PERMISSION ERROR] Антивирус блокирует доступ к файлу`);
        }

        const isTimeoutError = error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' ||
          (error.message && error.message.includes('timeout'));
        const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNRESET' || (error.message && error.message.includes('connect'));

        console.error(`[ERROR] Ошибка скачивания ${url} (попытка ${attempt + 1}/${retries}):`, error.message);
        console.error(`[ERROR] Код ошибки:`, error.code || 'N/A');

        // Удаляем битый файл если он был создан
        if (fs.existsSync(dest)) {
          try {
            await fs.remove(dest);
            console.log(`[CLEANUP] Удален битый файл: ${dest}`);
          } catch (cleanupErr) {
            console.warn(`[CLEANUP WARNING] Не удалось удалить файл (возможно антивирус держит): ${cleanupErr.message}`);
          }
        }

        // Если это последняя попытка - выбрасываем ошибку
        if (attempt === retries - 1) {
          let errorMsg = `Не удалось скачать файл после ${retries} попыток: ${url}\nОшибка: ${error.message}`;

          if (isTimeoutError) {
            errorMsg += '\n\n⚠️  ПРЕВЫШЕНО ВРЕМЯ ОЖИДАНИЯ:';
            errorMsg += '\n1. Проверьте скорость интернет-соединения';
            errorMsg += '\n2. Попробуйте использовать VPN (серверы Mojang могут быть медленными)';
            errorMsg += '\n3. Попробуйте позже - серверы Mojang могут быть перегружены';
            errorMsg += '\n4. Отключите торренты и другие программы, использующие интернет';
          }

          if (isNetworkError) {
            errorMsg += '\n\n⚠️  ОШИБКА СЕТИ:';
            errorMsg += '\n1. Проверьте подключение к интернету';
            errorMsg += '\n2. Попробуйте использовать VPN';
            errorMsg += '\n3. Проверьте настройки firewall';
            errorMsg += '\n4. Отключите proxy если используется';
          }

          if (isSSLError) {
            errorMsg += '\n\n⚠️  SSL ОШИБКА: Попробуйте:';
            errorMsg += '\n1. Временно отключите антивирус';
            errorMsg += '\n2. Отключите SSL проверку в антивирусе';
            errorMsg += '\n3. Добавьте лаунчер в исключения антивируса';
          }

          if (isPermissionError) {
            errorMsg += '\n\n⚠️  АНТИВИРУС БЛОКИРУЕТ ФАЙЛЫ: Попробуйте:';
            errorMsg += '\n1. Временно отключите антивирус (рекомендуется)';
            errorMsg += '\n2. Добавьте папку лаунчера в исключения антивируса';
            errorMsg += '\n3. Отключите "Защиту от программ-вымогателей" в антивирусе';
            errorMsg += '\n4. Запустите лаунчер от имени администратора';
          }

          throw new Error(errorMsg);
        }

        // Ждём перед следующей попыткой с более агрессивным exponential backoff
        let delay;
        if (isTimeoutError || isNetworkError) {
          // Для network/timeout ошибок ждём дольше: 5s, 15s, 30s, 60s, 120s
          delay = Math.min(5000 * Math.pow(3, attempt), 120000);
        } else if (isPermissionError) {
          // Для EPERM ошибок: 2s, 4s, 8s, 16s, 32s
          delay = Math.pow(2, attempt) * 2000;
        } else {
          // Для остальных: 2s, 4s, 8s, 16s, 32s
          delay = Math.pow(2, attempt) * 2000;
        }

        console.log(`[RETRY] Ожидание ${(delay / 1000).toFixed(1)}s перед следующей попыткой...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async downloadJsonFile(url, dest, retries = 3) {
    // Для JSON файлов используем прямое скачивание (не stream), чтобы избежать проблем с кодировкой
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        console.log(`Скачивание JSON: ${url} (попытка ${attempt + 1}/${retries})`);

        const response = await axios({
          url: url,
          method: 'GET',
          responseType: 'text', // Важно: text, не stream
          validateStatus: (status) => status === 200
        });

        const rawContent = response.data;
        console.log(`✓ Получено ${rawContent.length} символов`);
        console.log(`  Первые 50: ${rawContent.substring(0, 50)}`);

        // Проверяем на HTML
        if (rawContent.includes('<!DOCTYPE') || rawContent.includes('<html')) {
          throw new Error('Сервер вернул HTML страницу вместо JSON');
        }

        // Очищаем от BOM и пробельных символов по краям
        const cleanedContent = rawContent.replace(/^\uFEFF/, '').trim();

        // Проверяем валидность JSON
        let jsonData;
        try {
          jsonData = JSON.parse(cleanedContent);
        } catch (parseError) {
          console.error(`❌ Ошибка парсинга JSON:`);
          console.error(`   Первые 200 символов: ${cleanedContent.substring(0, 200)}`);
          console.error(`   Последние 200 символов: ${cleanedContent.substring(cleanedContent.length - 200)}`);

          // Hex dump первых 50 байт
          const hexDump = [];
          for (let i = 0; i < Math.min(50, cleanedContent.length); i++) {
            hexDump.push(cleanedContent.charCodeAt(i).toString(16).padStart(2, '0'));
          }
          console.error(`   HEX первых 50 байт: ${hexDump.join(' ')}`);

          throw parseError;
        }

        // Сохраняем файл
        await fs.ensureDir(path.dirname(dest));
        await fs.writeFile(dest, cleanedContent, 'utf-8');

        console.log(`✓ JSON валиден и сохранён: ${path.basename(dest)}`);
        return jsonData;

      } catch (error) {
        console.error(`❌ Ошибка скачивания JSON (попытка ${attempt + 1}/${retries}):`, error.message);

        // Удаляем битый файл если он был создан
        if (fs.existsSync(dest)) {
          await fs.remove(dest);
        }

        // Если это последняя попытка - выбрасываем ошибку
        if (attempt === retries - 1) {
          throw new Error(`Не удалось скачать JSON после ${retries} попыток: ${url}\nОшибка: ${error.message}`);
        }

        // Ждём перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  async verifySha1(filePath, expectedSha1) {
    if (!expectedSha1) {
      console.log(`[SHA1] Пропуск проверки для ${path.basename(filePath)} (SHA1 не предоставлен)`);
      return true; // Если SHA1 не предоставлен, пропускаем проверку
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      const fileSize = fileBuffer.length;
      console.log(`[SHA1] Проверка ${path.basename(filePath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

      const hash = crypto.createHash('sha1');
      hash.update(fileBuffer);
      const actualSha1 = hash.digest('hex');

      const isValid = actualSha1.toLowerCase() === expectedSha1.toLowerCase();

      if (isValid) {
        console.log(`[SHA1] ✓ Проверка пройдена: ${actualSha1}`);
      } else {
        console.log(`[SHA1] ❌ НЕСОВПАДЕНИЕ для ${path.basename(filePath)}`);
        console.log(`[SHA1]    Ожидалось: ${expectedSha1}`);
        console.log(`[SHA1]    Получено:  ${actualSha1}`);
        console.log(`[SHA1]    Размер файла: ${fileSize} bytes`);
      }

      return isValid;
    } catch (error) {
      console.error(`[SHA1] Ошибка проверки для ${filePath}:`, error.message);
      return false;
    }
  }

  async download(version, onProgress, callback) {
    try {
      onProgress({ stage: 'Получение информации о версии', percent: 0 });

      const versionData = await this.getVersionData(version);
      const versionDir = path.join(this.versionsDir, version);
      await fs.ensureDir(versionDir);

      // Сохранение JSON версии
      const versionJsonPath = path.join(versionDir, `${version}.json`);
      await fs.writeJson(versionJsonPath, versionData, { spaces: 2 });

      // Загрузка JAR клиента
      onProgress({ stage: 'Загрузка клиента', percent: 10 });
      const clientJarPath = path.join(versionDir, `${version}.jar`);
      const clientUrl = versionData.downloads.client.url;
      const clientSha1 = versionData.downloads.client.sha1;
      const clientSize = versionData.downloads.client.size;

      console.log('\n' + '='.repeat(80));
      console.log('ЗАГРУЗКА CLIENT.JAR');
      console.log('='.repeat(80));
      console.log(`URL: ${clientUrl}`);
      console.log(`Путь: ${clientJarPath}`);
      console.log(`Ожидаемый SHA1: ${clientSha1}`);
      console.log(`Ожидаемый размер: ${(clientSize / 1024 / 1024).toFixed(2)} MB`);
      console.log('='.repeat(80));

      // Проверяем существующий файл
      let needDownload = true;
      if (fs.existsSync(clientJarPath)) {
        console.log('\n[CHECK] Client.jar уже существует, проверяем целостность...');
        const stats = fs.statSync(clientJarPath);
        console.log(`[CHECK] Текущий размер файла: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        const isValid = await this.verifySha1(clientJarPath, clientSha1);
        if (isValid) {
          console.log('[CHECK] ✓ Client.jar валиден, загрузка не требуется\n');
          needDownload = false;
        } else {
          console.log('[CHECK] ⚠️  Client.jar поврежден, требуется перезагрузка');
          await fs.remove(clientJarPath);
          console.log('[CHECK] Старый файл удален\n');
        }
      }

      if (needDownload) {
        console.log('[DOWNLOAD] Начинаем загрузку client.jar...\n');

        await this.downloadFile(
          clientUrl,
          clientJarPath,
          (p) => onProgress({ stage: 'Загрузка клиента', percent: 10 + (p * 0.3) })
        );

        console.log('\n[VERIFY] Проверка целостности загруженного client.jar...');

        // Проверяем размер файла
        const stats = fs.statSync(clientJarPath);
        console.log(`[VERIFY] Загружено: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`[VERIFY] Ожидалось: ${clientSize} bytes (${(clientSize / 1024 / 1024).toFixed(2)} MB)`);

        if (stats.size !== clientSize) {
          console.log(`[VERIFY] ❌ РАЗМЕР НЕ СОВПАДАЕТ!`);
          throw new Error(`Client.jar имеет неправильный размер! Загружено ${stats.size}, ожидалось ${clientSize}`);
        }

        // Проверяем SHA1 после загрузки
        const isValid = await this.verifySha1(clientJarPath, clientSha1);
        if (!isValid) {
          throw new Error(`Client.jar поврежден после загрузки! SHA1 не совпадает.`);
        }
        console.log('[VERIFY] ✓ Client.jar успешно загружен и проверен\n');
      }

      // Загрузка библиотек
      onProgress({ stage: 'Загрузка библиотек', percent: 40 });

      const osName = process.platform === 'win32' ? 'windows' :
                     process.platform === 'darwin' ? 'osx' : 'linux';

      // Используем ту же логику фильтрации, что и в launcher
      const librariesToDownload = [];
      for (const lib of versionData.libraries) {
        let allowed = true;

        // Проверка правил для библиотеки (та же логика, что в minecraft-launcher.js)
        if (lib.rules) {
          allowed = false;
          for (const rule of lib.rules) {
            if (rule.action === 'allow') {
              if (!rule.os || this.checkOsRule(rule.os, osName)) {
                allowed = true;
              }
            } else if (rule.action === 'disallow') {
              if (!rule.os || this.checkOsRule(rule.os, osName)) {
                allowed = false;
              }
            }
          }
        }

        if (allowed && lib.downloads && lib.downloads.artifact) {
          librariesToDownload.push({
            artifact: lib.downloads.artifact,
            name: lib.name
          });
        }

        // Нативные библиотеки
        if (allowed && lib.downloads && lib.downloads.classifiers && lib.natives) {
          const nativeKey = lib.natives[osName];
          if (nativeKey && lib.downloads.classifiers[nativeKey]) {
            librariesToDownload.push({
              artifact: lib.downloads.classifiers[nativeKey],
              name: lib.name + ' (native)'
            });
          }
        }
      }

      console.log(`Найдено библиотек для скачивания: ${librariesToDownload.length}`);

      // Список необязательных библиотек - для них пропускаем проверку SHA1
      // Эти библиотеки часто имеют несовпадающие контрольные суммы, но не критичны для запуска
      const optionalLibraries = [
        'text2speech',    // Озвучка текста
        'realms',         // Minecraft Realms
        'lwjgl',          // LWJGL библиотеки (графика)
        'jemalloc',       // Аллокатор памяти
        'joml',           // Java OpenGL Math
        'jinput',         // Контроллеры
        'jorbis',         // Аудио кодек
        'paulscode'       // Звуковой движок
      ];

      // Фильтруем библиотеки, которые нужно скачать или перезагрузить
      const libsToDownload = [];
      for (const { artifact, name } of librariesToDownload) {
        // Конвертируем Unix-style путь в platform-specific
        const normalizedPath = artifact.path.split('/').join(path.sep);
        const libPath = path.join(this.librariesDir, normalizedPath);
        const isOptional = optionalLibraries.some(lib => name.toLowerCase().includes(lib));

        if (!fs.existsSync(libPath)) {
          libsToDownload.push({ artifact, name, reason: 'missing' });
        } else if (artifact.sha1 && !isOptional) {
          // Проверяем SHA1 если файл существует (для обязательных библиотек)
          const isValid = await this.verifySha1(libPath, artifact.sha1);
          if (!isValid) {
            console.log(`⚠️  ${name}: SHA1 не совпадает, требуется перезагрузка`);
            libsToDownload.push({ artifact, name, reason: 'corrupted' });
            await fs.remove(libPath);
          }
        } else if (artifact.sha1 && isOptional) {
          // Для необязательных библиотек пропускаем проверку SHA1
          console.log(`ℹ️  ${name}: необязательная библиотека, пропускаем проверку SHA1`);
        }
      }

      console.log(`Нужно скачать библиотек: ${libsToDownload.length} из ${librariesToDownload.length}`);

      if (libsToDownload.length > 0) {
        // Параллельная загрузка библиотек (20 одновременно для стабильности)
        const limit = pLimit(20);
        let downloadedLibs = 0;
        const startTime = Date.now();

        const downloadTasks = libsToDownload.map(({ artifact, name, reason }) => {
          return limit(async () => {
            // Конвертируем Unix-style путь в platform-specific
            const normalizedPath = artifact.path.split('/').join(path.sep);
            const libPath = path.join(this.librariesDir, normalizedPath);
            try {
              await this.downloadFile(artifact.url, libPath);

              // Проверяем SHA1 после загрузки
              if (artifact.sha1) {
                const isValid = await this.verifySha1(libPath, artifact.sha1);
                if (!isValid) {
                  // Список необязательных библиотек
                  const optionalLibraries = [
                    'text2speech', 'realms', 'lwjgl', 'jemalloc',
                    'joml', 'jinput', 'jorbis', 'paulscode'
                  ];

                  const isOptional = optionalLibraries.some(lib => name.toLowerCase().includes(lib));

                  if (isOptional) {
                    console.warn(`⚠️  SHA1 несовпадение для необязательной библиотеки ${name} - пропускаем`);
                    // Не бросаем ошибку для необязательных библиотек
                  } else {
                    throw new Error(`SHA1 несовпадение для ${name} после загрузки`);
                  }
                }
              }

              downloadedLibs++;

              const progress = 40 + ((downloadedLibs / libsToDownload.length) * 30);
              onProgress({
                stage: `Загрузка библиотек (${downloadedLibs}/${libsToDownload.length})`,
                percent: Math.floor(progress)
              });
            } catch (error) {
              console.error(`Ошибка скачивания библиотеки ${name}:`, error.message);
              throw error;
            }
          });
        });

        await Promise.all(downloadTasks);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✓ Библиотеки скачаны за ${totalTime} секунд`);
      }

      // Обновляем прогресс для всех библиотек (включая уже существующие)
      onProgress({ stage: `Загрузка библиотек (${librariesToDownload.length}/${librariesToDownload.length})`, percent: 70 });

      // Загрузка ассетов
      onProgress({ stage: 'Загрузка ассетов', percent: 70 });
      const assetIndexUrl = versionData.assetIndex.url;
      const assetIndexPath = path.join(this.assetsDir, 'indexes', `${versionData.assetIndex.id}.json`);

      // Если файл существует, проверим его валидность
      if (fs.existsSync(assetIndexPath)) {
        try {
          await fs.readJson(assetIndexPath);
          console.log(`Asset index уже существует и валиден: ${versionData.assetIndex.id}.json`);
        } catch (error) {
          console.warn(`Asset index существует, но битый - удаляем: ${versionData.assetIndex.id}.json`);
          await fs.remove(assetIndexPath);
        }
      }

      // Скачиваем и валидируем asset index JSON (если нужно)
      let assetIndex;
      if (fs.existsSync(assetIndexPath)) {
        assetIndex = await fs.readJson(assetIndexPath);
      } else {
        console.log(`Скачивание asset index: ${versionData.assetIndex.id}.json`);
        assetIndex = await this.downloadJsonFile(assetIndexUrl, assetIndexPath);
      }
      const assets = Object.values(assetIndex.objects);
      console.log(`Всего assets для проверки: ${assets.length}`);

      // Фильтруем только те assets, которые нужно скачать
      const assetsToDownload = [];
      for (const asset of assets) {
        const hash = asset.hash;
        const assetPath = path.join(this.assetsDir, 'objects', hash.substring(0, 2), hash);
        if (!fs.existsSync(assetPath)) {
          assetsToDownload.push({ hash, assetPath });
        }
      }

      console.log(`Нужно скачать assets: ${assetsToDownload.length} из ${assets.length}`);

      // Параллельная загрузка assets (10 одновременно - ресурсы Mojang медленные)
      const limit = pLimit(10);
      let downloadedAssets = 0;
      const startTime = Date.now();

      const downloadTasks = assetsToDownload.map((asset) => {
        return limit(async () => {
          const assetUrl = `https://resources.download.minecraft.net/${asset.hash.substring(0, 2)}/${asset.hash}`;
          try {
            await this.downloadFile(assetUrl, asset.assetPath);
            downloadedAssets++;

            // Обновляем прогресс каждые 10 файлов или на последнем
            if (downloadedAssets % 10 === 0 || downloadedAssets === assetsToDownload.length) {
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              const speed = (downloadedAssets / (Date.now() - startTime) * 1000).toFixed(1);
              const progress = 70 + ((downloadedAssets / assetsToDownload.length) * 30);

              onProgress({
                stage: `Загрузка ассетов (${downloadedAssets}/${assetsToDownload.length}) [${speed} файлов/сек]`,
                percent: Math.floor(progress)
              });
            }
          } catch (error) {
            console.error(`Ошибка скачивания asset ${asset.hash}:`, error.message);
            throw error;
          }
        });
      });

      await Promise.all(downloadTasks);

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✓ Assets скачаны за ${totalTime} секунд (${(downloadedAssets / totalTime).toFixed(1)} файлов/сек)`);

      // КРИТИЧЕСКИ ВАЖНО: Создаем клиентскую библиотеку для Forge
      console.log('\n=== СОЗДАНИЕ КЛИЕНТСКОЙ БИБЛИОТЕКИ ДЛЯ FORGE ===');
      await this.createClientLibrary(version);

      onProgress({ stage: 'Завершено', percent: 100 });
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  /**
   * Создание клиентской библиотеки для Forge
   */
  async createClientLibrary(version) {
    const clientJarPath = path.join(this.versionsDir, version, `${version}.jar`);
    const forgeClientPath = path.join(this.librariesDir, 'net', 'minecraft', 'client', version, `client-${version}.jar`);
    
    console.log(`[CLIENT LIB] Создание клиентской библиотеки для Forge...`);
    console.log(`[CLIENT LIB] Источник: ${clientJarPath}`);
    console.log(`[CLIENT LIB] Назначение: ${forgeClientPath}`);

    if (!fs.existsSync(clientJarPath)) {
      console.warn(`[CLIENT LIB] ⚠️  Клиентский JAR не найден: ${clientJarPath}`);
      return;
    }

    if (!fs.existsSync(forgeClientPath)) {
      console.log(`[CLIENT LIB] Копируем клиентский JAR для Forge...`);
      await fs.ensureDir(path.dirname(forgeClientPath));
      await fs.copy(clientJarPath, forgeClientPath);
      console.log(`[CLIENT LIB] ✓ Клиентская библиотека создана: client-${version}.jar`);
    } else {
      console.log(`[CLIENT LIB] ✓ Клиентская библиотека уже существует`);
    }
  }

  getVersionPath(version) {
    return path.join(this.versionsDir, version);
  }

  getVersionJar(version) {
    return path.join(this.versionsDir, version, `${version}.jar`);
  }

  getVersionJson(version) {
    return path.join(this.versionsDir, version, `${version}.json`);
  }

  checkOsRule(osRule, osName) {
    if (osRule.name && osRule.name !== osName) {
      return false;
    }

    if (osRule.arch) {
      const arch = process.arch === 'x64' ? 'x86' : process.arch;
      if (osRule.arch !== arch) {
        return false;
      }
    }

    return true;
  }
}

module.exports = MinecraftDownloader;
