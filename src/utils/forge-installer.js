const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

class ForgeInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.versionsDir = path.join(launcherDir, 'versions');
  }

  async installForge(mcVersion, forgeVersion, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeDir = path.join(this.versionsDir, forgeId);
    
    console.log(`[FORGE] Установка Forge ${forgeVersion} для Minecraft ${mcVersion}...`);
    
    // Создаем директории
    await this.createDirectories();
    
    // Скачиваем и устанавливаем Forge
    await this.downloadAndInstallForge(mcVersion, forgeVersion, forgeDir, onProgress);
    
    console.log(`[FORGE] ✓ Forge ${forgeVersion} успешно установлен!`);
    return forgeId;
  }

  async createDirectories() {
    const dirs = [
      this.versionsDir,
      this.librariesDir,
      path.join(this.launcherDir, 'natives')
    ];
    
    for (const dir of dirs) {
      await fs.ensureDir(dir);
    }
  }

  async downloadAndInstallForge(mcVersion, forgeVersion, forgeDir, onProgress) {
    const forgeUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
    const installerPath = path.join(forgeDir, 'forge-installer.jar');
    
    // Скачиваем установщик
    await this.downloadFileWithProgress(forgeUrl, installerPath, onProgress);
    
    try {
      // Пытаемся установить через установщик
      await this.runForgeInstaller(installerPath, forgeDir);
    } catch (error) {
      console.log('[FORGE] Установка через installer не удалась, используем ручную установку...');
      await this.manualForgeInstall(mcVersion, forgeVersion, forgeDir, onProgress);
    }
  }

  async runForgeInstaller(installerPath, forgeDir) {
    execSync(`java -jar "${installerPath}" --installClient`, {
      cwd: forgeDir,
      stdio: 'pipe'
    });
  }

  async manualForgeInstall(mcVersion, forgeVersion, forgeDir, onProgress) {
    // Создаем директорию для версии
    await fs.ensureDir(forgeDir);

    // Критически важные файлы Forge
    const criticalFiles = [
      {
        url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}.json`,
        path: path.join(forgeDir, `${mcVersion}-forge-${forgeVersion}.json`),
        name: 'JSON конфигурация'
      },
      {
        url: `https://maven.minecraftforge.net/net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}/fmlcore-${mcVersion}-${forgeVersion}.jar`,
        path: path.join(this.librariesDir, 'net', 'minecraftforge', 'fmlcore', `${mcVersion}-${forgeVersion}`, `fmlcore-${mcVersion}-${forgeVersion}.jar`),
        name: 'FML Core'
      },
      {
        url: `https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}/javafmllanguage-${mcVersion}-${forgeVersion}.jar`,
        path: path.join(this.librariesDir, 'net', 'minecraftforge', 'javafmllanguage', `${mcVersion}-${forgeVersion}`, `javafmllanguage-${mcVersion}-${forgeVersion}.jar`),
        name: 'Java FML Language'
      },
      {
        url: `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}/lowcodelanguage-${mcVersion}-${forgeVersion}.jar`,
        path: path.join(this.librariesDir, 'net', 'minecraftforge', 'lowcodelanguage', `${mcVersion}-${forgeVersion}`, `lowcodelanguage-${mcVersion}-${forgeVersion}.jar`),
        name: 'Lowcode Language'
      },
      {
        url: `https://maven.minecraftforge.net/net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}/mclanguage-${mcVersion}-${forgeVersion}.jar`,
        path: path.join(this.librariesDir, 'net', 'minecraftforge', 'mclanguage', `${mcVersion}-${forgeVersion}`, `mclanguage-${mcVersion}-${forgeVersion}.jar`),
        name: 'MC Language'
      }
    ];

    // Скачиваем все критические файлы
    for (let i = 0; i < criticalFiles.length; i++) {
      const file = criticalFiles[i];
      await fs.ensureDir(path.dirname(file.path));
      
      if (onProgress) {
        onProgress({
          stage: `Загрузка ${file.name}`,
          percent: Math.round((i / criticalFiles.length) * 100)
        });
      }
      
      await this.downloadFile(file.url, file.path);
    }

    // Создаем минимальный JSON конфиг если не скачался
    await this.createMinimalForgeJson(mcVersion, forgeVersion, forgeDir);
  }

  async createMinimalForgeJson(mcVersion, forgeVersion, forgeDir) {
    const jsonPath = path.join(forgeDir, `${mcVersion}-forge-${forgeVersion}.json`);
    
    if (!await fs.pathExists(jsonPath)) {
      const minimalJson = {
        id: `${mcVersion}-forge-${forgeVersion}`,
        time: new Date().toISOString(),
        releaseTime: new Date().toISOString(),
        type: "release",
        mainClass: "net.minecraft.client.main.Main",
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
            name: `net.minecraftforge:forge:${mcVersion}-${forgeVersion}`
          }
        ]
      };
      
      await fs.writeJson(jsonPath, minimalJson, { spaces: 2 });
    }
  }

  downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      
      https.get(url, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else if (response.statusCode === 404) {
          console.log(`[FORGE] Файл не найден: ${url}`);
          file.close();
          fs.remove(filePath).then(resolve);
        } else {
          reject(new Error(`Ошибка загрузки ${url}: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        fs.remove(filePath).then(() => reject(err));
      });
    });
  }

  downloadFileWithProgress(url, filePath, onProgress) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Ошибка загрузки: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        const file = fs.createWriteStream(filePath);
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize) {
            onProgress({
              stage: 'Загрузка Forge',
              percent: Math.round((downloadedSize / totalSize) * 100)
            });
          }
        });

        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });

      }).on('error', (err) => {
        fs.remove(filePath).then(() => reject(err));
      });
    });
  }
}

module.exports = ForgeInstaller;
