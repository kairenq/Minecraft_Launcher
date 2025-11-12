const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const extract = require('extract-zip');
const execPromise = promisify(exec);

class JavaDownloader {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.javaDir = path.join(launcherDir, 'java');

    fs.ensureDirSync(this.javaDir);
  }

  async checkJava() {
    const javaPath = this.getJavaPath();
    if (!javaPath || !fs.existsSync(javaPath)) {
      return false;
    }

    try {
      const { stdout } = await execPromise(`"${javaPath}" -version`);
      return true;
    } catch (error) {
      return false;
    }
  }

  getJavaPath() {
    const platform = process.platform;

    if (platform === 'win32') {
      const javaExe = path.join(this.javaDir, 'bin', 'java.exe');
      return fs.existsSync(javaExe) ? javaExe : null;
    } else {
      const javaBin = path.join(this.javaDir, 'bin', 'java');
      return fs.existsSync(javaBin) ? javaBin : null;
    }
  }

  getDownloadUrl() {
    const platform = process.platform;
    const arch = process.arch;

    // Adoptium OpenJDK 17 (LTS) - рекомендуется для Minecraft 1.18+
    const baseUrl = 'https://api.adoptium.net/v3/binary/latest/17/ga';

    let os, architecture;

    if (platform === 'win32') {
      os = 'windows';
      architecture = arch === 'x64' ? 'x64' : 'x86';
    } else if (platform === 'darwin') {
      os = 'mac';
      architecture = arch === 'arm64' ? 'aarch64' : 'x64';
    } else {
      os = 'linux';
      architecture = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'aarch64' : 'x32';
    }

    return `${baseUrl}/${os}/${architecture}/jdk/hotspot/normal/eclipse`;
  }

  async download(onProgress, callback) {
    try {
      onProgress({ stage: 'Загрузка Java', percent: 0 });

      const downloadUrl = this.getDownloadUrl();
      const tempFile = path.join(this.launcherDir, 'java-temp.zip');

      // Загрузка архива
      const response = await axios({
        url: downloadUrl,
        method: 'GET',
        responseType: 'stream',
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.floor((progressEvent.loaded / progressEvent.total) * 70);
            onProgress({ stage: 'Загрузка Java', percent: percent });
          }
        }
      });

      const writer = fs.createWriteStream(tempFile);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      onProgress({ stage: 'Распаковка Java', percent: 70 });

      // Очистка старой директории Java
      await fs.emptyDir(this.javaDir);

      // Распаковка
      await extract(tempFile, { dir: this.javaDir });

      // Перемещение содержимого из вложенной директории (если есть)
      const contents = await fs.readdir(this.javaDir);
      if (contents.length === 1) {
        const innerDir = path.join(this.javaDir, contents[0]);
        const stat = await fs.stat(innerDir);

        if (stat.isDirectory()) {
          const innerContents = await fs.readdir(innerDir);
          for (const item of innerContents) {
            await fs.move(
              path.join(innerDir, item),
              path.join(this.javaDir, item),
              { overwrite: true }
            );
          }
          await fs.remove(innerDir);
        }
      }

      // Установка прав на выполнение для Linux/Mac
      if (process.platform !== 'win32') {
        const javaExec = path.join(this.javaDir, 'bin', 'java');
        await fs.chmod(javaExec, 0o755);
      }

      // Удаление временного файла
      await fs.remove(tempFile);

      onProgress({ stage: 'Java установлена', percent: 100 });
      callback(null);
    } catch (error) {
      callback(new Error(`Ошибка загрузки Java: ${error.message}`));
    }
  }
}

module.exports = JavaDownloader;
