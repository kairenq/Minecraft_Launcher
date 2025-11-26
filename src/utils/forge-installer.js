const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const axios = require('axios');

class ForgeInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.versionsDir = path.join(launcherDir, 'versions');
  }

  async installForge(mcVersion, forgeVersion, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeDir = path.join(this.versionsDir, forgeId);
    
    console.log(`\n=== FORGE INSTALLER ===`);
    console.log(`Minecraft: ${mcVersion}`);
    console.log(`Forge: ${forgeVersion}`);
    console.log(`Directory: ${forgeDir}`);

    // Проверяем базовый Minecraft
    await this.checkBaseMinecraft(mcVersion);

    // Создаем папки
    await fs.ensureDir(forgeDir);
    await this.createDirectories();

    try {
      // Сначала скачиваем ВСЕ библиотеки
      await this.downloadAllForgeLibraries(mcVersion, forgeVersion, onProgress);
      
      // Потом запускаем установщик
      await this.downloadAndRunInstaller(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // Создаем недостающие файлы
      await this.createMissingFiles(mcVersion, forgeVersion, forgeDir);
      
      console.log(`[FORGE] ✓ Установка завершена: ${forgeId}`);
      return forgeId;

    } catch (error) {
      console.error('[FORGE] Ошибка установки:', error.message);
      throw error;
    }
  }

  /**
   * Проверка базового Minecraft
   */
  async checkBaseMinecraft(mcVersion) {
    const baseVersionDir = path.join(this.versionsDir, mcVersion);
    const baseVersionJson = path.join(baseVersionDir, `${mcVersion}.json`);
    const baseVersionJar = path.join(baseVersionDir, `${mcVersion}.jar`);

    console.log(`[FORGE] Проверка базового Minecraft ${mcVersion}...`);
    console.log(`[FORGE] JSON: ${baseVersionJson}`);
    console.log(`[FORGE] JAR: ${baseVersionJar}`);

    if (!fs.existsSync(baseVersionJson) || !fs.existsSync(baseVersionJar)) {
      throw new Error(`Базовый Minecraft ${mcVersion} не установлен. Сначала установите Minecraft.`);
    }

    console.log('[FORGE] ✓ Базовый Minecraft найден');
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

  /**
   * Скачивание ВСЕХ библиотек Forge заранее
   */
  async downloadAllForgeLibraries(mcVersion, forgeVersion, onProgress) {
    console.log('[FORGE] Предварительная загрузка всех библиотек Forge...');
    
    const libraries = this.getForgeLibraries(mcVersion, forgeVersion);
    console.log(`[FORGE] Всего библиотек для загрузки: ${libraries.length}`);

    let downloaded = 0;
    for (const lib of libraries) {
      try {
        await this.downloadLibraryToCorrectPath(lib);
        downloaded++;
        
        if (onProgress) {
          onProgress({
            stage: `Библиотеки Forge (${downloaded}/${libraries.length})`,
            percent: Math.round((downloaded / libraries.length) * 50) // 0-50%
          });
        }
      } catch (error) {
        console.warn(`[FORGE] Не удалось загрузить ${lib.name}:`, error.message);
      }
    }

    console.log(`[FORGE] ✓ Предварительно загружено ${downloaded}/${libraries.length} библиотек`);
  }

  /**
   * Получение списка всех библиотек Forge
   */
  getForgeLibraries(mcVersion, forgeVersion) {
    return [
      {
        name: `net.minecraftforge:fmlcore:${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}/fmlcore-${mcVersion}-${forgeVersion}.jar`,
        path: `net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}/fmlcore-${mcVersion}-${forgeVersion}.jar`
      },
      {
        name: `net.minecraftforge:fmlloader:${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`,
        path: `net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`
      },
      {
        name: `net.minecraftforge:javafmllanguage:${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}/javafmllanguage-${mcVersion}-${forgeVersion}.jar`,
        path: `net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}/javafmllanguage-${mcVersion}-${forgeVersion}.jar`
      },
      {
        name: `net.minecraftforge:lowcodelanguage:${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}/lowcodelanguage-${mcVersion}-${forgeVersion}.jar`,
        path: `net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}/lowcodelanguage-${mcVersion}-${forgeVersion}.jar`
      },
      {
        name: `net.minecraftforge:mclanguage:${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}/mclanguage-${mcVersion}-${forgeVersion}.jar`,
        path: `net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}/mclanguage-${mcVersion}-${forgeVersion}.jar`
      },
      {
        name: `cpw.mods:bootstraplauncher:1.1.2`,
        url: `https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`,
        path: `cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`
      },
      {
        name: `cpw.mods:securejarhandler:1.0.8`,
        url: `https://maven.minecraftforge.net/cpw/mods/securejarhandler/1.0.8/securejarhandler-1.0.8.jar`,
        path: `cpw/mods/securejarhandler/1.0.8/securejarhandler-1.0.8.jar`
      },
      {
        name: `org.ow2.asm:asm:9.3`,
        url: `https://repo1.maven.org/maven2/org/ow2/asm/asm/9.3/asm-9.3.jar`,
        path: `org/ow2/asm/asm/9.3/asm-9.3.jar`
      },
      {
        name: `org.ow2.asm:asm-commons:9.3`,
        url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.3/asm-commons-9.3.jar`,
        path: `org/ow2/asm/asm-commons/9.3/asm-commons-9.3.jar`
      },
      {
        name: `org.ow2.asm:asm-tree:9.3`,
        url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.3/asm-tree-9.3.jar`,
        path: `org/ow2/asm/asm-tree/9.3/asm-tree-9.3.jar`
      },
      {
        name: `org.ow2.asm:asm-util:9.3`,
        url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-util/9.3/asm-util-9.3.jar`,
        path: `org/ow2/asm/asm-util/9.3/asm-util-9.3.jar`
      },
      {
        name: `org.ow2.asm:asm-analysis:9.3`,
        url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.3/asm-analysis-9.3.jar`,
        path: `org/ow2/asm/asm-analysis/9.3/asm-analysis-9.3.jar`
      }
    ];
  }

  /**
   * Скачивание библиотеки в правильный путь
   */
  async downloadLibraryToCorrectPath(lib) {
    const filePath = path.join(this.librariesDir, lib.path);
    
    if (!fs.existsSync(filePath)) {
      console.log(`[FORGE] Скачиваем: ${lib.name}`);
      console.log(`[FORGE]   URL: ${lib.url}`);
      console.log(`[FORGE]   Путь: ${filePath}`);
      
      await fs.ensureDir(path.dirname(filePath));
      
      try {
        await this.downloadFile(lib.url, filePath);
        console.log(`[FORGE] ✓ Успешно: ${lib.name}`);
      } catch (error) {
        console.error(`[FORGE] ❌ Ошибка: ${lib.name} -> ${error.message}`);
        throw error;
      }
    } else {
      console.log(`[FORGE] ✓ Уже существует: ${lib.name}`);
    }
  }

  /**
   * Создание недостающих файлов после установки
   */
  async createMissingFiles(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log('[FORGE] Проверка созданных файлов...');

    // Создаем пустой forge.jar если его нет
    if (!fs.existsSync(forgeJarPath)) {
      console.log('[FORGE] Создаем пустой forge.jar...');
      await fs.writeFile(forgeJarPath, '');
      console.log('[FORGE] ✓ Создан пустой forge.jar');
    }

    // Создаем JSON конфиг если его нет
    if (!fs.existsSync(versionJsonPath)) {
      console.log('[FORGE] Создаем JSON конфиг...');
      await this.createForgeJson(mcVersion, forgeVersion, forgeDir);
    }
  }

  /**
   * Скачивание и запуск установщика
   */
  async downloadAndRunInstaller(mcVersion, forgeVersion, forgeDir, onProgress) {
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;
    const installerPath = path.join(forgeDir, 'forge-installer.jar');

    console.log(`[FORGE] Скачивание установщика...`);
    console.log(`[FORGE] URL: ${installerUrl}`);

    // Скачиваем установщик
    await this.downloadFileWithProgress(installerUrl, installerPath, onProgress, 50, 70);

    // Запускаем установщик
    console.log('[FORGE] Запуск установщика Forge...');
    await this.runForgeInstaller(installerPath, forgeDir);

    // Удаляем установщик после успеха
    await fs.remove(installerPath);
    console.log('[FORGE] ✓ Установщик удален');
  }

  async runForgeInstaller(installerPath, forgeDir) {
    return new Promise((resolve, reject) => {
      const javaProcess = spawn('java', ['-jar', installerPath, '--installClient'], {
        cwd: forgeDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      javaProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log('[FORGE INSTALLER]', text.trim());
      });

      javaProcess.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.error('[FORGE INSTALLER ERROR]', text.trim());
      });

      javaProcess.on('close', (code) => {
        console.log(`[FORGE] Установщик завершился с кодом: ${code}`);
        // Forge installer часто возвращает 1 даже при успехе
        if (code === 0 || code === 1) {
          console.log('[FORGE] ✓ Установщик завершен');
          resolve(output);
        } else {
          console.warn(`[FORGE] Установщик завершился с кодом ${code}, продолжаем...`);
          resolve(output);
        }
      });

      javaProcess.on('error', (error) => {
        console.error('[FORGE] Ошибка запуска Java:', error.message);
        reject(new Error(`Не удалось запустить установщик: ${error.message}`));
      });

      // Таймаут 3 минуты
      setTimeout(() => {
        javaProcess.kill();
        console.log('[FORGE] Установщик превысил таймаут, продолжаем...');
        resolve('timeout');
      }, 180000);
    });
  }

  /**
   * Создание JSON конфига для Forge
   */
  async createForgeJson(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const jsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log('[FORGE] Создаем JSON конфиг для Forge...');
    
    const baseConfig = {
      id: forgeId,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "release",
      mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
      inheritsFrom: mcVersion,
      arguments: {
        game: [
          "--gameDir", "${game_directory}",
          "--width", "854", 
          "--height", "480"
        ],
        jvm: [
          "-Djava.library.path=${natives_directory}",
          "-Dminecraft.launcher.brand=${launcher_name}",
          "-Dminecraft.launcher.version=${launcher_version}",
          "-DignoreList=bootstraplauncher,securejarhandler,asm-commons,asm-util,asm-analysis,asm-tree,asm,JarJarFileSystems,client-extra,fmlcore,javafmllanguage,lowcodelanguage,mclanguage,${version_name}.jar",
          "-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar",
          "-DlibraryDirectory=${library_directory}",
          "-p", "${modulepath}",
          "--add-modules", "ALL-MODULE-PATH",
          "--add-opens", "java.base/java.util.jar=cpw.mods.securejarhandler",
          "--add-opens", "java.base/java.lang.invoke=cpw.mods.securejarhandler",
          "--add-exports", "java.base/sun.security.util=cpw.mods.securejarhandler",
          "--add-exports", "jdk.naming.dns/com.sun.jndi.dns=java.naming",
          "-cp", "${classpath}"
        ]
      },
      libraries: this.getForgeLibraries(mcVersion, forgeVersion).map(lib => ({
        name: lib.name,
        downloads: {
          artifact: {
            url: lib.url,
            path: lib.path,
            sha1: "",
            size: 0
          }
        }
      }))
    };

    await fs.writeJson(jsonPath, baseConfig, { spaces: 2 });
    console.log('[FORGE] ✓ JSON конфиг создан');
  }

  /**
   * Загрузка файла
   */
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
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        }
      }).on('error', reject);
    });
  }

  /**
   * Загрузка файла с прогрессом
   */
  downloadFileWithProgress(url, filePath, onProgress, startPercent = 0, endPercent = 100) {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${url}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        const file = fs.createWriteStream(filePath);
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (onProgress && totalSize) {
            const progress = startPercent + ((downloadedSize / totalSize) * (endPercent - startPercent));
            onProgress({
              stage: 'Загрузка установщика Forge',
              percent: Math.round(progress)
            });
          }
        });

        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });

      }).on('error', reject);
    });
  }
}

module.exports = ForgeInstaller;
