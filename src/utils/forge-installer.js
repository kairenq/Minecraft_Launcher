const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');
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
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    const forgeUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`;
    const installerPath = path.join(forgeDir, 'forge-installer.jar');
    
    // Скачиваем установщик
    await this.downloadFileWithProgress(forgeUrl, installerPath, onProgress);
    
    try {
      // Пытаемся установить через установщик
      await this.runForgeInstaller(installerPath, forgeDir);
      
      // После установки скачиваем ВСЕ библиотеки из манифеста
      await this.downloadAllLibraries(mcVersion, forgeVersion, forgeDir, onProgress);
      
    } catch (error) {
      console.log('[FORGE] Установка через installer не удалась, используем ручную установку...');
      await this.manualForgeInstall(mcVersion, forgeVersion, forgeDir, onProgress);
    }
  }

  async runForgeInstaller(installerPath, forgeDir) {
    return new Promise((resolve, reject) => {
      console.log('[FORGE] Запуск установщика Forge...');
      
      const javaProcess = spawn('java', ['-jar', installerPath, '--installClient'], {
        cwd: forgeDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      javaProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log('[FORGE INSTALLER]', data.toString().trim());
      });

      javaProcess.stderr.on('data', (data) => {
        output += data.toString();
        console.error('[FORGE INSTALLER ERROR]', data.toString().trim());
      });

      javaProcess.on('close', (code) => {
        if (code === 0) {
          console.log('[FORGE] ✓ Установщик завершился успешно');
          resolve(output);
        } else {
          reject(new Error(`Forge installer failed with code ${code}\n${output}`));
        }
      });

      javaProcess.on('error', (error) => {
        reject(new Error(`Failed to start Java: ${error.message}`));
      });

      // Таймаут 2 минуты
      setTimeout(() => {
        javaProcess.kill();
        reject(new Error('Forge installer timeout (2 minutes)'));
      }, 120000);
    });
  }

  /**
   * Скачивание ВСЕХ библиотек из манифеста Forge
   */
  async downloadAllLibraries(mcVersion, forgeVersion, forgeDir, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);
    
    if (!fs.existsSync(versionJsonPath)) {
      console.warn('[FORGE] Манифест не найден, создаем базовый...');
      await this.createCompleteForgeJson(mcVersion, forgeVersion, forgeDir);
    }

    const versionData = await fs.readJson(versionJsonPath);
    const libraries = versionData.libraries || [];

    console.log(`[FORGE] Загрузка ${libraries.length} библиотек...`);

    let downloaded = 0;
    const total = libraries.length;

    for (const lib of libraries) {
      try {
        await this.downloadLibrary(lib);
        downloaded++;
        
        if (onProgress) {
          onProgress({
            stage: `Загрузка библиотек (${downloaded}/${total})`,
            percent: Math.round((downloaded / total) * 100)
          });
        }
      } catch (error) {
        console.warn(`[FORGE] Не удалось загрузить библиотеку ${lib.name}:`, error.message);
      }
    }

    console.log(`[FORGE] ✓ Загружено ${downloaded}/${total} библиотек`);
  }

  /**
   * Скачивание одной библиотеки
   */
  async downloadLibrary(lib) {
    if (lib.downloads && lib.downloads.artifact) {
      // Новый формат (Mojang)
      const artifact = lib.downloads.artifact;
      const filePath = path.join(this.librariesDir, artifact.path.split('/').join(path.sep));
      
      if (!fs.existsSync(filePath)) {
        await fs.ensureDir(path.dirname(filePath));
        await this.downloadFile(artifact.url, filePath);
      }
    } else if (lib.name) {
      // Старый формат (Forge)
      const parts = lib.name.split(':');
      if (parts.length >= 3) {
        const [group, artifact, version] = parts;
        const groupPath = group.replace(/\./g, '/');
        const fileName = `${artifact}-${version}.jar`;
        const filePath = path.join(this.librariesDir, groupPath, artifact, version, fileName);
        
        if (!fs.existsSync(filePath)) {
          await fs.ensureDir(path.dirname(filePath));
          
          // Пробуем разные источники
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
              console.warn(`[FORGE] Не удалось скачать из ${source}:`, error.message);
            }
          }
        }
      }
    }
  }

  async manualForgeInstall(mcVersion, forgeVersion, forgeDir, onProgress) {
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    
    // Создаем директорию для версии
    await fs.ensureDir(forgeDir);

    // Сначала скачиваем манифест Forge
    onProgress({ stage: 'Загрузка манифеста Forge', percent: 10 });
    
    try {
      const manifestUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.json`;
      const manifestPath = path.join(forgeDir, `${mcVersion}-forge-${forgeVersion}.json`);
      
      await this.downloadFile(manifestUrl, manifestPath);
      console.log('[FORGE] ✓ Манифест загружен');
      
      // Теперь скачиваем все библиотеки из манифеста
      await this.downloadAllLibraries(mcVersion, forgeVersion, forgeDir, onProgress);
      
    } catch (error) {
      console.warn('[FORGE] Не удалось загрузить манифест, создаем полный конфиг:', error.message);
      await this.createCompleteForgeJson(mcVersion, forgeVersion, forgeDir);
      await this.downloadCriticalForgeLibraries(mcVersion, forgeVersion, onProgress);
    }
  }

  /**
   * Создание ПОЛНОГО конфига Forge
   */
  async createCompleteForgeJson(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const jsonPath = path.join(forgeDir, `${forgeId}.json`);
    
    const completeJson = {
      id: forgeId,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "release",
      mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
      arguments: {
        game: [
          "--gameDir",
          "${game_directory}",
          "--width",
          "${resolution_width}",
          "--height",
          "${resolution_height}"
        ],
        jvm: [
          "-Djava.library.path=${natives_directory}",
          "-Dminecraft.launcher.brand=${launcher_name}",
          "-Dminecraft.launcher.version=${launcher_version}",
          "-DignoreList=bootstraplauncher,securejarhandler,asm-commons,asm-util,asm-analysis,asm-tree,asm,JarJarFileSystems,client-extra,fmlcore,javafmllanguage,lowcodelanguage,mclanguage,${version_name}.jar",
          "-DmergeModules=jna-5.10.0.jar,jna-platform-5.10.0.jar",
          "-DlibraryDirectory=${library_directory}",
          "-p",
          "${modulepath}",
          "--add-modules",
          "ALL-MODULE-PATH",
          "--add-opens",
          "java.base/java.util.jar=cpw.mods.securejarhandler",
          "--add-opens",
          "java.base/java.lang.invoke=cpw.mods.securejarhandler",
          "--add-exports",
          "java.base/sun.security.util=cpw.mods.securejarhandler",
          "--add-exports",
          "jdk.naming.dns/com.sun.jndi.dns=java.naming",
          "-cp",
          "${classpath}"
        ]
      },
      libraries: [
        // Основные библиотеки Forge
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
        },
        // Библиотеки Minecraft
        {
          name: `net.minecraft:client:${mcVersion}`
        }
      ]
    };
    
    await fs.writeJson(jsonPath, completeJson, { spaces: 2 });
    console.log('[FORGE] ✓ Полный конфиг создан');
  }

  /**
   * Скачивание критически важных библиотек
   */
  async downloadCriticalForgeLibraries(mcVersion, forgeVersion, onProgress) {
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    const criticalLibs = [
      // Forge библиотеки
      `https://maven.minecraftforge.net/net/minecraftforge/fmlcore/${fullVersion}/fmlcore-${fullVersion}.jar`,
      `https://maven.minecraftforge.net/net/minecraftforge/fmlloader/${fullVersion}/fmlloader-${fullVersion}.jar`,
      `https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/${fullVersion}/javafmllanguage-${fullVersion}.jar`,
      `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${fullVersion}/lowcodelanguage-${fullVersion}.jar`,
      `https://maven.minecraftforge.net/net/minecraftforge/mclanguage/${fullVersion}/mclanguage-${fullVersion}.jar`,
      // Системные библиотеки
      `https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`,
      `https://maven.minecraftforge.net/cpw/mods/securejarhandler/1.0.8/securejarhandler-1.0.8.jar`,
      // ASM библиотеки
      `https://repo1.maven.org/maven2/org/ow2/asm/asm/9.3/asm-9.3.jar`,
      `https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.3/asm-commons-9.3.jar`,
      `https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.3/asm-tree-9.3.jar`
    ];

    console.log(`[FORGE] Загрузка ${criticalLibs.length} критических библиотек...`);

    for (let i = 0; i < criticalLibs.length; i++) {
      const url = criticalLibs[i];
      const fileName = path.basename(url);
      const filePath = path.join(this.librariesDir, this.getLibraryPathFromUrl(url));
      
      if (onProgress) {
        onProgress({
          stage: `Загрузка ${fileName}`,
          percent: Math.round((i / criticalLibs.length) * 100)
        });
      }
      
      try {
        await fs.ensureDir(path.dirname(filePath));
        await this.downloadFile(url, filePath);
        console.log(`[FORGE] ✓ ${fileName}`);
      } catch (error) {
        console.warn(`[FORGE] Не удалось загрузить ${fileName}:`, error.message);
      }
    }
  }

  /**
   * Получение пути библиотеки из URL
   */
  getLibraryPathFromUrl(url) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    
    // Убираем первый слэш и "maven2/" если есть
    const startIndex = pathParts[1] === 'maven2' ? 2 : 1;
    return pathParts.slice(startIndex).join(path.sep);
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
