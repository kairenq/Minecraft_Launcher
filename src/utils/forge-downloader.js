const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

class ForgeDownloader {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
  }

  /**
   * Скачивание Forge installer и создание папки
   */
  async downloadForgeInstaller(minecraftVersion, forgeVersion, onProgress) {
    const fullForgeVersion = `${minecraftVersion}-${forgeVersion}`;
    const versionId = `${minecraftVersion}-forge-${forgeVersion}`;
    const versionDir = path.join(this.versionsDir, versionId);

    console.log(`[FORGE-DOWNLOADER] Установка Forge ${fullForgeVersion}`);
    console.log(`[FORGE-DOWNLOADER] Путь: ${versionDir}`);

    // Создаем папку ВЕРСИИ если не существует
    await fs.ensureDir(versionDir);

    const forgeJarPath = path.join(versionDir, 'forge-installer.jar');
    
    // Если файл уже существует - пропускаем загрузку
    if (fs.existsSync(forgeJarPath)) {
      console.log(`[FORGE-DOWNLOADER] Forge installer уже существует`);
      return { forgeJarPath, versionId };
    }

    // Скачиваем Forge installer
    onProgress({ stage: 'Скачивание Forge installer', percent: 10 });
    
    const forgeUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}-installer.jar`;
    console.log(`[FORGE-DOWNLOADER] Загрузка: ${forgeUrl}`);

    try {
      const response = await axios({
        url: forgeUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000
      });

      const writer = fs.createWriteStream(forgeJarPath);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.pipe(writer);
      });

      console.log(`[FORGE-DOWNLOADER] ✓ Forge installer загружен: ${forgeJarPath}`);
      onProgress({ stage: 'Forge installer загружен', percent: 30 });

      return { forgeJarPath, versionId };

    } catch (error) {
      console.error(`[FORGE-DOWNLOADER] Ошибка загрузки: ${error.message}`);
      throw new Error(`Не удалось скачать Forge: ${error.message}`);
    }
  }

  /**
   * Проверка существования Forge installer
   */
  async checkForgeInstallerExists(minecraftVersion, forgeVersion) {
    const versionId = `${minecraftVersion}-forge-${forgeVersion}`;
    const versionDir = path.join(this.versionsDir, versionId);
    const forgeJarPath = path.join(versionDir, 'forge-installer.jar');
    
    return fs.existsSync(forgeJarPath);
  }
}

module.exports = ForgeDownloader;
