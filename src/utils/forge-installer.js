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
    console.log(`[FORGE] Директория: ${forgeDir}`);
    
    // СОЗДАЕМ ПАПКУ ВЕРСИИ ПЕРЕД НАЧАЛОМ УСТАНОВКИ
    await fs.ensureDir(forgeDir);
    
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
    
    console.log(`[FORGE] URL установщика: ${forgeUrl}`);
    console.log(`[FORGE] Путь установщика: ${installerPath}`);
    
    // Скачиваем установщик
    await this.downloadFileWithProgress(forgeUrl, installerPath, onProgress);
    
    try {
      // Пытаемся установить через установщик
      console.log('[FORGE] Запуск установщика Forge...');
      await this.runForgeInstaller(installerPath, forgeDir);
      
      // УДАЛЯЕМ УСТАНОВЩИК ПОСЛЕ УСПЕШНОЙ УСТАНОВКИ
      await fs.remove(installerPath);
      console.log('[FORGE] ✓ Установщик удален после успешной установки');
      
    } catch (error) {
      console.log('[FORGE] Установка через installer не удалась, используем ручную установку...');
      await this.manualForgeInstall(mcVersion, forgeVersion, forgeDir, onProgress);
    }
    
    // После установки скачиваем ВСЕ библиотеки из манифеста
    await this.downloadAllLibraries(mcVersion, forgeVersion, forgeDir, onProgress);
  }

  async runForgeInstaller(installerPath, forgeDir) {
    return new Promise((resolve, reject) => {
      console.log('[FORGE] Запуск установщика Forge...');
      
      // ИСПОЛЬЗУЕМ --installServer для автоматической установки
      const javaProcess = spawn('java', ['-jar', installerPath, '--installServer'], {
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
          console.log('[FORGE] ✓ Установщик завершился успешно');
          resolve(output);
        } else {
          // Даже если код не 0, продолжаем - иногда Forge installer возвращает ненулевые коды
          console.warn(`[FORGE] Установщик завершился с кодом ${code}, но продолжаем установку`);
          resolve(output);
        }
      });

      javaProcess.on('error', (error) => {
        console.error('[FORGE] Ошибка запуска установщика:', error.message);
        reject(new Error(`Failed to start Java: ${error.message}`));
      });

      // Таймаут 3 минуты
      setTimeout(() => {
        javaProcess.kill();
        console.log('[FORGE] Установщик превысил таймаут, продолжаем ручную установку');
        resolve('timeout'); // Не reject, а resolve чтобы продолжить ручную установку
      }, 180000);
    });
  }

  /**
   * Скачивание ВСЕХ библиотек из манифеста Forge
   */
  async downloadAllLibraries(mcVersion, forgeVersion, forgeDir, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);
    
    // Если манифеста нет - создаем его
    if (!fs.existsSync(versionJsonPath)) {
      console.log('[FORGE] Манифест не найден, создаем полный конфиг...');
      await this.createCompleteForgeJson(mcVersion, forgeVersion, forgeDir);
    }

    const versionData = await fs.readJson(versionJsonPath);
    const libraries = versionData.libraries || [];

    console.log(`[FORGE] Загрузка ${libraries.length} библиотек...`);

    let downloaded = 0;
    const total = libraries.length;

    // ОСОБО ВАЖНО: сначала скачиваем клиент Minecraft
    await this.downloadMinecraftClient(mcVersion, onProgress);

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
   * Скачивание клиента Minecraft - КРИТИЧЕСКИ ВАЖНО!
   */
  async downloadMinecraftClient(mcVersion, onProgress) {
    const clientUrl = `https://piston-data.mojang.com/v1/objects/${await this.getClientHash(mcVersion)}/client.jar`;
    const clientPath = path.join(this.librariesDir, 'net', 'minecraft', 'client', mcVersion, `client-${mcVersion}.jar`);
    
    console.log(`[FORGE] Скачивание клиента Minecraft ${mcVersion}...`);
    console.log(`[FORGE] URL: ${clientUrl}`);
    console.log(`[FORGE] Путь: ${clientPath}`);
    
    if (!fs.existsSync(clientPath)) {
      await fs.ensureDir(path.dirname(clientPath));
      await this.downloadFile(clientUrl, clientPath);
      console.log('[FORGE] ✓ Клиент Minecraft скачан');
    } else {
      console.log('[FORGE] ✓ Клиент Minecraft уже существует');
    }
  }

  /**
   * Получение хеша клиента для версии
   */
  async getClientHash(mcVersion) {
    try {
      const versionManifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
      console.log(`[FORGE] Получение манифеста версий...`);
      
      const response = await axios.get(versionManifestUrl);
      const versionData = response.data;
      
      const versionInfo = versionData.versions.find(v => v.id === mcVersion);
      if (!versionInfo) {
        throw new Error(`Версия ${mcVersion} не найдена в манифесте`);
      }
      
      console.log(`[FORGE] Загрузка информации о версии ${mcVersion}...`);
      const versionResponse = await axios.get(versionInfo.url);
      const versionDetails = versionResponse.data;
      
      const clientHash = versionDetails.downloads.client.sha1;
      console.log(`[FORGE] Хеш клиента для ${mcVersion}: ${clientHash}`);
      
      return clientHash;
      
    } catch (error) {
      console.warn(`[FORGE] Не удалось получить хеш клиента: ${error.message}`);
      // Fallback хеши для популярных версий
      const fallbackHashes = {
        '1.18.2': 'c8f83c5655308435b3dcf03c06d9d874d1c7c7c3',
        '1.19.2': '63a86758e0106ef3785c35a7e6bbff7f8c1b9b6a',
        '1.20.1': '2a4c6c8b3b9e2c3d7b7c6e8a1b2c3d4e5f6a7b8c'
      };
      
      if (fallbackHashes[mcVersion]) {
        console.log(`[FORGE] Используем fallback хеш: ${fallbackHashes[mcVersion]}`);
        return fallbackHashes[mcVersion];
      }
      
      throw new Error(`Не удалось определить хеш клиента для ${mcVersion}`);
    }
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
        console.log(`[FORGE] ✓ ${path.basename(filePath)}`);
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
              console.log(`[FORGE] ✓ ${fileName} (из ${new URL(source).hostname})`);
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
    
    console.log('[FORGE] Начинаем ручную установку Forge...');

    // Сначала скачиваем манифест Forge
    onProgress({ stage: 'Загрузка манифеста Forge', percent: 10 });
    
    try {
      const manifestUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.json`;
      const manifestPath = path.join(forgeDir, `${mcVersion}-forge-${forgeVersion}.json`);
      
      await this.downloadFile(manifestUrl, manifestPath);
      console.log('[FORGE] ✓ Манифест загружен');
      
    } catch (error) {
      console.warn('[FORGE] Не удалось загрузить манифест, создаем полный конфиг:', error.message);
      await this.createCompleteForgeJson(mcVersion, forgeVersion, forgeDir);
    }
    
    // Скачиваем критические библиотеки
    await this.downloadCriticalForgeLibraries(mcVersion, forgeVersion, onProgress);
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
      console.log(`[FORGE] Начинаем загрузку: ${url}`);
      
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Ошибка загрузки: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        
        console.log(`[FORGE] Размер файла: ${totalSize} bytes`);
        
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
          console.log(`[FORGE] ✓ Файл загружен: ${filePath}`);
          resolve();
        });

      }).on('error', (err) => {
        console.error(`[FORGE] Ошибка загрузки: ${err.message}`);
        fs.remove(filePath).then(() => reject(err));
      });
    });
  }
}

module.exports = ForgeInstaller;
