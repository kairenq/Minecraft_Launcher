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
      // Скачиваем и запускаем установщик
      await this.downloadAndRunInstaller(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // Загружаем библиотеки
      await this.downloadForgeLibraries(mcVersion, forgeVersion, forgeDir, onProgress);
      
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
   * Скачивание и запуск установщика
   */
  async downloadAndRunInstaller(mcVersion, forgeVersion, forgeDir, onProgress) {
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;
    const installerPath = path.join(forgeDir, 'forge-installer.jar');

    console.log(`[FORGE] Скачивание установщика...`);
    console.log(`[FORGE] URL: ${installerUrl}`);

    // Скачиваем установщик
    await this.downloadFileWithProgress(installerUrl, installerPath, onProgress);

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
        if (code === 0) {
          console.log('[FORGE] ✓ Установщик успешно завершен');
          resolve(output);
        } else {
          console.warn(`[FORGE] Установщик завершился с кодом ${code}, продолжаем...`);
          resolve(output); // Все равно продолжаем
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
   * Загрузка библиотек Forge
   */
  async downloadForgeLibraries(mcVersion, forgeVersion, forgeDir, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);

    // Если JSON не создался установщиком - создаем вручную
    if (!fs.existsSync(versionJsonPath)) {
      console.log('[FORGE] JSON конфиг не найден, создаем вручную...');
      await this.createForgeJson(mcVersion, forgeVersion, forgeDir);
    }

    // Загружаем библиотеки из конфига
    const versionData = await fs.readJson(versionJsonPath);
    const libraries = versionData.libraries || [];

    console.log(`[FORGE] Загрузка ${libraries.length} библиотек...`);

    let downloaded = 0;
    for (const lib of libraries) {
      try {
        await this.downloadLibrary(lib);
        downloaded++;
        
        if (onProgress) {
          onProgress({
            stage: `Библиотеки Forge (${downloaded}/${libraries.length})`,
            percent: Math.round((downloaded / libraries.length) * 80) + 20 // 20-100%
          });
        }
      } catch (error) {
        console.warn(`[FORGE] Не удалось загрузить ${lib.name}:`, error.message);
      }
    }

    console.log(`[FORGE] ✓ Загружено ${downloaded}/${libraries.length} библиотек`);
  }

  /**
   * Создание JSON конфига для Forge
   */
  async createForgeJson(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const jsonPath = path.join(forgeDir, `${forgeId}.json`);

    // Пробуем скачать официальный конфиг
    try {
      const officialUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}.json`;
      console.log(`[FORGE] Попытка загрузить официальный конфиг: ${officialUrl}`);
      
      const response = await axios.get(officialUrl, { timeout: 10000 });
      await fs.writeJson(jsonPath, response.data, { spaces: 2 });
      console.log('[FORGE] ✓ Официальный конфиг загружен');
      return;
    } catch (error) {
      console.warn('[FORGE] Не удалось загрузить официальный конфиг:', error.message);
    }

    // Создаем базовый конфиг
    console.log('[FORGE] Создаем базовый конфиг...');
    const baseConfig = {
      id: forgeId,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "release",
      mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
      inheritsFrom: mcVersion, // КРИТИЧЕСКИ ВАЖНО!
      arguments: {
        game: [
          "--gameDir", "${game_directory}",
          "--width", "${resolution_width}", 
          "--height", "${resolution_height}"
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
      libraries: [
        {
          name: `net.minecraftforge:fmlcore:${mcVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:fmlloader:${mcVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:javafmllanguage:${mcVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:lowcodelanguage:${mcVersion}-${forgeVersion}`
        },
        {
          name: `net.minecraftforge:mclanguage:${mcVersion}-${forgeVersion}`
        },
        {
          name: `cpw.mods:bootstraplauncher:1.1.2`
        },
        {
          name: `cpw.mods:securejarhandler:1.0.8`
        },
        {
          name: `org.ow2.asm:asm:9.3`
        },
        {
          name: `org.ow2.asm:asm-commons:9.3`
        },
        {
          name: `org.ow2.asm:asm-tree:9.3`
        },
        {
          name: `org.ow2.asm:asm-util:9.3`
        },
        {
          name: `org.ow2.asm:asm-analysis:9.3`
        }
      ]
    };

    await fs.writeJson(jsonPath, baseConfig, { spaces: 2 });
    console.log('[FORGE] ✓ Базовый конфиг создан');
  }

  /**
   * Загрузка одной библиотеки
   */
  async downloadLibrary(lib) {
    if (lib.downloads && lib.downloads.artifact) {
      // Новый формат
      const artifact = lib.downloads.artifact;
      const filePath = path.join(this.librariesDir, artifact.path.split('/').join(path.sep));
      
      if (!fs.existsSync(filePath)) {
        await fs.ensureDir(path.dirname(filePath));
        await this.downloadFile(artifact.url, filePath);
      }
    } else if (lib.name) {
      // Старый формат
      const parts = lib.name.split(':');
      if (parts.length >= 3) {
        const [group, artifact, version] = parts;
        const groupPath = group.replace(/\./g, '/');
        const fileName = `${artifact}-${version}.jar`;
        const filePath = path.join(this.librariesDir, groupPath, artifact, version, fileName);
        
        if (!fs.existsSync(filePath)) {
          await fs.ensureDir(path.dirname(filePath));
          
          const sources = [
            `https://maven.minecraftforge.net/${groupPath}/${artifact}/${version}/${fileName}`,
            `https://libraries.minecraft.net/${groupPath}/${artifact}/${version}/${fileName}`,
            `https://repo1.maven.org/maven2/${groupPath}/${artifact}/${version}/${fileName}`
          ];
          
          for (const source of sources) {
            try {
              await this.downloadFile(source, filePath);
              break;
            } catch (error) {
              // Пробуем следующий источник
            }
          }
        }
      }
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
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        }
      }).on('error', reject);
    });
  }

  downloadFileWithProgress(url, filePath, onProgress) {
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
            onProgress({
              stage: 'Загрузка Forge',
              percent: Math.round((downloadedSize / totalSize) * 20) // 0-20%
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
