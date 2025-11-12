const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

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

    return fs.existsSync(versionJson) && fs.existsSync(versionJar);
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

  async downloadFile(url, dest, onProgress) {
    const response = await axios({
      url: url,
      method: 'GET',
      responseType: 'stream'
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
      await this.downloadFile(
        versionData.downloads.client.url,
        clientJarPath,
        (p) => onProgress({ stage: 'Загрузка клиента', percent: 10 + (p * 0.3) })
      );

      // Загрузка библиотек
      onProgress({ stage: 'Загрузка библиотек', percent: 40 });
      const libraries = versionData.libraries.filter(lib => {
        // Фильтрация библиотек по ОС
        if (lib.rules) {
          for (const rule of lib.rules) {
            if (rule.os) {
              const osName = process.platform === 'win32' ? 'windows' :
                            process.platform === 'darwin' ? 'osx' : 'linux';
              if (rule.os.name && rule.os.name !== osName) {
                return rule.action === 'disallow';
              }
            }
          }
        }
        return lib.downloads && lib.downloads.artifact;
      });

      for (let i = 0; i < libraries.length; i++) {
        const lib = libraries[i];
        if (lib.downloads && lib.downloads.artifact) {
          const artifact = lib.downloads.artifact;
          const libPath = path.join(this.librariesDir, artifact.path);

          if (!fs.existsSync(libPath)) {
            await this.downloadFile(artifact.url, libPath);
          }

          const progress = 40 + ((i / libraries.length) * 30);
          onProgress({ stage: `Загрузка библиотек (${i + 1}/${libraries.length})`, percent: Math.floor(progress) });
        }
      }

      // Загрузка ассетов
      onProgress({ stage: 'Загрузка ассетов', percent: 70 });
      const assetIndexUrl = versionData.assetIndex.url;
      const assetIndexPath = path.join(this.assetsDir, 'indexes', `${versionData.assetIndex.id}.json`);

      await this.downloadFile(assetIndexUrl, assetIndexPath);

      const assetIndex = await fs.readJson(assetIndexPath);
      const assets = Object.values(assetIndex.objects);

      let downloadedAssets = 0;
      for (const asset of assets) {
        const hash = asset.hash;
        const assetPath = path.join(this.assetsDir, 'objects', hash.substring(0, 2), hash);

        if (!fs.existsSync(assetPath)) {
          const assetUrl = `https://resources.download.minecraft.net/${hash.substring(0, 2)}/${hash}`;
          await this.downloadFile(assetUrl, assetPath);
        }

        downloadedAssets++;
        const progress = 70 + ((downloadedAssets / assets.length) * 30);
        onProgress({ stage: `Загрузка ассетов (${downloadedAssets}/${assets.length})`, percent: Math.floor(progress) });
      }

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
}

module.exports = MinecraftDownloader;
