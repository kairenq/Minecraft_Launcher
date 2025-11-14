const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class ArchiveDownloader {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.tempDir = path.join(launcherDir, 'temp');
  }

  /**
   * Скачивание и распаковка архива с готовой сборкой
   * @param {string} archiveUrl - URL архива (ZIP/RAR/7z)
   * @param {string} instanceDir - Директория для распаковки
   * @param {function} onProgress - Колбэк прогресса
   */
  async downloadAndExtract(archiveUrl, instanceDir, onProgress) {
    console.log(`\n=== ЗАГРУЗКА АРХИВА СБОРКИ ===`);
    console.log(`URL: ${archiveUrl}`);
    console.log(`Распаковка в: ${instanceDir}`);

    await fs.ensureDir(this.tempDir);
    await fs.ensureDir(instanceDir);

    const fileName = this.getFileNameFromUrl(archiveUrl);
    const tempFile = path.join(this.tempDir, fileName);

    try {
      // Скачивание архива
      onProgress({ stage: 'Скачивание архива сборки', percent: 0 });
      console.log(`[ARCHIVE] Загрузка: ${fileName}`);

      await this.downloadFile(archiveUrl, tempFile, (progress) => {
        onProgress({
          stage: `Скачивание архива (${Math.floor(progress)}%)`,
          percent: Math.floor(progress * 0.7) // 0-70%
        });
      });

      console.log(`[ARCHIVE] ✓ Архив загружен: ${tempFile}`);
      console.log(`[ARCHIVE] Размер: ${(fs.statSync(tempFile).size / 1024 / 1024).toFixed(2)} MB`);

      // Определение типа архива и распаковка
      onProgress({ stage: 'Распаковка архива', percent: 70 });
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.zip') {
        await this.extractZip(tempFile, instanceDir, onProgress);
      } else if (ext === '.rar') {
        await this.extractRar(tempFile, instanceDir, onProgress);
      } else if (ext === '.7z') {
        await this.extract7z(tempFile, instanceDir, onProgress);
      } else {
        throw new Error(`Неподдерживаемый формат архива: ${ext}`);
      }

      // Очистка
      onProgress({ stage: 'Очистка временных файлов', percent: 95 });
      await fs.remove(tempFile);
      console.log(`[ARCHIVE] ✓ Временный файл удалён`);

      onProgress({ stage: 'Архив установлен', percent: 100 });
      console.log(`[ARCHIVE] ✓ Сборка распакована успешно`);

      return { success: true };

    } catch (error) {
      console.error(`[ARCHIVE] Ошибка: ${error.message}`);

      // Очистка при ошибке
      if (fs.existsSync(tempFile)) {
        await fs.remove(tempFile);
      }

      throw new Error(`Не удалось установить архив: ${error.message}`);
    }
  }

  /**
   * Скачивание файла с прогрессом и retry логикой
   */
  async downloadFile(url, dest, onProgress) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[ARCHIVE] Попытка загрузки ${attempt + 1}/${maxRetries}`);

        const response = await axios({
          url: url,
          method: 'GET',
          responseType: 'stream',
          timeout: 600000, // 10 минут на архив
          maxRedirects: 10,
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        await fs.ensureDir(path.dirname(dest));
        const writer = fs.createWriteStream(dest);

        response.data.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize && onProgress) {
            const progress = (downloadedSize / totalSize) * 100;
            onProgress(progress);
          }
        });

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
          response.data.on('error', reject);
          response.data.pipe(writer);
        });

        // Проверка что файл не пустой
        const stats = await fs.stat(dest);
        if (stats.size === 0) {
          throw new Error('Загружен пустой файл');
        }

        console.log(`[ARCHIVE] ✓ Файл загружен успешно (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        return; // Успешно загружено

      } catch (error) {
        lastError = error;
        console.error(`[ARCHIVE] Ошибка загрузки (попытка ${attempt + 1}): ${error.message}`);

        // Удаляем частично загруженный файл
        if (fs.existsSync(dest)) {
          await fs.remove(dest);
        }

        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
          console.log(`[ARCHIVE] Ожидание ${waitTime / 1000}с перед следующей попыткой...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw new Error(`Не удалось загрузить архив после ${maxRetries} попыток: ${lastError.message}`);
  }

  /**
   * Извлечение ZIP архива
   */
  async extractZip(zipPath, destDir, onProgress) {
    console.log(`[ARCHIVE] Распаковка ZIP: ${zipPath}`);

    try {
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();

      if (zipEntries.length === 0) {
        throw new Error('Архив пуст');
      }

      console.log(`[ARCHIVE] Файлов в архиве: ${zipEntries.length}`);

      // Проверяем структуру архива
      const hasRootFolder = this.checkArchiveStructure(zipEntries);

      if (hasRootFolder) {
        // Архив содержит корневую папку - извлекаем её содержимое
        console.log(`[ARCHIVE] Обнаружена корневая папка, извлекаем её содержимое`);
        const rootFolderName = zipEntries[0].entryName.split('/')[0];

        const tempExtractDir = path.join(this.tempDir, `extract-${Date.now()}`);
        await fs.ensureDir(tempExtractDir);

        zip.extractAllTo(tempExtractDir, true);
        const extractedRoot = path.join(tempExtractDir, rootFolderName);

        // Проверяем что корневая папка существует
        if (!fs.existsSync(extractedRoot)) {
          throw new Error(`Корневая папка ${rootFolderName} не найдена после распаковки`);
        }

        // Копируем содержимое в целевую директорию
        await fs.copy(extractedRoot, destDir, { overwrite: true });
        await fs.remove(tempExtractDir);
      } else {
        // Архив без корневой папки - извлекаем напрямую
        console.log(`[ARCHIVE] Извлечение напрямую в директорию`);
        zip.extractAllTo(destDir, true);
      }

      // Проверяем что содержимое успешно распаковано
      const extractedFiles = await fs.readdir(destDir);
      console.log(`[ARCHIVE] Распаковано файлов/папок: ${extractedFiles.length}`);

      if (extractedFiles.length === 0) {
        throw new Error('После распаковки директория пуста');
      }

      onProgress({ stage: 'Архив распакован', percent: 90 });
      console.log(`[ARCHIVE] ✓ ZIP распакован успешно`);

    } catch (error) {
      console.error(`[ARCHIVE] Ошибка распаковки ZIP:`, error);
      throw new Error(`Ошибка распаковки ZIP: ${error.message}`);
    }
  }

  /**
   * Извлечение RAR архива (требует unrar)
   */
  async extractRar(rarPath, destDir, onProgress) {
    console.log(`[ARCHIVE] Распаковка RAR: ${rarPath}`);
    console.log(`[ARCHIVE] ⚠️  Требуется установленный UnRAR`);

    try {
      // Проверка наличия unrar
      await execAsync('unrar -?').catch(() => {
        throw new Error(
          'UnRAR не установлен!\n\n' +
          'Для работы с RAR архивами установите UnRAR:\n' +
          'Windows: скачайте с https://www.rarlab.com/rar_add.htm\n' +
          'Linux: sudo apt-get install unrar\n' +
          'macOS: brew install unrar\n\n' +
          'Или используйте ZIP архив вместо RAR.'
        );
      });

      // Распаковка
      const command = process.platform === 'win32'
        ? `"unrar" x -o+ "${rarPath}" "${destDir}"`
        : `unrar x -o+ "${rarPath}" "${destDir}"`;

      await execAsync(command);

      onProgress({ stage: 'Архив распакован', percent: 90 });
      console.log(`[ARCHIVE] ✓ RAR распакован`);

    } catch (error) {
      throw new Error(`Ошибка распаковки RAR: ${error.message}`);
    }
  }

  /**
   * Извлечение 7z архива (требует 7-Zip)
   */
  async extract7z(archivePath, destDir, onProgress) {
    console.log(`[ARCHIVE] Распаковка 7z: ${archivePath}`);
    console.log(`[ARCHIVE] ⚠️  Требуется установленный 7-Zip`);

    try {
      // Проверка наличия 7z
      const command7z = process.platform === 'win32' ? '7z' : '7za';

      await execAsync(`${command7z} -?`).catch(() => {
        throw new Error(
          '7-Zip не установлен!\n\n' +
          'Для работы с 7z архивами установите 7-Zip:\n' +
          'Windows: скачайте с https://www.7-zip.org/\n' +
          'Linux: sudo apt-get install p7zip-full\n' +
          'macOS: brew install p7zip\n\n' +
          'Или используйте ZIP архив вместо 7z.'
        );
      });

      // Распаковка
      const command = `${command7z} x -y -o"${destDir}" "${archivePath}"`;
      await execAsync(command);

      onProgress({ stage: 'Архив распакован', percent: 90 });
      console.log(`[ARCHIVE] ✓ 7z распакован`);

    } catch (error) {
      throw new Error(`Ошибка распаковки 7z: ${error.message}`);
    }
  }

  /**
   * Проверка структуры архива
   * Возвращает true если все файлы в одной корневой папке
   */
  checkArchiveStructure(zipEntries) {
    if (zipEntries.length === 0) return false;

    // Получаем все пути верхнего уровня
    const topLevelPaths = new Set();

    for (const entry of zipEntries) {
      const parts = entry.entryName.split('/');
      if (parts.length > 0 && parts[0]) {
        topLevelPaths.add(parts[0]);
      }
    }

    // Если только один путь верхнего уровня - это корневая папка
    return topLevelPaths.size === 1;
  }

  /**
   * Получение имени файла из URL
   */
  getFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      let fileName = path.basename(urlObj.pathname);

      // Убираем query параметры
      fileName = fileName.split('?')[0];

      return fileName || `modpack-${Date.now()}.zip`;
    } catch (error) {
      return `modpack-${Date.now()}.zip`;
    }
  }

  /**
   * Проверка установленной сборки из архива
   */
  async checkInstalled(instanceDir) {
    if (!fs.existsSync(instanceDir)) {
      return false;
    }

    // Проверяем что есть директория mods
    const modsDir = path.join(instanceDir, 'mods');
    if (!fs.existsSync(modsDir)) {
      return false;
    }

    // Проверяем что в mods есть хотя бы один файл
    const files = await fs.readdir(modsDir);
    return files.length > 0;
  }
}

module.exports = ArchiveDownloader;
