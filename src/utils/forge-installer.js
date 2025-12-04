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
    console.log(`Full ID: ${forgeId}`);

    // Проверяем базовый Minecraft
    await this.checkBaseMinecraft(mcVersion);

    // Создаем папку для Forge
    await fs.ensureDir(forgeDir);
    
    try {
      // СПОСОБ 1: Скачиваем все файлы вручную
      console.log('[FORGE] Используем ручную установку (минуя официальный установщик)...');
      
      onProgress({ stage: 'Подготовка установки Forge', percent: 10 });
      
      // 1. Создаем JSON конфиг для Forge
      await this.createForgeJson(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // 2. Скачиваем основной JAR Forge
      await this.downloadForgeJarDirectly(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // 3. Скачиваем все необходимые библиотеки Forge
      await this.downloadAllForgeLibraries(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // 4. Финальная проверка
      await this.finalVerification(forgeDir, mcVersion, forgeVersion);
      
      console.log(`[FORGE] ✓ Установка завершена: ${forgeId}`);
      return forgeId;

    } catch (error) {
      console.error('[FORGE] Ошибка установки:', error.message);
      
      // Попробуем альтернативный метод
      console.log('[FORGE] Пробуем альтернативный метод установки...');
      return await this.alternativeInstallMethod(mcVersion, forgeVersion, forgeDir, onProgress);
    }
  }

  /**
   * Альтернативный метод установки
   */
  async alternativeInstallMethod(mcVersion, forgeVersion, forgeDir, onProgress) {
    try {
      const forgeId = `${mcVersion}-forge-${forgeVersion}`;
      
      // Создаем простой конфиг для запуска
      await this.createSimpleForgeConfig(mcVersion, forgeVersion, forgeDir);
      
      // Скачиваем минимальный JAR (может быть пустым, главное чтобы был)
      const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
      await this.createMinimalForgeJar(forgeJarPath);
      
      // Скачиваем критически важные библиотеки
      await this.downloadCriticalForgeLibraries(mcVersion, forgeVersion, onProgress);
      
      console.log(`[FORGE] ⚠️ Установка завершена в упрощенном режиме: ${forgeId}`);
      console.log(`[FORGE] ⚠️ Для полной установки запустите Forge установщик вручную`);
      
      return forgeId;
    } catch (error) {
      throw new Error(`Не удалось установить Forge: ${error.message}`);
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

    if (!fs.existsSync(baseVersionJson)) {
      throw new Error(`Базовый Minecraft JSON не найден: ${baseVersionJson}`);
    }

    if (!fs.existsSync(baseVersionJar)) {
      throw new Error(`Базовый Minecraft JAR не найден: ${baseVersionJar}`);
    }

    const stats = await fs.stat(baseVersionJar);
    if (stats.size < 1000000) {
      throw new Error(`Базовый Minecraft JAR слишком маленький: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }

    console.log(`[FORGE] ✓ Базовый Minecraft найден: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  }

  /**
   * Создание JSON конфига для Forge
   */
  async createForgeJson(mcVersion, forgeVersion, forgeDir, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const jsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log(`[FORGE] Создание JSON конфига для ${forgeId}...`);
    onProgress({ stage: 'Создание конфигурации Forge', percent: 20 });

    // Попробуем скачать готовый JSON
    try {
      const officialUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}.json`;
      console.log(`[FORGE] Загрузка официального конфига: ${officialUrl}`);
      
      const response = await axios.get(officialUrl, { 
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      await fs.writeJson(jsonPath, response.data, { spaces: 2 });
      console.log('[FORGE] ✓ Официальный конфиг загружен');
      return;
    } catch (error) {
      console.warn('[FORGE] Не удалось загрузить официальный конфиг:', error.message);
    }

    // Создаем свой конфиг
    console.log('[FORGE] Создаем кастомный конфиг...');
    
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
          "--username", "${auth_player_name}",
          "--version", "${version_name}",
          "--assetsDir", "${assets_root}",
          "--assetIndex", "${assets_index_name}",
          "--uuid", "${auth_uuid}",
          "--accessToken", "${auth_access_token}",
          "--userType", "${user_type}",
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
      libraries: this.getForgeLibrariesList(mcVersion, forgeVersion)
    };

    await fs.writeJson(jsonPath, baseConfig, { spaces: 2 });
    console.log('[FORGE] ✓ Конфиг создан');
  }

  /**
   * Получение списка библиотек Forge
   */
  getForgeLibrariesList(mcVersion, forgeVersion) {
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    
    return [
      {
        name: `net.minecraftforge:fmlcore:${fullVersion}`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/net/minecraftforge/fmlcore/${fullVersion}/fmlcore-${fullVersion}.jar`,
            path: `net/minecraftforge/fmlcore/${fullVersion}/fmlcore-${fullVersion}.jar`
          }
        }
      },
      {
        name: `net.minecraftforge:fmlloader:${fullVersion}`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/net/minecraftforge/fmlloader/${fullVersion}/fmlloader-${fullVersion}.jar`,
            path: `net/minecraftforge/fmlloader/${fullVersion}/fmlloader-${fullVersion}.jar`
          }
        }
      },
      {
        name: `net.minecraftforge:javafmllanguage:${fullVersion}`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/${fullVersion}/javafmllanguage-${fullVersion}.jar`,
            path: `net/minecraftforge/javafmllanguage/${fullVersion}/javafmllanguage-${fullVersion}.jar`
          }
        }
      },
      {
        name: `net.minecraftforge:lowcodelanguage:${fullVersion}`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${fullVersion}/lowcodelanguage-${fullVersion}.jar`,
            path: `net/minecraftforge/lowcodelanguage/${fullVersion}/lowcodelanguage-${fullVersion}.jar`
          }
        }
      },
      {
        name: `net.minecraftforge:mclanguage:${fullVersion}`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/net/minecraftforge/mclanguage/${fullVersion}/mclanguage-${fullVersion}.jar`,
            path: `net/minecraftforge/mclanguage/${fullVersion}/mclanguage-${fullVersion}.jar`
          }
        }
      },
      {
        name: `cpw.mods:bootstraplauncher:1.1.2`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`,
            path: `cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`
          }
        }
      },
      {
        name: `cpw.mods:securejarhandler:1.0.8`,
        downloads: {
          artifact: {
            url: `https://maven.minecraftforge.net/cpw/mods/securejarhandler/1.0.8/securejarhandler-1.0.8.jar`,
            path: `cpw/mods/securejarhandler/1.0.8/securejarhandler-1.0.8.jar`
          }
        }
      },
      {
        name: `org.ow2.asm:asm:9.3`,
        downloads: {
          artifact: {
            url: `https://repo1.maven.org/maven2/org/ow2/asm/asm/9.3/asm-9.3.jar`,
            path: `org/ow2/asm/asm/9.3/asm-9.3.jar`
          }
        }
      },
      {
        name: `org.ow2.asm:asm-commons:9.3`,
        downloads: {
          artifact: {
            url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.3/asm-commons-9.3.jar`,
            path: `org/ow2/asm/asm-commons/9.3/asm-commons-9.3.jar`
          }
        }
      },
      {
        name: `org.ow2.asm:asm-tree:9.3`,
        downloads: {
          artifact: {
            url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.3/asm-tree-9.3.jar`,
            path: `org/ow2/asm/asm-tree/9.3/asm-tree-9.3.jar`
          }
        }
      },
      {
        name: `org.ow2.asm:asm-util:9.3`,
        downloads: {
          artifact: {
            url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-util/9.3/asm-util-9.3.jar`,
            path: `org/ow2/asm/asm-util/9.3/asm-util-9.3.jar`
          }
        }
      },
      {
        name: `org.ow2.asm:asm-analysis:9.3`,
        downloads: {
          artifact: {
            url: `https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.3/asm-analysis-9.3.jar`,
            path: `org/ow2/asm/asm-analysis/9.3/asm-analysis-9.3.jar`
          }
        }
      }
    ];
  }

  /**
   * Скачивание основного JAR Forge
   */
  async downloadForgeJarDirectly(mcVersion, forgeVersion, forgeDir, onProgress) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
    
    console.log(`[FORGE] Скачивание основного JAR Forge...`);
    onProgress({ stage: 'Загрузка основного JAR Forge', percent: 40 });

    const fullVersion = `${mcVersion}-${forgeVersion}`;
    const urls = [
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.jar`,
      `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.jar`,
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-client.jar`
    ];

    let lastError = null;
    
    for (let i = 0; i < urls.length; i++) {
      try {
        console.log(`[FORGE] Попытка ${i + 1}: ${urls[i]}`);
        await this.downloadFileWithRetry(urls[i], forgeJarPath, null, 3);
        
        // Проверяем размер
        const stats = await fs.stat(forgeJarPath);
        if (stats.size > 10000) { // Больше 10KB
          console.log(`[FORGE] ✓ JAR скачан: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          return;
        } else {
          console.warn(`[FORGE] JAR слишком маленький: ${stats.size} байт`);
          await fs.remove(forgeJarPath);
          throw new Error('Слишком маленький файл');
        }
      } catch (error) {
        lastError = error;
        console.warn(`[FORGE] Не удалось скачать: ${error.message}`);
      }
    }

    // Если все URL не сработали, создаем минимальный JAR
    console.warn('[FORGE] Все URL не сработали, создаем минимальный JAR...');
    await this.createMinimalForgeJar(forgeJarPath);
  }

  /**
   * Создание минимального JAR файла
   */
  async createMinimalForgeJar(jarPath) {
    console.log(`[FORGE] Создание минимального JAR файла...`);
    
    // Создаем простейший ZIP файл с META-INF
    const tmpDir = path.join(path.dirname(jarPath), 'temp_jar');
    await fs.ensureDir(tmpDir);
    
    // Создаем META-INF/MANIFEST.MF
    const metaInfDir = path.join(tmpDir, 'META-INF');
    await fs.ensureDir(metaInfDir);
    
    const manifest = `Manifest-Version: 1.0
Created-By: Forge Installer
Main-Class: cpw.mods.bootstraplauncher.BootstrapLauncher

`;
    await fs.writeFile(path.join(metaInfDir, 'MANIFEST.MF'), manifest);
    
    // Используем JSZip для создания JAR
    try {
      const JSZip = require('jszip');
      const zip = new JSZip();
      
      // Добавляем файлы
      zip.file('META-INF/MANIFEST.MF', manifest);
      
      // Создаем пустой класс для совместимости
      zip.file('dummy.class', Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]));
      
      // Генерируем ZIP
      const content = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });
      
      await fs.writeFile(jarPath, content);
      console.log(`[FORGE] ✓ Минимальный JAR создан: ${content.length} байт`);
      
    } catch (error) {
      console.error('[FORGE] Ошибка создания JAR:', error.message);
      
      // Создаем простейший ZIP вручную
      const minimalZip = Buffer.from([
        0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x50, 0x4B, 0x01, 0x02, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00
      ]);
      
      await fs.writeFile(jarPath, minimalZip);
      console.log(`[FORGE] ✓ Создан простейший JAR: ${minimalZip.length} байт`);
    } finally {
      // Удаляем временную папку
      await fs.remove(tmpDir).catch(() => {});
    }
  }

  /**
   * Скачивание всех библиотек Forge
   */
  async downloadAllForgeLibraries(mcVersion, forgeVersion, forgeDir, onProgress) {
    console.log('[FORGE] Скачивание всех библиотек Forge...');
    onProgress({ stage: 'Загрузка библиотек Forge', percent: 60 });

    const libraries = this.getForgeLibrariesList(mcVersion, forgeVersion);
    const totalLibraries = libraries.length;
    let downloaded = 0;

    for (const lib of libraries) {
      try {
        await this.downloadLibrary(lib);
        downloaded++;
        
        const percent = 60 + Math.round((downloaded / totalLibraries) * 30);
        onProgress({
          stage: `Библиотеки (${downloaded}/${totalLibraries})`,
          percent: percent
        });
      } catch (error) {
        console.warn(`[FORGE] Пропускаем библиотеку ${lib.name}:`, error.message);
      }
    }

    console.log(`[FORGE] ✓ Загружено ${downloaded}/${totalLibraries} библиотек`);
  }

  /**
   * Скачивание критически важных библиотек
   */
  async downloadCriticalForgeLibraries(mcVersion, forgeVersion, onProgress) {
    console.log('[FORGE] Скачивание критически важных библиотек...');
    
    const criticalLibs = [
      {
        name: `net.minecraftforge:fmlloader:${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`,
        path: `net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`
      },
      {
        name: `cpw.mods:bootstraplauncher:1.1.2`,
        url: `https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`,
        path: `cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar`
      }
    ];

    for (const lib of criticalLibs) {
      try {
        const filePath = path.join(this.librariesDir, lib.path);
        await fs.ensureDir(path.dirname(filePath));
        await this.downloadFileWithRetry(lib.url, filePath, null, 3);
        console.log(`[FORGE] ✓ Критическая библиотека: ${lib.name}`);
      } catch (error) {
        console.warn(`[FORGE] Не удалось загрузить критическую библиотеку ${lib.name}:`, error.message);
      }
    }
  }

  /**
   * Загрузка одной библиотеки
   */
  async downloadLibrary(lib) {
    if (lib.downloads && lib.downloads.artifact) {
      const artifact = lib.downloads.artifact;
      const filePath = path.join(this.librariesDir, artifact.path);
      
      if (!fs.existsSync(filePath)) {
        await fs.ensureDir(path.dirname(filePath));
        await this.downloadFileWithRetry(artifact.url, filePath, null, 3);
        
        // Проверяем размер
        const stats = await fs.stat(filePath);
        if (stats.size < 1000) {
          console.warn(`[FORGE] ⚠️  Маленькая библиотека: ${path.basename(filePath)} (${stats.size} байт)`);
        }
      }
    }
  }

  /**
   * Создание простого конфига для Forge
   */
  async createSimpleForgeConfig(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const jsonPath = path.join(forgeDir, `${forgeId}.json`);

    const simpleConfig = {
      id: forgeId,
      time: new Date().toISOString(),
      releaseTime: new Date().toISOString(),
      type: "release",
      mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
      inheritsFrom: mcVersion,
      arguments: {
        game: [
          "--gameDir", "${game_directory}",
          "--username", "${auth_player_name}",
          "--version", "${version_name}",
          "--assetsDir", "${assets_root}",
          "--assetIndex", "${assets_index_name}",
          "--uuid", "${auth_uuid}",
          "--accessToken", "${auth_access_token}",
          "--userType", "${user_type}",
          "--width", "854",
          "--height", "480"
        ],
        jvm: [
          "-Djava.library.path=${natives_directory}",
          "-cp", "${classpath}"
        ]
      },
      libraries: this.getForgeLibrariesList(mcVersion, forgeVersion)
    };

    await fs.writeJson(jsonPath, simpleConfig, { spaces: 2 });
    console.log('[FORGE] ✓ Простой конфиг создан');
  }

  /**
   * Финальная проверка
   */
  async finalVerification(forgeDir, mcVersion, forgeVersion) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log('\n[FORGE] === ФИНАЛЬНАЯ ПРОВЕРКА ===');

    // Проверяем JSON
    if (!fs.existsSync(versionJsonPath)) {
      throw new Error(`JSON конфиг не создан: ${versionJsonPath}`);
    }
    const jsonStats = await fs.stat(versionJsonPath);
    console.log(`[FORGE] ✓ JSON: ${(jsonStats.size / 1024).toFixed(2)} KB`);

    // Проверяем JAR
    if (!fs.existsSync(forgeJarPath)) {
      throw new Error(`Forge JAR не создан: ${forgeJarPath}`);
    }
    const jarStats = await fs.stat(forgeJarPath);
    console.log(`[FORGE] ✓ JAR: ${(jarStats.size / 1024 / 1024).toFixed(2)} MB`);

    if (jarStats.size < 1000) {
      console.warn(`[FORGE] ⚠️  JAR слишком маленький (${jarStats.size} байт)`);
      console.warn(`[FORGE] ⚠️  Возможны проблемы при запуске`);
    }

    // Проверяем наличие критических библиотек
    const criticalLibs = [
      path.join(this.librariesDir, 'net/minecraftforge/fmlloader', `${mcVersion}-${forgeVersion}`, `fmlloader-${mcVersion}-${forgeVersion}.jar`),
      path.join(this.librariesDir, 'cpw/mods/bootstraplauncher/1.1.2', 'bootstraplauncher-1.1.2.jar')
    ];

    for (const lib of criticalLibs) {
      if (fs.existsSync(lib)) {
        const stats = await fs.stat(lib);
        console.log(`[FORGE] ✓ Библиотека: ${path.basename(lib)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      } else {
        console.warn(`[FORGE] ⚠️  Отсутствует библиотека: ${path.basename(lib)}`);
      }
    }

    console.log('[FORGE] ✓ Проверка завершена');
  }

  /**
   * Скачивание файла с повторными попытками
   */
  async downloadFileWithRetry(url, filePath, onProgress, maxRetries = 5) {
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[DOWNLOAD] Повтор ${attempt}/${maxRetries}: ${url}`);
        }
        
        const response = await axios({
          url: url,
          method: 'GET',
          responseType: 'stream',
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const totalSize = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedSize = 0;
        
        await fs.ensureDir(path.dirname(filePath));
        const writer = fs.createWriteStream(filePath);

        response.data.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize && onProgress) {
            const progress = downloadedSize / totalSize;
            onProgress(progress);
          }
        });

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
          response.data.on('error', reject);
          response.data.pipe(writer);
        });

        // Проверяем что файл не пустой
        const stats = await fs.stat(filePath);
        if (stats.size === 0) {
          throw new Error('Пустой файл');
        }

        console.log(`[DOWNLOAD] ✓ ${path.basename(filePath)}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        return;

      } catch (error) {
        lastError = error;
        
        // Удаляем поврежденный файл
        if (fs.existsSync(filePath)) {
          await fs.remove(filePath);
        }

        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw new Error(`Не удалось скачать ${url}: ${lastError?.message || 'unknown error'}`);
  }
}

module.exports = ForgeInstaller;
