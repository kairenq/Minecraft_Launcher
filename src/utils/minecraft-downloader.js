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

  async downloadFile(url, dest, onProgress, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios({
          url: url,
          method: 'GET',
          responseType: 'stream',
          validateStatus: (status) => status === 200 // Только 200 OK считается успехом
        });

        const totalLength = response.headers['content-length'];
        let downloadedLength = 0;

        response.data.on('data', (chunk) => {
          downloadedLength += chunk.length;
          if (onProgress && totalLength) {
            const progress = Math.floor((downloadedLength / totalLength) * 100);
            onProgress(progress);
          }
        });

        await fs.ensureDir(path.dirname(dest));
        await streamPipeline(response.data, fs.createWriteStream(dest));

        // Успешно скачано
        return;
      } catch (error) {
        console.error(`Ошибка скачивания ${url} (попытка ${attempt + 1}/${retries}):`, error.message);

        // Удаляем битый файл если он был создан
        if (fs.existsSync(dest)) {
          await fs.remove(dest);
        }

        // Если это последняя попытка - выбрасываем ошибку
        if (attempt === retries - 1) {
          throw new Error(`Не удалось скачать файл после ${retries} попыток: ${url}\nОшибка: ${error.message}`);
        }

        // Ждём перед следующей попыткой (экспоненциальный backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
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
      return true; // Если SHA1 не предоставлен, пропускаем проверку
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash('sha1');
      hash.update(fileBuffer);
      const actualSha1 = hash.digest('hex');

      const isValid = actualSha1.toLowerCase() === expectedSha1.toLowerCase();

      if (!isValid) {
        console.log(`❌ SHA1 несовпадение для ${path.basename(filePath)}`);
        console.log(`   Ожидалось: ${expectedSha1}`);
        console.log(`   Получено:  ${actualSha1}`);
      }

      return isValid;
    } catch (error) {
      console.error(`Ошибка проверки SHA1 для ${filePath}:`, error.message);
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
      const clientSha1 = versionData.downloads.client.sha1;

      // Проверяем существующий файл
      let needDownload = true;
      if (fs.existsSync(clientJarPath)) {
        console.log('Проверка целостности client.jar...');
        const isValid = await this.verifySha1(clientJarPath, clientSha1);
        if (isValid) {
          console.log('✓ Client.jar уже существует и валиден');
          needDownload = false;
        } else {
          console.log('⚠️  Client.jar поврежден, требуется перезагрузка');
          await fs.remove(clientJarPath);
        }
      }

      if (needDownload) {
        await this.downloadFile(
          versionData.downloads.client.url,
          clientJarPath,
          (p) => onProgress({ stage: 'Загрузка клиента', percent: 10 + (p * 0.3) })
        );

        // Проверяем SHA1 после загрузки
        console.log('Проверка целостности загруженного client.jar...');
        const isValid = await this.verifySha1(clientJarPath, clientSha1);
        if (!isValid) {
          throw new Error(`Client.jar поврежден после загрузки! SHA1 не совпадает.`);
        }
        console.log('✓ Client.jar загружен и проверен');
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

      // Фильтруем библиотеки, которые нужно скачать или перезагрузить
      const libsToDownload = [];
      for (const { artifact, name } of librariesToDownload) {
        const libPath = path.join(this.librariesDir, artifact.path);

        if (!fs.existsSync(libPath)) {
          libsToDownload.push({ artifact, name, reason: 'missing' });
        } else if (artifact.sha1) {
          // Проверяем SHA1 если файл существует
          const isValid = await this.verifySha1(libPath, artifact.sha1);
          if (!isValid) {
            console.log(`⚠️  ${name}: SHA1 не совпадает, требуется перезагрузка`);
            libsToDownload.push({ artifact, name, reason: 'corrupted' });
            await fs.remove(libPath);
          }
        }
      }

      console.log(`Нужно скачать библиотек: ${libsToDownload.length} из ${librariesToDownload.length}`);

      if (libsToDownload.length > 0) {
        // Параллельная загрузка библиотек (10 одновременно)
        const limit = pLimit(10);
        let downloadedLibs = 0;
        const startTime = Date.now();

        const downloadTasks = libsToDownload.map(({ artifact, name, reason }) => {
          return limit(async () => {
            const libPath = path.join(this.librariesDir, artifact.path);
            try {
              await this.downloadFile(artifact.url, libPath);

              // Проверяем SHA1 после загрузки
              if (artifact.sha1) {
                const isValid = await this.verifySha1(libPath, artifact.sha1);
                if (!isValid) {
                  throw new Error(`SHA1 несовпадение для ${name} после загрузки`);
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

      // Параллельная загрузка assets (20 одновременно)
      const limit = pLimit(20);
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

      onProgress({ stage: 'Завершено', percent: 100 });
      callback(null);
    } catch (error) {
      callback(error);
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
