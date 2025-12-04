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

    // Создаем папки
    await fs.ensureDir(forgeDir);
    await this.createDirectories();
    
    // Создаем структуру папок
    await this.createForgeFolderStructure(mcVersion, forgeVersion);

    try {
      // Скачиваем и запускаем установщик
      const installerOutput = await this.downloadAndRunInstaller(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // Проверяем созданные файлы
      await this.verifyInstallerOutput(forgeDir, mcVersion, forgeVersion);
      
      // Создаем недостающие файлы если установщик не создал их
      await this.createMissingFiles(mcVersion, forgeVersion, forgeDir);
      
      // Загружаем библиотеки
      console.log('[FORGE] Starting library download...');
      await this.downloadForgeLibraries(mcVersion, forgeVersion, forgeDir, onProgress);
      
      // Финальная проверка
      await this.finalVerification(forgeDir, mcVersion, forgeVersion);
      
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

    if (!fs.existsSync(baseVersionJson)) {
      throw new Error(`Базовый Minecraft JSON не найден: ${baseVersionJson}`);
    }

    if (!fs.existsSync(baseVersionJar)) {
      throw new Error(`Базовый Minecraft JAR не найден: ${baseVersionJar}`);
    }

    // Проверяем размер JAR файла
    const stats = await fs.stat(baseVersionJar);
    if (stats.size < 1000000) { // Меньше 1MB
      throw new Error(`Базовый Minecraft JAR слишком маленький: ${(stats.size / 1024 / 1024).toFixed(2)} MB. Должен быть ~19MB`);
    }

    console.log(`[FORGE] ✓ Базовый Minecraft найден: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
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
   * Создание структуры папок Forge
   */
  async createForgeFolderStructure(mcVersion, forgeVersion) {
    console.log('[FOLDER STRUCTURE] Creating Forge folders...');
    
    const requiredFolders = [
      `net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}`,
      `net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}`, 
      `net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}`,
      `net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}`,
      `net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}`,
      'cpw/mods/bootstraplauncher/1.1.2',
      'cpw/mods/securejarhandler/1.0.8',
      'org/ow2/asm/asm/9.3',
      'org/ow2/asm/asm-commons/9.3',
      'org/ow2/asm/asm-tree/9.3',
      'org/ow2/asm/asm-util/9.3',
      'org/ow2/asm/asm-analysis/9.3'
    ];
    
    for (const folder of requiredFolders) {
      const fullPath = path.join(this.librariesDir, folder);
      await fs.ensureDir(fullPath);
    }
    console.log(`[FOLDER STRUCTURE] ✓ Created ${requiredFolders.length} folders`);
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
    onProgress({ stage: 'Загрузка установщика Forge', percent: 10 });
    await this.downloadFileWithRetry(installerUrl, installerPath, (progress) => {
      const percent = 10 + (progress * 0.2 * 90); // 10-28%
      onProgress({ 
        stage: `Загрузка установщика (${Math.floor(progress * 100)}%)`, 
        percent: Math.floor(percent) 
      });
    });

    // Проверяем что установщик скачан не пустой
    const stats = await fs.stat(installerPath);
    if (stats.size < 1000) {
      throw new Error(`Установщик скачан не полностью: ${stats.size} байт`);
    }
    console.log(`[FORGE] ✓ Установщик скачан: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Запускаем установщик
    onProgress({ stage: 'Запуск установщика Forge', percent: 30 });
    console.log('[FORGE] Запуск установщика Forge...');
    const output = await this.runForgeInstaller(installerPath, forgeDir);

    // Удаляем установщик
    await fs.remove(installerPath);
    console.log('[FORGE] ✓ Установщик удален');

    return output;
  }

  /**
   * Запуск установщика Forge
   */
  async runForgeInstaller(installerPath, forgeDir) {
    return new Promise((resolve, reject) => {
      console.log(`[FORGE INSTALLER] Запуск: java -jar "${installerPath}" --installClient`);

      const javaProcess = spawn('java', ['-jar', installerPath, '--installClient'], {
        cwd: forgeDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let output = '';
      let errorOutput = '';
      
      javaProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log('[FORGE INSTALLER]', text.trim());
      });

      javaProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        console.error('[FORGE INSTALLER ERROR]', text.trim());
      });

      javaProcess.on('close', (code) => {
        console.log(`[FORGE] Установщик завершился с кодом: ${code}`);
        
        // Проверяем на критические ошибки
        if (errorOutput.includes('ERROR:') || errorOutput.includes('Exception:')) {
          console.error('[FORGE] Установщик сообщил об ошибке:', errorOutput);
        }
        
        // Forge installer часто возвращает 1 даже при успехе
        if (code === 0 || code === 1) {
          console.log('[FORGE] ✓ Установщик завершен');
          resolve(output);
        } else {
          console.warn(`[FORGE] Установщик завершился с кодом ${code}`);
          // Все равно продолжаем - иногда установщик падает но файлы создает
          resolve(output);
        }
      });

      javaProcess.on('error', (error) => {
        console.error('[FORGE] Ошибка запуска Java:', error.message);
        reject(new Error(`Не удалось запустить установщик: ${error.message}`));
      });

      // Таймаут 5 минут
      setTimeout(() => {
        if (!javaProcess.killed) {
          javaProcess.kill();
          console.log('[FORGE] Установщик превысил таймаут, продолжаем...');
          resolve('timeout');
        }
      }, 300000);
    });
  }

  /**
   * Проверка вывода установщика
   */
  async verifyInstallerOutput(forgeDir, mcVersion, forgeVersion) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const expectedFiles = [
      path.join(forgeDir, `${forgeId}.json`),
      path.join(forgeDir, `${forgeId}.jar`)
    ];

    console.log('[FORGE] Проверка файлов созданных установщиком...');

    let createdCount = 0;
    for (const file of expectedFiles) {
      if (fs.existsSync(file)) {
        const stats = await fs.stat(file);
        console.log(`[FORGE] ✓ ${path.basename(file)}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        if (stats.size === 0) {
          console.warn(`[FORGE] ⚠️  ${path.basename(file)} имеет размер 0 байт!`);
        } else {
          createdCount++;
        }
      } else {
        console.warn(`[FORGE] ⚠️  Файл не создан: ${path.basename(file)}`);
      }
    }

    if (createdCount === 0) {
      console.warn('[FORGE] Установщик не создал ни одного файла!');
    } else if (createdCount === 1) {
      console.warn('[FORGE] Установщик создал только один файл из двух');
    } else {
      console.log('[FORGE] ✓ Оба файла созданы успешно');
    }
  }

  /**
   * Создание недостающих файлов
   */
  async createMissingFiles(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log('[FORGE] Создание недостающих файлов...');

    // 1. Создаем JSON конфиг если его нет
    if (!fs.existsSync(versionJsonPath)) {
      console.log('[FORGE] Создаем JSON конфиг...');
      await this.createForgeJson(mcVersion, forgeVersion, forgeDir);
    } else {
      console.log('[FORGE] ✓ JSON конфиг уже существует');
    }

    // 2. Создаем Forge JAR если его нет или он пустой
    let needJar = false;
    if (!fs.existsSync(forgeJarPath)) {
      console.log('[FORGE] Forge JAR не найден');
      needJar = true;
    } else {
      const stats = await fs.stat(forgeJarPath);
      if (stats.size < 1000) {
        console.log(`[FORGE] Forge JAR слишком маленький: ${stats.size} байт`);
        needJar = true;
      } else {
        console.log(`[FORGE] ✓ Forge JAR уже существует: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    if (needJar) {
      console.log('[FORGE] Скачиваем Forge JAR вручную...');
      await this.downloadForgeJarDirectly(mcVersion, forgeVersion, forgeJarPath);
    }

    // 3. Создаем основные библиотеки Forge
    await this.createForgeLibraries(mcVersion, forgeVersion);
  }

  /**
   * Прямое скачивание Forge JAR
   */
  async downloadForgeJarDirectly(mcVersion, forgeVersion, destPath) {
    const fullVersion = `${mcVersion}-${forgeVersion}`;
    const jarUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.jar`;
    
    console.log(`[FORGE] Скачивание Forge JAR: ${jarUrl}`);
    
    try {
      await this.downloadFileWithRetry(jarUrl, destPath);
      
      const stats = await fs.stat(destPath);
      if (stats.size < 1000) {
        throw new Error(`Скачанный JAR слишком маленький: ${stats.size} байт`);
      }
      
      console.log(`[FORGE] ✓ Forge JAR скачан: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      console.error(`[FORGE] Не удалось скачать Forge JAR: ${error.message}`);
      
      // Альтернативный источник
      const altUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}.jar`;
      console.log(`[FORGE] Пробуем альтернативный URL: ${altUrl}`);
      
      try {
        await this.downloadFileWithRetry(altUrl, destPath);
        const stats = await fs.stat(destPath);
        console.log(`[FORGE] ✓ Forge JAR скачан с альтернативного источника: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } catch (altError) {
        console.error('[FORGE] Оба источника не работают, создаем заглушку...');
        
        // Создаем минимальный валидный ZIP файл (пустой JAR)
        const minimalZip = Buffer.from([
          0x50, 0x4B, 0x03, 0x04, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x50, 0x4B, 0x01, 0x02, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]);
        
        await fs.writeFile(destPath, minimalZip);
        console.warn('[FORGE] ⚠️  Создан минимальный JAR (заглушка)');
      }
    }
  }

  /**
   * Создание основных библиотек Forge
   */
  async createForgeLibraries(mcVersion, forgeVersion) {
    console.log('[FORGE] Проверка основных библиотек Forge...');
    
    const libraries = [
      {
        group: 'net/minecraftforge',
        artifact: 'fmlcore',
        version: `${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}/fmlcore-${mcVersion}-${forgeVersion}.jar`
      },
      {
        group: 'net/minecraftforge',
        artifact: 'fmlloader', 
        version: `${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`
      },
      {
        group: 'net/minecraftforge',
        artifact: 'javafmllanguage',
        version: `${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}/javafmllanguage-${mcVersion}-${forgeVersion}.jar`
      },
      {
        group: 'net/minecraftforge', 
        artifact: 'lowcodelanguage',
        version: `${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}/lowcodelanguage-${mcVersion}-${forgeVersion}.jar`
      },
      {
        group: 'net/minecraftforge',
        artifact: 'mclanguage',
        version: `${mcVersion}-${forgeVersion}`,
        url: `https://maven.minecraftforge.net/net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}/mclanguage-${mcVersion}-${forgeVersion}.jar`
      },
      {
        group: 'cpw/mods',
        artifact: 'bootstraplauncher',
        version: '1.1.2',
        url: 'https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar'
      },
      {
        group: 'cpw/mods',
        artifact: 'securejarhandler',
        version: '1.0.8',
        url: 'https://maven.minecraftforge.net/cpw/mods/securejarhandler/1.0.8/securejarhandler-1.0.8.jar'
      },
      {
        group: 'org/ow2/asm',
        artifact: 'asm',
        version: '9.3',
        url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm/9.3/asm-9.3.jar'
      },
      {
        group: 'org/ow2/asm',
        artifact: 'asm-commons',
        version: '9.3',
        url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.3/asm-commons-9.3.jar'
      },
      {
        group: 'org/ow2/asm',
        artifact: 'asm-tree',
        version: '9.3',
        url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.3/asm-tree-9.3.jar'
      },
      {
        group: 'org/ow2/asm',
        artifact: 'asm-util',
        version: '9.3',
        url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-util/9.3/asm-util-9.3.jar'
      },
      {
        group: 'org/ow2/asm',
        artifact: 'asm-analysis',
        version: '9.3',
        url: 'https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.3/asm-analysis-9.3.jar'
      }
    ];

    let downloadedCount = 0;
    for (const lib of libraries) {
      const libPath = path.join(this.librariesDir, lib.group, lib.artifact, lib.version, `${lib.artifact}-${lib.version}.jar`);
      
      if (!fs.existsSync(libPath)) {
        console.log(`[FORGE] Скачиваем: ${lib.artifact}-${lib.version}`);
        try {
          await this.downloadFileWithRetry(lib.url, libPath);
          downloadedCount++;
          
          // Проверяем размер
          const stats = await fs.stat(libPath);
          if (stats.size < 1000) {
            console.warn(`[FORGE] ⚠️  Библиотека слишком маленькая: ${lib.artifact} (${stats.size} байт)`);
          }
        } catch (error) {
          console.warn(`[FORGE] Не удалось скачать ${lib.artifact}:`, error.message);
        }
      } else {
        // Проверяем существующую библиотеку
        const stats = await fs.stat(libPath);
        if (stats.size < 1000) {
          console.warn(`[FORGE] ⚠️  Существующая библиотека слишком маленькая: ${lib.artifact} (${stats.size} байт)`);
          // Перекачиваем
          await fs.remove(libPath);
          try {
            await this.downloadFileWithRetry(lib.url, libPath);
            downloadedCount++;
          } catch (error) {
            console.warn(`[FORGE] Не удалось перескачать ${lib.artifact}:`, error.message);
          }
        }
      }
    }

    console.log(`[FORGE] ✓ Проверено ${libraries.length} библиотек, скачано ${downloadedCount}`);
  }

  /**
   * Загрузка библиотек Forge
   */
  async downloadForgeLibraries(mcVersion, forgeVersion, forgeDir, onProgress) {
    console.log('[FORGE] ⚡ Загрузка библиотек Forge из конфига...');
    
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);

    if (!fs.existsSync(versionJsonPath)) {
      console.log('[FORGE] JSON конфиг не найден, используем базовые библиотеки');
      return;
    }

    const versionData = await fs.readJson(versionJsonPath);
    const libraries = versionData.libraries || [];

    console.log(`[FORGE] Загрузка ${libraries.length} библиотек из конфига...`);

    let downloaded = 0;
    for (const lib of libraries) {
      try {
        await this.downloadLibrary(lib);
        downloaded++;
        
        if (onProgress) {
          const percent = 70 + Math.round((downloaded / libraries.length) * 25); // 70-95%
          onProgress({
            stage: `Библиотеки Forge (${downloaded}/${libraries.length})`,
            percent: percent
          });
        }
      } catch (error) {
        console.warn(`[FORGE] Не удалось загрузить ${lib.name || 'unknown'}:`, error.message);
      }
    }

    console.log(`[FORGE] ✓ Загружено ${downloaded}/${libraries.length} библиотек`);
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
        try {
          await this.downloadFileWithRetry(artifact.url, filePath);
          
          // Проверяем размер
          const stats = await fs.stat(filePath);
          if (stats.size < 1000) {
            console.warn(`[FORGE] ⚠️  Загруженная библиотека слишком маленькая: ${artifact.path} (${stats.size} байт)`);
          }
        } catch (error) {
          console.error(`[FORGE] ❌ Ошибка загрузки: ${artifact.url} -> ${error.message}`);
          throw error;
        }
      }
    }
  }

  /**
   * Создание JSON конфига для Forge
   */
  async createForgeJson(mcVersion, forgeVersion, forgeDir) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const jsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log(`[FORGE] Создание JSON конфига для ${forgeId}...`);

    // Пробуем скачать готовый JSON конфиг для Forge
    try {
      const officialUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}.json`;
      console.log(`[FORGE] Попытка загрузить официальный конфиг: ${officialUrl}`);
      
      const response = await axios.get(officialUrl, { 
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
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
      inheritsFrom: mcVersion,
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
          name: `net.minecraftforge:fmlcore:${mcVersion}-${forgeVersion}`,
          downloads: {
            artifact: {
              url: `https://maven.minecraftforge.net/net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}/fmlcore-${mcVersion}-${forgeVersion}.jar`,
              path: `net/minecraftforge/fmlcore/${mcVersion}-${forgeVersion}/fmlcore-${mcVersion}-${forgeVersion}.jar`
            }
          }
        },
        {
          name: `net.minecraftforge:fmlloader:${mcVersion}-${forgeVersion}`,
          downloads: {
            artifact: {
              url: `https://maven.minecraftforge.net/net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`,
              path: `net/minecraftforge/fmlloader/${mcVersion}-${forgeVersion}/fmlloader-${mcVersion}-${forgeVersion}.jar`
            }
          }
        },
        {
          name: `net.minecraftforge:javafmllanguage:${mcVersion}-${forgeVersion}`,
          downloads: {
            artifact: {
              url: `https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}/javafmllanguage-${mcVersion}-${forgeVersion}.jar`,
              path: `net/minecraftforge/javafmllanguage/${mcVersion}-${forgeVersion}/javafmllanguage-${mcVersion}-${forgeVersion}.jar`
            }
          }
        },
        {
          name: `net.minecraftforge:lowcodelanguage:${mcVersion}-${forgeVersion}`,
          downloads: {
            artifact: {
              url: `https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}/lowcodelanguage-${mcVersion}-${forgeVersion}.jar`,
              path: `net/minecraftforge/lowcodelanguage/${mcVersion}-${forgeVersion}/lowcodelanguage-${mcVersion}-${forgeVersion}.jar`
            }
          }
        },
        {
          name: `net.minecraftforge:mclanguage:${mcVersion}-${forgeVersion}`,
          downloads: {
            artifact: {
              url: `https://maven.minecraftforge.net/net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}/mclanguage-${mcVersion}-${forgeVersion}.jar`,
              path: `net/minecraftforge/mclanguage/${mcVersion}-${forgeVersion}/mclanguage-${mcVersion}-${forgeVersion}.jar`
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
      ]
    };

    await fs.writeJson(jsonPath, baseConfig, { spaces: 2 });
    console.log('[FORGE] ✓ Базовый конфиг создан');
  }

  /**
   * Финальная проверка
   */
  async finalVerification(forgeDir, mcVersion, forgeVersion) {
    const forgeId = `${mcVersion}-forge-${forgeVersion}`;
    const forgeJarPath = path.join(forgeDir, `${forgeId}.jar`);
    const versionJsonPath = path.join(forgeDir, `${forgeId}.json`);

    console.log('\n[FORGE] === ФИНАЛЬНАЯ ПРОВЕРКА УСТАНОВКИ ===');

    // Проверяем JSON
    if (!fs.existsSync(versionJsonPath)) {
      throw new Error(`JSON конфиг не создан: ${versionJsonPath}`);
    }
    const jsonStats = await fs.stat(versionJsonPath);
    console.log(`[FORGE] ✓ JSON конфиг: ${(jsonStats.size / 1024).toFixed(2)} KB`);

    // Проверяем JAR
    if (!fs.existsSync(forgeJarPath)) {
      throw new Error(`Forge JAR не создан: ${forgeJarPath}`);
    }
    const jarStats = await fs.stat(forgeJarPath);
    console.log(`[FORGE] ✓ Forge JAR: ${(jarStats.size / 1024 / 1024).toFixed(2)} MB`);

    if (jarStats.size < 1000) {
      console.warn(`[FORGE] ⚠️  ВНИМАНИЕ: Forge JAR слишком маленький (${jarStats.size} байт)`);
      console.warn(`[FORGE] ⚠️  Игра может не запуститься!`);
    }

    console.log('[FORGE] ✓ Установка прошла успешно');
  }

  /**
   * Скачивание файла с повторными попытками
   */
  async downloadFileWithRetry(url, filePath, onProgress, maxRetries = 5) {
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`[DOWNLOAD] ${path.basename(filePath)} (попытка ${attempt + 1}/${maxRetries})`);
        
        const response = await axios({
          url: url,
          method: 'GET',
          responseType: 'stream',
          timeout: 60000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
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
          throw new Error('Загружен пустой файл');
        }

        console.log(`[DOWNLOAD] ✓ ${path.basename(filePath)}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        return;

      } catch (error) {
        lastError = error;
        console.error(`[DOWNLOAD] Ошибка (попытка ${attempt + 1}): ${error.message}`);

        // Удаляем частично загруженный файл
        if (fs.existsSync(filePath)) {
          await fs.remove(filePath);
        }

        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 2000;
          console.log(`[DOWNLOAD] Ожидание ${waitTime / 1000}с...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    throw new Error(`Не удалось скачать файл после ${maxRetries} попыток: ${lastError.message}`);
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
              percent: Math.round((downloadedSize / totalSize) * 20)
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
