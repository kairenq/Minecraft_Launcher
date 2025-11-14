const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const pLimit = require('p-limit');

class ModsDownloader {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
  }

  /**
   * Скачивание модов для сборки
   * @param {Array} mods - Массив объектов модов
   * @param {string} gameDir - Директория игры
   * @param {function} onProgress - Колбэк прогресса
   */
  async downloadMods(mods, gameDir, onProgress) {
    if (!mods || mods.length === 0) {
      console.log('[MODS] Моды не требуются');
      return { success: true, downloaded: 0 };
    }

    console.log(`\n=== ЗАГРУЗКА МОДОВ ===`);
    console.log(`Модов для загрузки: ${mods.length}`);

    const modsDir = path.join(gameDir, 'mods');
    await fs.ensureDir(modsDir);

    let downloaded = 0;
    let skipped = 0;
    const errors = [];

    // МАКСИМАЛЬНАЯ СКОРОСТЬ - Параллельная загрузка модов (20 одновременно)
    const limit = pLimit(20);
    let processed = 0;

    const downloadTasks = mods.map((mod, i) => {
      return limit(async () => {
        try {
          console.log(`\n[MOD ${i + 1}/${mods.length}] ${mod.name}`);

          if (mod.url) {
            // Скачивание по URL
            const fileName = mod.fileName || this.getFileNameFromUrl(mod.url);
            const filePath = path.join(modsDir, fileName);

            if (fs.existsSync(filePath)) {
              console.log(`  Уже существует: ${fileName}`);
              skipped++;
            } else {
              console.log(`  URL: ${mod.url}`);
              console.log(`  Сохранение: ${fileName}`);

              await this.downloadFile(mod.url, filePath);
              downloaded++;
              console.log(`  ✓ Загружен`);
            }

          } else if (mod.fileName) {
            // Мод должен быть скопирован вручную
            const filePath = path.join(modsDir, mod.fileName);

            if (fs.existsSync(filePath)) {
              console.log(`  Уже существует: ${mod.fileName}`);
              skipped++;
            } else {
              console.warn(`  ⚠️  Файл не найден: ${mod.fileName}`);
              console.warn(`  Пожалуйста, скопируйте мод вручную в: ${modsDir}`);
              errors.push(`${mod.name}: файл не найден`);
            }

          } else {
            console.warn(`  ⚠️  Нет URL и fileName для мода`);
            errors.push(`${mod.name}: нет источника загрузки`);
          }

          processed++;
          const progress = Math.floor((processed / mods.length) * 100);
          onProgress({
            stage: `Загрузка модов (${processed}/${mods.length})`,
            percent: progress
          });

        } catch (error) {
          console.error(`  ❌ Ошибка: ${error.message}`);
          errors.push(`${mod.name}: ${error.message}`);
        }
      });
    });

    await Promise.all(downloadTasks);

    console.log(`\n=== ИТОГИ ЗАГРУЗКИ МОДОВ ===`);
    console.log(`Загружено: ${downloaded}`);
    console.log(`Пропущено (уже есть): ${skipped}`);
    console.log(`Ошибок: ${errors.length}`);

    if (errors.length > 0) {
      console.warn(`\nОшибки загрузки:`);
      errors.forEach(err => console.warn(`  - ${err}`));
    }

    onProgress({ stage: 'Моды загружены', percent: 100 });

    return {
      success: errors.length === 0,
      downloaded,
      skipped,
      errors
    };
  }

  /**
   * Скачивание одного файла
   */
  async downloadFile(url, dest) {
    const response = await axios({
      url: url,
      method: 'GET',
      responseType: 'stream',
      timeout: 120000, // 2 минуты на один мод
      maxRedirects: 10
    });

    await fs.ensureDir(path.dirname(dest));

    const writer = fs.createWriteStream(dest);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
      response.data.pipe(writer);
    });
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

      // Если нет расширения .jar - добавляем
      if (!fileName.endsWith('.jar')) {
        fileName += '.jar';
      }

      return fileName;
    } catch (error) {
      // Если не удалось распарсить URL - генерируем имя
      return `mod-${Date.now()}.jar`;
    }
  }

  /**
   * Проверка установленных модов
   */
  async checkMods(mods, gameDir) {
    if (!mods || mods.length === 0) {
      return { allInstalled: true, missing: [] };
    }

    const modsDir = path.join(gameDir, 'mods');

    if (!fs.existsSync(modsDir)) {
      return { allInstalled: false, missing: mods.map(m => m.name) };
    }

    const missing = [];

    for (const mod of mods) {
      const fileName = mod.fileName || this.getFileNameFromUrl(mod.url);
      const filePath = path.join(modsDir, fileName);

      if (!fs.existsSync(filePath)) {
        missing.push(mod.name);
      }
    }

    return {
      allInstalled: missing.length === 0,
      missing
    };
  }
}

module.exports = ModsDownloader;
