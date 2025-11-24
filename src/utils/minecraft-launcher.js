const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

class MinecraftLauncher {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');
    this.assetsDir = path.join(launcherDir, 'assets');
  }

  generateUUID(username) {
    const hash = crypto.createHash('md5').update(username).digest('hex');
    return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
  }

  /**
   * Основной метод запуска - поддерживает все типы модлоадеров
   */
  async launch(options, callback) {
    try {
      const { version, username, memory, javaPath, gameDir, modLoader, modLoaderVersion } = options;

      // Создаём лог-файл
      const logsDir = path.join(gameDir, 'logs');
      await fs.ensureDir(logsDir);
      const logFile = path.join(logsDir, 'launcher.log');
      const logStream = fs.createWriteStream(logFile, { flags: 'a' });

      // Записываем заголовок в лог
      logStream.write('\n' + '='.repeat(80) + '\n');
      logStream.write(`ЗАПУСК: ${new Date().toISOString()}\n`);
      logStream.write(`Версия: ${version}\n`);
      logStream.write(`Модлоадер: ${modLoader || 'vanilla'}\n`);
      logStream.write(`Пользователь: ${username}\n`);
      logStream.write(`RAM: ${memory} MB\n`);
      logStream.write(`Java: ${javaPath}\n`);
      logStream.write(`GameDir: ${gameDir}\n`);
      logStream.write('='.repeat(80) + '\n\n');

      console.log('\n=== ЗАПУСК MINECRAFT ===');
      console.log('Версия:', version);
      console.log('Модлоадер:', modLoader || 'vanilla');
      if (modLoaderVersion) console.log('Версия модлоадера:', modLoaderVersion);
      console.log('Пользователь:', username);
      console.log('Память (RAM):', memory, 'MB');
      console.log('Java путь:', javaPath);
      console.log('Директория игры:', gameDir);

      // Проверка существования Java
      if (!javaPath || !fs.existsSync(javaPath)) {
        const error = `Java не найдена по пути: ${javaPath}.\nПереустановите сборку для автоматической загрузки Java.`;
        console.error(error);
        throw new Error(error);
      }

      // Определение ID версии в зависимости от модлоадера
      let versionId = version;
      let isForge = false;

      if (modLoader === 'fabric') {
        if (modLoaderVersion) {
          versionId = `fabric-loader-${modLoaderVersion}-${version}`;
        } else {
          const versions = fs.readdirSync(this.versionsDir);
          const fabricVersion = versions.find(v => v.startsWith('fabric-loader-') && v.endsWith(`-${version}`));
          if (fabricVersion) {
            versionId = fabricVersion;
          } else {
            throw new Error(`Fabric не установлен для Minecraft ${version}. Установите сборку заново.`);
          }
        }
        console.log('Используется Fabric профиль:', versionId);

      } else if (modLoader === 'forge') {
        const versions = fs.readdirSync(this.versionsDir);
        const forgeVersion = versions.find(v => v.includes('forge') && v.includes(version));
        if (forgeVersion) {
          versionId = forgeVersion;
          isForge = true;
          console.log('Используется Forge профиль:', versionId);
        } else {
          throw new Error(`Forge не установлен для Minecraft ${version}. Установите сборку заново.`);
        }
      } else if (!modLoader && version.includes('forge')) {
        console.log('⚠️  modLoader не указан, но версия содержит "forge" - автоопределение');
        versionId = version;
        isForge = true;
      }

      console.log('DEBUG: Финальный versionId:', versionId);
      logStream.write(`\n[LAUNCH] Final versionId: ${versionId}\n`);
      logStream.write(`[LAUNCH] modLoader: ${modLoader}\n`);
      logStream.write(`[LAUNCH] version: ${version}\n`);

      // Загрузка данных версии
      const versionJsonPath = path.join(this.versionsDir, versionId, `${versionId}.json`);
      logStream.write(`[LAUNCH] Version JSON path: ${versionJsonPath}\n`);

      if (!fs.existsSync(versionJsonPath)) {
        const error = `Файл версии не найден: ${versionJsonPath}.\nПереустановите сборку.`;
        console.error(error);
        logStream.write(`[ERROR] ${error}\n`);
        throw new Error(error);
      }

      console.log('Загрузка конфигурации версии...');
      let versionData = await fs.readJson(versionJsonPath);
      console.log('Главный класс:', versionData.mainClass);

      // Для Forge/Fabric: объединяем библиотеки с базовой версией
      if (versionData.inheritsFrom) {
        console.log(`\n=== НАСЛЕДОВАНИЕ ОТ БАЗОВОЙ ВЕРСИИ ===`);
        console.log('Базовая версия:', versionData.inheritsFrom);

        const baseVersionPath = path.join(this.versionsDir, versionData.inheritsFrom, `${versionData.inheritsFrom}.json`);

        if (fs.existsSync(baseVersionPath)) {
          const baseVersionData = await fs.readJson(baseVersionPath);
          console.log('✓ Загружен базовый профиль:', versionData.inheritsFrom);

          const baseLibraries = baseVersionData.libraries || [];
          const modLoaderLibraries = versionData.libraries || [];
          versionData.libraries = [...baseLibraries, ...modLoaderLibraries];

          console.log(`\nБиблиотек из базы: ${baseLibraries.length}`);
          console.log(`Библиотек ${modLoader}: ${modLoaderLibraries.length}`);
          console.log(`Всего библиотек: ${versionData.libraries.length}`);

          if (!versionData.assetIndex && baseVersionData.assetIndex) {
            versionData.assetIndex = baseVersionData.assetIndex;
            console.log('✓ Унаследован assetIndex:', versionData.assetIndex.id);
          }

          if (!versionData.assets && baseVersionData.assets) {
            versionData.assets = baseVersionData.assets;
          }
        } else {
          console.warn(`⚠️  Базовый профиль не найден: ${baseVersionPath}`);
        }
      }

      // Создание директорий
      await fs.ensureDir(gameDir);
      const nativesDir = path.join(gameDir, 'natives');
      await fs.ensureDir(nativesDir);

      // Извлечение нативных библиотек
      console.log('\n=== ИЗВЛЕЧЕНИЕ НАТИВНЫХ БИБЛИОТЕК ===');
      await this.extractNatives(nativesDir, logStream);

      // Построение classpath
      const libraries = await this.buildClasspath(versionData, process.platform);
      
      // Добавляем JAR клиента для ванильного Minecraft
      if (modLoader === 'vanilla' || !modLoader) {
        const versionJar = path.join(this.versionsDir, version, `${version}.jar`);
        if (fs.existsSync(versionJar)) {
          libraries.push(versionJar);
        }
      }

      // КРИТИЧНО: Проверяем существование всех файлов в classpath
      console.log('\n=== ПРОВЕРКА ФАЙЛОВ CLASSPATH ===');
      const { missingFiles, nativesInClasspath } = await this.validateClasspath(libraries, logStream);

      if (missingFiles.length > 0) {
        throw new Error(`Отсутствуют ${missingFiles.length} файлов библиотек. Попробуйте переустановить версию.`);
      }

      // Убираем natives и дубликаты из classpath
      const filteredLibraries = this.filterClasspath(libraries, logStream);

      // ДЛЯ FORGE НЕ ФИЛЬТРУЕМ БИБЛИОТЕКИ - ОНИ ВСЕ НУЖНЫ В CLASSPATH!
      let finalLibraries = filteredLibraries;
      if (isForge) {
        console.log(`[LAUNCHER] Forge detected, keeping ALL ${filteredLibraries.length} libraries in classpath`);
        logStream.write(`[LAUNCHER] Forge detected - NO library filtering applied\n`);
      }

      const separator = process.platform === 'win32' ? ';' : ':';
      const classpath = finalLibraries.join(separator);

      console.log(`✓ Финальный classpath: ${finalLibraries.length} JAR файлов`);

      // Подготовка аргументов запуска
      const { jvmArgs, gameArgs, mainClass } = await this.prepareLaunchArguments({
        versionData,
        versionId,
        username,
        memory,
        gameDir,
        nativesDir,
        classpath,
        isForge,
        libraries: finalLibraries
      }, logStream);

      // Финальная команда запуска
      const allArgs = [
        ...jvmArgs,
        '-cp',
        classpath,
        mainClass,
        ...gameArgs
      ];

      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА ===');
      console.log('JVM аргументов:', jvmArgs.length);
      console.log('Classpath entries:', finalLibraries.length);
      console.log('Main class:', mainClass);
      console.log('Game аргументов:', gameArgs.length);

      // Записываем в лог
      logStream.write('\n=== ИСПОЛЬЗУЕТСЯ ПРЯМОЙ ЗАПУСК (spawn) ===\n');
      logStream.write(`Main class: ${mainClass}\n`);
      logStream.write(`Classpath entries: ${finalLibraries.length}\n\n`);
      logStream.write('JVM ARGS:\n');
      jvmArgs.forEach((arg, i) => logStream.write(`  [${i}] ${arg}\n`));
      logStream.write('\nGAME ARGS:\n');
      gameArgs.forEach((arg, i) => logStream.write(`  [${i}] ${arg}\n`));
      logStream.write('='.repeat(80) + '\n\n');

      // Создаём BAT файл для отладки
      await this.createDebugBatFile(gameDir, javaPath, jvmArgs, classpath, mainClass, gameArgs);

      // Запуск процесса
      const gameProcess = spawn(javaPath, allArgs, {
        cwd: gameDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Обработка вывода процесса
      this.setupProcessHandlers(gameProcess, logFile, logStream, callback);

      console.log('✓ Процесс запущен с PID:', gameProcess.pid);
      callback(null, gameProcess);

    } catch (error) {
      callback(new Error(`Ошибка при подготовке запуска: ${error.message}`));
    }
  }

  /**
   * Построение classpath из библиотек версии
   */
  async buildClasspath(versionData, osName) {
    const libraries = [];

    for (const lib of versionData.libraries) {
      let allowed = true;

      if (lib.rules) {
        allowed = false;
        for (const rule of lib.rules) {
          if (rule.action === 'allow') {
            if (!rule.os || this.checkOsRule(rule.os, osName)) {
              allowed = true;
            }
          } else if (rule.action === 'disallow') {
            if (!rule.os || this.checkOsRule(rule.os, osName)) {
              allowed = false;
            }
          }
        }
      }

      if (allowed) {
        let libPath = null;

        if (lib.downloads && lib.downloads.artifact) {
          const normalizedPath = lib.downloads.artifact.path.split('/').join(path.sep);
          libPath = path.join(this.librariesDir, normalizedPath);
        } else if (lib.name) {
          const parts = lib.name.split(':');
          if (parts.length >= 3) {
            const [group, artifact, version] = parts;
            const groupPath = group.replace(/\./g, '/');
            const fileName = `${artifact}-${version}.jar`;
            libPath = path.join(this.librariesDir, groupPath, artifact, version, fileName);
          }
        }

        if (libPath && fs.existsSync(libPath)) {
          const libName = path.basename(libPath);
          if (!libName.includes('-natives-')) {
            libraries.push(libPath);
          }
        }
      }
    }

    return libraries;
  }

  /**
   * Проверка правил ОС для библиотек
   */
  checkOsRule(osRule, osName) {
    if (osRule.name && osRule.name !== osName) {
      return false;
    }

    if (osRule.arch) {
      const arch = process.arch === 'x64' ? 'x86' : process.arch;
      if (osRule.arch !== arch) {
        return false;
      }
    }

    return true;
  }

  /**
   * Извлечение нативных библиотек
   */
  async extractNatives(nativesDir, logStream) {
    let nativesExtracted = 0;

    const findNativeJars = (dir) => {
      const results = [];
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          results.push(...findNativeJars(fullPath));
        } else if (item.endsWith('.jar') && item.includes('-natives-')) {
          results.push(fullPath);
        }
      }

      return results;
    };

    const allNativeJars = findNativeJars(this.librariesDir);
    console.log(`Найдено JAR файлов с natives: ${allNativeJars.length}`);

    const platformSuffix = process.platform === 'win32' ? 'windows' :
                          process.platform === 'darwin' ? 'macos' : 'linux';

    let nativeJarsForPlatform = allNativeJars.filter(jar => 
      path.basename(jar).includes(`-natives-${platformSuffix}`)
    );

    if (nativeJarsForPlatform.length === 0) {
      nativeJarsForPlatform = allNativeJars;
    }

    for (const nativePath of nativeJarsForPlatform) {
      const baseName = path.basename(nativePath);
      logStream.write(`[NATIVES] Extracting: ${baseName}\n`);

      try {
        const StreamZip = require('node-stream-zip');
        const zip = new StreamZip({ file: nativePath, storeEntries: true });

        await new Promise((resolve, reject) => {
          zip.on('ready', () => {
            const entries = zip.entries();
            let extractedFiles = 0;

            const nativeExtensions = process.platform === 'win32' ? ['.dll'] :
                                    process.platform === 'darwin' ? ['.dylib', '.jnilib'] :
                                    ['.so'];

            for (const entryName in entries) {
              const entry = entries[entryName];

              if (entry.isDirectory || entryName.startsWith('META-INF/')) {
                continue;
              }

              const hasValidExtension = nativeExtensions.some(ext => 
                entryName.toLowerCase().endsWith(ext)
              );
              
              if (hasValidExtension) {
                const destPath = path.join(nativesDir, path.basename(entryName));
                try {
                  const data = zip.entryDataSync(entryName);
                  fs.writeFileSync(destPath, data);
                  extractedFiles++;
                  logStream.write(`[NATIVES]   -> ${path.basename(entryName)} (${data.length} bytes)\n`);
                } catch (err) {
                  console.error(`  ❌ ${entryName}:`, err.message);
                }
              }
            }

            nativesExtracted += extractedFiles;
            zip.close();
            resolve();
          });
          zip.on('error', reject);
        });
      } catch (err) {
        console.error(`[ERROR] ${baseName}:`, err.message);
      }
    }

    console.log(`Извлечено файлов: ${nativesExtracted}`);
    logStream.write(`[NATIVES] Total extracted: ${nativesExtracted} files\n`);
  }

  /**
   * Валидация classpath
   */
  async validateClasspath(libraries, logStream) {
    let missingFiles = [];
    let nativesInClasspath = [];

    for (let i = 0; i < libraries.length; i++) {
      const lib = libraries[i];
      const exists = fs.existsSync(lib);
      const libName = path.basename(lib);

      if (libName.includes('-natives-')) {
        nativesInClasspath.push(libName);
        logStream.write(`[WARNING] Natives in classpath: ${libName}\n`);
      }

      if (!exists) {
        missingFiles.push(lib);
        logStream.write(`[MISSING] ${lib}\n`);
      }
    }

    if (nativesInClasspath.length > 0) {
      console.error(`⚠️  КРИТИЧЕСКАЯ ОШИБКА: ${nativesInClasspath.length} natives JAR файлов в classpath!`);
      logStream.write(`[CRITICAL ERROR] ${nativesInClasspath.length} natives in classpath!\n`);
    }

    return { missingFiles, nativesInClasspath };
  }

  /**
   * Фильтрация classpath (убираем natives и дубликаты)
   */
  filterClasspath(libraries, logStream) {
    const withoutNatives = libraries.filter(lib => {
      const libName = path.basename(lib);
      const isNative = libName.includes('-natives-');
      if (isNative) {
        logStream.write(`[FILTER] Removed natives from classpath: ${libName}\n`);
      }
      return !isNative;
    });

    const uniqueLibraries = [...new Set(withoutNatives)];
    if (uniqueLibraries.length < withoutNatives.length) {
      const duplicates = withoutNatives.length - uniqueLibraries.length;
      logStream.write(`[INFO] Removed ${duplicates} duplicates from classpath\n`);
    }

    return uniqueLibraries;
  }

  /**
   * Подготовка аргументов запуска
   */
  async prepareLaunchArguments(options, logStream) {
    const { versionData, versionId, username, memory, gameDir, nativesDir, classpath, isForge, libraries } = options;

    const uuid = this.generateUUID(username);

    let assetIndexName = versionData.inheritsFrom || versionId.split('-')[0];
    if (versionData.assetIndex && versionData.assetIndex.id) {
      assetIndexName = versionData.assetIndex.id;
    }

    const variables = {
      auth_player_name: username,
      version_name: versionId,
      game_directory: gameDir,
      assets_root: this.assetsDir,
      assets_index_name: assetIndexName,
      auth_uuid: uuid,
      auth_access_token: uuid,
      clientid: '0',
      auth_xuid: '0',
      user_type: 'legacy',
      version_type: versionData.type || 'release',
      natives_directory: nativesDir,
      launcher_name: 'aureate-launcher',
      launcher_version: '1.0.0',
      classpath: classpath,
      library_directory: this.librariesDir,
      classpath_separator: process.platform === 'win32' ? ';' : ':'
    };

    const jvmArgs = [];

    jvmArgs.push(`-Xmx${memory}M`);
    jvmArgs.push(`-Xms${Math.floor(memory / 2)}M`);

    if (isForge) {
      await this.loadForgeArguments(versionId, jvmArgs, variables, logStream);
    }

    if (versionData.arguments && versionData.arguments.jvm && !isForge) {
      this.processVersionJvmArgs(versionData.arguments.jvm, jvmArgs, variables, process.platform);
    } else {
      jvmArgs.push(`-Djava.library.path=${nativesDir}`);
    }

    const gameArgs = this.prepareGameArgs(versionData, variables);

    return {
      jvmArgs,
      gameArgs,
      mainClass: versionData.mainClass
    };
  }

  /**
   * Загрузка аргументов Forge из win_args.txt
   */
  async loadForgeArguments(versionId, jvmArgs, variables, logStream) {
    const argsFileName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
    
    const forgeFullVersion = versionId.replace(/-forge-/, '-');
    const argsFilePath = path.join(this.librariesDir, 'net', 'minecraftforge', 'forge', forgeFullVersion, argsFileName);

    logStream.write(`[FORGE] Searching for: ${argsFilePath}\n`);

    if (fs.existsSync(argsFilePath)) {
      try {
        const forgeArgsContent = await fs.readFile(argsFilePath, 'utf8');
        logStream.write(`[FORGE] ✓ File exists!\n`);

        const forgeArgsParsed = forgeArgsContent.trim().split(/\s+/);
        let hitMainClass = false;

        forgeArgsParsed.forEach((arg, idx) => {
          if (hitMainClass) return;

          if (arg.match(/^(cpw\.mods\.|net\.minecraftforge\.|com\.mojang\.)/) && !arg.startsWith('-')) {
            hitMainClass = true;
            return;
          }

          if (arg.startsWith('--') && !arg.startsWith('--add-')) {
            hitMainClass = true;
            return;
          }

          let processedArg = this.processForgeArgument(arg, variables);
          jvmArgs.push(processedArg);
        });

        logStream.write(`[FORGE] ✓ Added ${forgeArgsParsed.length} JVM arguments from ${argsFileName}\n`);
      } catch (err) {
        console.error(`⚠️  Ошибка чтения ${argsFileName}:`, err.message);
      }
    }
  }

  /**
   * Обработка аргументов Forge (замена путей)
   */
  processForgeArgument(arg, variables) {
    let processedArg = arg;

    if (arg.startsWith('-DlibraryDirectory=')) {
      const eqIndex = arg.indexOf('=');
      const paramValue = arg.substring(eqIndex + 1);
      if (paramValue === 'libraries') {
        processedArg = '-DlibraryDirectory=' + this.librariesDir;
      }
    } else if (arg.includes('libraries/') || arg.includes('libraries\\')) {
      processedArg = this.convertLibraryPaths(arg);
    }

    return processedArg;
  }

  /**
   * Конвертация путей библиотек
   */
  convertLibraryPaths(arg) {
    const convertPath = (p) => {
      if (p.startsWith('libraries/') || p.startsWith('libraries\\')) {
        let relativePath = p.replace(/^libraries[\/\\]/, '');
        
        if (relativePath.includes('net/minecraft/server/') || relativePath.includes('net\\minecraft\\server\\')) {
          relativePath = relativePath.replace(/net[\/\\]minecraft[\/\\]server[\/\\]/g, 'net/minecraft/client/');
          relativePath = relativePath.replace(/server-(\d+\.\d+(?:\.\d+)?-)/g, 'client-$1');
        }

        const normalizedPath = relativePath.split('/').join(path.sep);
        return path.join(this.librariesDir, normalizedPath);
      }
      return p;
    };

    if (arg.includes('=')) {
      const eqIndex = arg.indexOf('=');
      const paramName = arg.substring(0, eqIndex + 1);
      const paramValue = arg.substring(eqIndex + 1);

      if (paramValue.includes(';') || paramValue.includes(':')) {
        const separator = paramValue.includes(';') ? ';' : ':';
        const paths = paramValue.split(separator);
        const convertedPaths = paths.map(convertPath);
        return paramName + convertedPaths.join(path.delimiter);
      } else {
        return paramName + convertPath(paramValue);
      }
    } else if (arg.startsWith('libraries/') || arg.startsWith('libraries\\')) {
      if (arg.includes(';') || arg.includes(':')) {
        const separator = arg.includes(';') ? ';' : ':';
        const paths = arg.split(separator);
        const convertedPaths = paths.map(convertPath);
        return convertedPaths.join(path.delimiter);
      } else {
        return convertPath(arg);
      }
    }

    return arg;
  }

  /**
   * Обработка JVM аргументов из версии
   */
  processVersionJvmArgs(jvmArgsFromVersion, jvmArgs, variables, osName) {
    let addedCount = 0;

    for (const arg of jvmArgsFromVersion) {
      if (typeof arg === 'string') {
        const replaced = this.replaceVariables(arg, variables);
        jvmArgs.push(replaced);
        addedCount++;
      } else if (arg.rules) {
        let allowed = true;
        
        for (const rule of arg.rules) {
          if (rule.action === 'allow') {
            if (rule.os && !this.checkOsRule(rule.os, osName)) {
              allowed = false;
            }
          } else if (rule.action === 'disallow') {
            if (!rule.os || this.checkOsRule(rule.os, osName)) {
              allowed = false;
            }
          }
        }

        if (allowed && arg.value) {
          const values = Array.isArray(arg.value) ? arg.value : [arg.value];
          values.forEach(v => {
            const replaced = this.replaceVariables(v, variables);
            jvmArgs.push(replaced);
            addedCount++;
          });
        }
      }
    }

    console.log(`✓ JVM arguments: добавлено ${addedCount}`);
  }

  /**
   * Подготовка игровых аргументов
   */
  prepareGameArgs(versionData, variables) {
    const gameArgs = [];

    if (versionData.arguments && versionData.arguments.game) {
      for (const arg of versionData.arguments.game) {
        if (typeof arg === 'string') {
          gameArgs.push(this.replaceVariables(arg, variables));
        } else if (arg.rules) {
          let allowed = false;
          for (const rule of arg.rules) {
            if (rule.action === 'allow') {
              if (!rule.os || this.checkOsRule(rule.os, process.platform)) {
                allowed = true;
              }
            }
          }
          if (allowed && arg.value) {
            const values = Array.isArray(arg.value) ? arg.value : [arg.value];
            values.forEach(v => gameArgs.push(this.replaceVariables(v, variables)));
          }
        }
      }
    } else if (versionData.minecraftArguments) {
      const args = versionData.minecraftArguments.split(' ');
      args.forEach(arg => gameArgs.push(this.replaceVariables(arg, variables)));
    }

    return gameArgs;
  }

  /**
   * Замена переменных в строках
   */
  replaceVariables(str, variables) {
    return str.replace(/\$\{([^}]+)\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  /**
   * Создание BAT файла для отладки
   */
  async createDebugBatFile(gameDir, javaPath, jvmArgs, classpath, mainClass, gameArgs) {
    const batFilePath = path.join(gameDir, 'run_minecraft.bat');
    
    const batContent = `@echo off
chcp 65001 >nul
echo ========================================
echo MINECRAFT LAUNCHER
echo ========================================
echo.
echo Working directory: ${gameDir}
echo Java: ${javaPath}
echo Main class: ${mainClass}
echo.
echo Press ENTER to start Minecraft...
pause >nul
echo.
echo Starting Minecraft...
echo.

cd /d "${gameDir}"
"${javaPath}" ${jvmArgs.join(' ')} -cp "${classpath}" ${mainClass} ${gameArgs.join(' ')}

echo.
echo ========================================
echo Exit code: %ERRORLEVEL%
echo ========================================
echo.
echo Press any key to close...
pause >nul
`;

    await fs.writeFile(batFilePath, batContent, 'utf8');
    console.log(`✓ Создан BAT файл для ручной отладки: ${batFilePath}`);
  }

  /**
   * Настройка обработчиков процесса
   */
  setupProcessHandlers(gameProcess, logFile, logStream, callback) {
    let hasOutput = false;
    let errorOutput = '';
    let startTime = Date.now();

    gameProcess.stdout.on('data', (data) => {
      hasOutput = true;
      const text = data.toString();
      console.log('[Minecraft]', text.trim());
      logStream.write('[STDOUT] ' + text);
    });

    gameProcess.stderr.on('data', (data) => {
      hasOutput = true;
      const text = data.toString();
      errorOutput += text;
      console.error('[Minecraft ERROR]', text.trim());
      logStream.write('[STDERR] ' + text);
    });

    gameProcess.on('error', (error) => {
      const errorMsg = `Ошибка при запуске процесса: ${error.message}`;
      console.error(errorMsg);
      logStream.write(`\n[PROCESS ERROR] ${errorMsg}\n`);
      logStream.end();
      callback(new Error(errorMsg));
    });

    gameProcess.on('close', (code) => {
      const runTime = Date.now() - startTime;
      const endMsg = `\n[ЗАВЕРШЕНИЕ] Код выхода: ${code}, Время работы: ${runTime}ms\n`;

      logStream.write(endMsg);
      logStream.end();

      if (code === 0) {
        console.log(`✓ Minecraft завершён успешно (работал ${(runTime/1000).toFixed(1)}с)`);
      } else {
        console.log(`✗ Minecraft завершён с кодом ${code} (работал ${(runTime/1000).toFixed(1)}с)`);
      }
    });

    setTimeout(() => {
      try {
        process.kill(gameProcess.pid, 0);
        console.log('✓ Процесс стабилен (работает более 2 секунд)');
      } catch (e) {
        console.error('\n⚠️  ПРОЦЕСС УПАЛ В ПЕРВЫЕ 2 СЕКУНДЫ!');
        console.error('Проверьте логи:', logFile);
      }
    }, 2000);
  }
}

module.exports = MinecraftLauncher;
