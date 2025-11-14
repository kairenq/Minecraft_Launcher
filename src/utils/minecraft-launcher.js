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
    // Генерация детерминированного UUID на основе имени пользователя
    const hash = crypto.createHash('md5').update(username).digest('hex');
    return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-${hash.substr(12, 4)}-${hash.substr(16, 4)}-${hash.substr(20, 12)}`;
  }

  async buildClasspath(versionData, osName) {
    const libraries = [];

    for (const lib of versionData.libraries) {
      // Проверка правил для библиотеки
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

      if (allowed && lib.downloads && lib.downloads.artifact) {
        const libPath = path.join(this.librariesDir, lib.downloads.artifact.path);
        if (fs.existsSync(libPath)) {
          libraries.push(libPath);
        }
      }

      // Нативные библиотеки НЕ добавляем в classpath!
      // Они распаковываются в natives директорию и загружаются через -Djava.library.path
      // Добавление natives JAR файлов в classpath может вызвать ClassNotFoundException
    }

    return libraries;
  }

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

  replaceVariables(str, variables) {
    return str.replace(/\$\{([^}]+)\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  async launch(options, callback) {
    try {
      const { version, username, memory, javaPath, gameDir, modLoader, modLoaderVersion } = options;

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

      // Определение ОС
      const osName = process.platform === 'win32' ? 'windows' :
                     process.platform === 'darwin' ? 'osx' : 'linux';

      console.log('Операционная система:', osName);

      // Определение ID версии в зависимости от модлоадера
      let versionId = version;

      if (modLoader === 'fabric') {
        // Fabric: fabric-loader-{loaderVersion}-{minecraftVersion}
        if (modLoaderVersion) {
          versionId = `fabric-loader-${modLoaderVersion}-${version}`;
        } else {
          // Ищем любую fabric версию для этого Minecraft
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
        // Forge: ищем forge профиль
        const versions = fs.readdirSync(this.versionsDir);
        const forgeVersion = versions.find(v => v.includes('forge') && v.includes(version));
        if (forgeVersion) {
          versionId = forgeVersion;
          console.log('Используется Forge профиль:', versionId);
        } else {
          throw new Error(`Forge не установлен для Minecraft ${version}. Установите сборку заново.`);
        }
      }

      // Загрузка данных версии
      const versionJsonPath = path.join(this.versionsDir, versionId, `${versionId}.json`);

      if (!fs.existsSync(versionJsonPath)) {
        const error = `Файл версии не найден: ${versionJsonPath}.\nПереустановите сборку.`;
        console.error(error);
        throw new Error(error);
      }

      // Для ванильного Minecraft проверяем JAR файл
      if (modLoader === 'vanilla' || !modLoader) {
        const versionJarPath = path.join(this.versionsDir, version, `${version}.jar`);
        if (!fs.existsSync(versionJarPath)) {
          const error = `JAR файл игры не найден: ${versionJarPath}.\nПереустановите сборку.`;
          console.error(error);
          throw new Error(error);
        }
      }
      // Для Forge/Fabric проверка JAR не требуется - они используют свои профили

      console.log('Загрузка конфигурации версии...');
      const versionData = await fs.readJson(versionJsonPath);
      console.log('Главный класс:', versionData.mainClass);

      // Создание директорий
      await fs.ensureDir(gameDir);
      const nativesDir = path.join(gameDir, 'natives');
      await fs.ensureDir(nativesDir);

      // Создаем файл для логов (делаем это СРАЗУ, чтобы можно было логировать все операции)
      const logsDir = path.join(gameDir, 'logs');
      await fs.ensureDir(logsDir);
      const logFile = path.join(logsDir, 'launcher.log');
      const logStream = fs.createWriteStream(logFile, { flags: 'a' });

      // Записываем заголовок в лог
      logStream.write('\n' + '='.repeat(80) + '\n');
      logStream.write(`ЗАПУСК: ${new Date().toISOString()}\n`);
      logStream.write(`Версия: ${version}\n`);
      logStream.write(`Пользователь: ${username}\n`);
      logStream.write(`RAM: ${memory} MB\n`);
      logStream.write(`Java: ${javaPath}\n`);
      logStream.write(`GameDir: ${gameDir}\n`);
      logStream.write('='.repeat(80) + '\n\n');

      // Извлечение нативных библиотек
      console.log('\n=== ИЗВЛЕЧЕНИЕ НАТИВНЫХ БИБЛИОТЕК ===');
      console.log('Platform:', process.platform);
      logStream.write('\n=== ИЗВЛЕЧЕНИЕ НАТИВНЫХ БИБЛИОТЕК ===\n');

      let nativesExtracted = 0;

      // НОВЫЙ ПОДХОД: Сканируем весь libraries директорию и ищем все JAR с "-natives-" в названии
      console.log('Сканируем libraries директорию:', this.librariesDir);

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

      // Фильтруем для текущей платформы
      const platformSuffix = process.platform === 'win32' ? 'windows' :
                            process.platform === 'darwin' ? 'macos' : 'linux';

      let nativeJarsForPlatform = allNativeJars.filter(jar => path.basename(jar).includes(`-natives-${platformSuffix}`));
      console.log(`Подходящих для ${platformSuffix}: ${nativeJarsForPlatform.length}`);

      // Если не нашли для текущей платформы - берём все
      if (nativeJarsForPlatform.length === 0) {
        console.warn(`⚠️  Нет natives для ${platformSuffix}, извлекаем из всех`);
        nativeJarsForPlatform = allNativeJars;
      }

      for (const nativePath of nativeJarsForPlatform) {
        const baseName = path.basename(nativePath);
        console.log(`\n[NATIVES] ${baseName}`);
        logStream.write(`[NATIVES] Extracting: ${baseName}\n`);

        try {
          const StreamZip = require('node-stream-zip');
          const zip = new StreamZip({ file: nativePath, storeEntries: true });

          await new Promise((resolve, reject) => {
            zip.on('ready', () => {
              const entries = zip.entries();
              let extractedFiles = 0;

              // Извлекаем только нативные библиотеки
              const nativeExtensions = process.platform === 'win32' ? ['.dll'] :
                                      process.platform === 'darwin' ? ['.dylib', '.jnilib'] :
                                      ['.so'];

              for (const entryName in entries) {
                const entry = entries[entryName];

                if (entry.isDirectory || entryName.startsWith('META-INF/')) {
                  continue;
                }

                const hasValidExtension = nativeExtensions.some(ext => entryName.toLowerCase().endsWith(ext));
                if (hasValidExtension) {
                  const destPath = path.join(nativesDir, path.basename(entryName));
                  try {
                    const data = zip.entryDataSync(entryName);
                    fs.writeFileSync(destPath, data);
                    extractedFiles++;
                    console.log(`  ✓ ${path.basename(entryName)} (${(data.length / 1024).toFixed(1)} KB)`);
                    logStream.write(`[NATIVES]   -> ${path.basename(entryName)} (${data.length} bytes)\n`);
                  } catch (err) {
                    console.error(`  ❌ ${entryName}:`, err.message);
                  }
                }
              }

              console.log(`  Извлечено: ${extractedFiles} файлов`);
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

      console.log(`\n=== ИТОГИ ИЗВЛЕЧЕНИЯ ===`);
      console.log(`Найдено native JAR: ${nativeJarsForPlatform.length}`);
      console.log(`Извлечено файлов: ${nativesExtracted}`);
      logStream.write(`[NATIVES] Total extracted: ${nativesExtracted} files\n`);

      // Проверяем результат
      const nativeFiles = fs.readdirSync(nativesDir);
      console.log(`Файлов в natives: ${nativeFiles.length}`);

      if (nativeFiles.length > 0) {
        console.log('Список:');
        nativeFiles.forEach(file => {
          const stats = fs.statSync(path.join(nativesDir, file));
          console.log(`  - ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
        });
      } else {
        const errorMsg = 'Ни один нативный файл не был извлечен!';
        console.error('\n❌', errorMsg);
        console.error('Native JARs найдено:', allNativeJars.length);
        console.error('Для платформы:', nativeJarsForPlatform.length);
        throw new Error(errorMsg);
      }


      // Построение classpath
      const libraries = await this.buildClasspath(versionData, osName);

      // Добавляем JAR клиента если это ванильный Minecraft
      // Для Forge/Fabric classpath уже включён в профиль
      if (modLoader === 'vanilla' || !modLoader) {
        const versionJar = path.join(this.versionsDir, version, `${version}.jar`);
        libraries.push(versionJar);
      }

      // КРИТИЧНО: Проверяем существование всех файлов в classpath
      console.log('\n=== ПРОВЕРКА ФАЙЛОВ CLASSPATH ===');
      logStream.write('\n=== ПРОВЕРКА ФАЙЛОВ CLASSPATH ===\n');

      let missingFiles = [];
      let nativesInClasspath = [];

      for (let i = 0; i < libraries.length; i++) {
        const lib = libraries[i];
        const exists = fs.existsSync(lib);
        const libName = path.basename(lib);

        // Проверяем не попали ли natives в classpath (это ошибка!)
        if (libName.includes('-natives-')) {
          nativesInClasspath.push(libName);
          console.error(`⚠️  ОШИБКА: Natives JAR в classpath [${i}]: ${libName}`);
          logStream.write(`[WARNING] Natives in classpath: ${libName}\n`);
        }

        if (!exists) {
          missingFiles.push(lib);
          console.error(`❌ ОТСУТСТВУЕТ [${i}]: ${lib}`);
          logStream.write(`[MISSING] ${lib}\n`);
        } else {
          const stats = fs.statSync(lib);
          if (i < 5 || i === libraries.length - 1) { // Показываем первые 5 и последний (client.jar)
            console.log(`✓ [${i}] ${libName} (${(stats.size / 1024).toFixed(1)} KB)`);
          }
        }
      }

      if (nativesInClasspath.length > 0) {
        console.error(`\n⚠️  КРИТИЧЕСКАЯ ОШИБКА: ${nativesInClasspath.length} natives JAR файлов в classpath!`);
        console.error('Natives НЕ должны быть в classpath - это вызывает ClassNotFoundException');
        console.error('Первые natives:', nativesInClasspath.slice(0, 5));
        logStream.write(`\n[CRITICAL ERROR] ${nativesInClasspath.length} natives in classpath!\n`);
        logStream.write(`Natives list: ${nativesInClasspath.join(', ')}\n`);
      }

      if (missingFiles.length > 0) {
        const errorMsg = `КРИТИЧЕСКАЯ ОШИБКА: Отсутствуют ${missingFiles.length} файлов библиотек!\nПервые отсутствующие:\n${missingFiles.slice(0, 5).join('\n')}`;
        console.error('\n' + errorMsg);
        logStream.write('\n' + errorMsg + '\n');
        throw new Error(`Отсутствуют ${missingFiles.length} файлов. Возможно, Minecraft скачался не полностью. Попробуйте переустановить версию.`);
      }

      console.log(`Всего библиотек: ${libraries.length}, все файлы найдены ✓`);
      if (nativesInClasspath.length === 0) {
        console.log('✓ Natives НЕ обнаружены в classpath (правильно!)');
      }
      logStream.write(`Всего библиотек: ${libraries.length}\n`);

      // КРИТИЧЕСКИ ВАЖНО: Убираем natives из classpath если они случайно попали туда
      // Natives JAR файлы НЕ должны быть в classpath!
      const filteredLibraries = libraries.filter(lib => {
        const libName = path.basename(lib);
        const isNative = libName.includes('-natives-');
        if (isNative) {
          console.warn(`Фильтрация natives из classpath: ${libName}`);
          logStream.write(`[FILTER] Removed natives from classpath: ${libName}\n`);
        }
        return !isNative;
      });

      if (filteredLibraries.length < libraries.length) {
        const removed = libraries.length - filteredLibraries.length;
        console.log(`✓ Отфильтровано ${removed} natives JAR файлов из classpath`);
        logStream.write(`[INFO] Filtered out ${removed} natives JARs\n`);
      }

      const separator = process.platform === 'win32' ? ';' : ':';
      const classpath = filteredLibraries.join(separator);

      console.log(`✓ Финальный classpath: ${filteredLibraries.length} JAR файлов (без natives)`);

      // Логируем финальную команду
      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА ===');
      logStream.write('\n=== ФИНАЛЬНАЯ КОМАНДА ===\n');
      console.log('Java:', javaPath);
      logStream.write(`Java: ${javaPath}\n`);

      // Генерация UUID для offline режима
      const uuid = this.generateUUID(username);

      // Переменные для замены
      const variables = {
        auth_player_name: username,
        version_name: version,
        game_directory: gameDir,
        assets_root: this.assetsDir,
        assets_index_name: versionData.assetIndex.id,
        auth_uuid: uuid,
        auth_access_token: uuid, // В offline режиме используем UUID как токен
        clientid: '0', // Offline режим - нет OAuth client ID
        auth_xuid: '0', // Offline режим - нет Xbox User ID
        user_type: 'legacy',
        version_type: versionData.type,
        natives_directory: nativesDir,
        launcher_name: 'minecraft-custom-launcher',
        launcher_version: '1.0.0',
        classpath: classpath
      };

      // JVM аргументы
      const jvmArgs = [];

      // Базовые JVM аргументы
      jvmArgs.push(`-Xmx${memory}M`);
      jvmArgs.push(`-Xms${Math.floor(memory / 2)}M`);

      // Аргументы из версии (если есть)
      if (versionData.arguments && versionData.arguments.jvm) {
        for (const arg of versionData.arguments.jvm) {
          if (typeof arg === 'string') {
            jvmArgs.push(this.replaceVariables(arg, variables));
          } else if (arg.rules) {
            // Проверка правил
            let allowed = false;
            for (const rule of arg.rules) {
              if (rule.action === 'allow' && this.checkOsRule(rule.os || {}, osName)) {
                allowed = true;
              }
            }
            if (allowed && arg.value) {
              if (Array.isArray(arg.value)) {
                arg.value.forEach(v => jvmArgs.push(this.replaceVariables(v, variables)));
              } else {
                jvmArgs.push(this.replaceVariables(arg.value, variables));
              }
            }
          }
        }
      } else {
        // Старый формат (< 1.13)
        jvmArgs.push(`-Djava.library.path=${nativesDir}`);
        jvmArgs.push(`-cp`);
        jvmArgs.push(classpath);
      }

      // Game аргументы
      const gameArgs = [];

      if (versionData.arguments && versionData.arguments.game) {
        for (const arg of versionData.arguments.game) {
          if (typeof arg === 'string') {
            gameArgs.push(this.replaceVariables(arg, variables));
          } else if (arg.rules) {
            // Проверка правил для game аргументов (некоторые аргументы условные)
            let allowed = false;
            for (const rule of arg.rules) {
              if (rule.action === 'allow') {
                // Проверяем features если они есть
                if (rule.features) {
                  // Пропускаем аргументы которые требуют специфичные features
                  // (например, is_demo_user, has_custom_resolution)
                  continue;
                }
                if (!rule.os || this.checkOsRule(rule.os, osName)) {
                  allowed = true;
                }
              }
            }
            if (allowed && arg.value) {
              if (Array.isArray(arg.value)) {
                arg.value.forEach(v => gameArgs.push(this.replaceVariables(v, variables)));
              } else {
                gameArgs.push(this.replaceVariables(arg.value, variables));
              }
            }
          }
        }
      } else if (versionData.minecraftArguments) {
        // Старый формат
        const args = versionData.minecraftArguments.split(' ');
        args.forEach(arg => gameArgs.push(this.replaceVariables(arg, variables)));
      }

      // Главный класс
      const mainClass = versionData.mainClass;

      // ========================================================================
      // ОКОНЧАТЕЛЬНОЕ РЕШЕНИЕ: Прямая передача classpath через spawn
      // Исследование показало что JAR Manifest НЕ поддерживает абсолютные пути!
      // Node.js spawn() АВТОМАТИЧЕСКИ экранирует аргументы - это ПРАВИЛЬНОЕ решение!
      // Так делают MultiMC, PrismLauncher и другие профессиональные лаунчеры
      // ========================================================================

      console.log('\n=== ПОДГОТОВКА ЗАПУСКА ===');
      logStream.write('\n=== ПОДГОТОВКА ЗАПУСКА ===\n');

      // separator уже определён выше на строке 244!
      const classpathFinal = filteredLibraries.join(separator);

      console.log(`Classpath: ${filteredLibraries.length} JAR файлов`);
      console.log(`Длина classpath: ${classpathFinal.length} символов`);
      logStream.write(`[CLASSPATH] ${filteredLibraries.length} JARs, ${classpathFinal.length} chars\n`);
      const jvmArgsNoCp = jvmArgs.filter((arg, i) => {
        if (arg === '-cp') return false;
        if (i > 0 && jvmArgs[i-1] === '-cp') return false;
        return true;
      });

      // Финальная команда: java [JVM_ARGS] -cp [CLASSPATH] [MAIN_CLASS] [GAME_ARGS]
      // Node.js spawn() АВТОМАТИЧЕСКИ экранирует все аргументы включая пробелы!
      const allArgs = [
        ...jvmArgsNoCp,
        '-cp',
        classpathFinal,  // Node.js САМА обернёт в кавычки если нужно!
        mainClass,
        ...gameArgs
      ];

      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА ===');
      console.log('Метод: Прямая передача через spawn()');
      console.log('JVM аргументов:', jvmArgsNoCp.length);
      console.log('Classpath entries:', filteredLibraries.length);
      console.log('Main class:', mainClass);
      console.log('Game аргументов:', gameArgs.length);
      console.log('RAM выделено:', memory, 'MB');
      console.log('\nЗапуск процесса Java...\n');

      // Записываем полную команду запуска в лог
      logStream.write('\n=== ИСПОЛЬЗУЕТСЯ ПРЯМОЙ ЗАПУСК (spawn) ===\n');
      logStream.write(`Main class: ${mainClass}\n`);
      logStream.write(`Classpath entries: ${filteredLibraries.length}\n`);
      logStream.write(`Classpath length: ${classpathFinal.length} chars\n\n`);
      logStream.write('JVM ARGS:\n');
      jvmArgsNoCp.forEach((arg, i) => logStream.write(`  [${i}] ${arg}\n`));
      logStream.write(`\n[CLASSPATH] ${filteredLibraries.length} JARs:\n`);
      filteredLibraries.forEach((jar, i) => {
        logStream.write(`  [${i}] ${path.basename(jar)}\n`);
      });
      logStream.write('\nGAME ARGS:\n');
      gameArgs.forEach((arg, i) => logStream.write(`  [${i}] ${arg}\n`));
      logStream.write('='.repeat(80) + '\n\n');

      console.log('\n💾 Логи записываются в:', logFile);

      // ========== СОЗДАЁМ BAT ФАЙЛ ДЛЯ РУЧНОЙ ОТЛАДКИ ==========
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
echo Classpath JARs: ${filteredLibraries.length}
echo.
echo Press ENTER to start Minecraft...
pause >nul
echo.
echo Starting Minecraft...
echo.

cd /d "${gameDir}"
"${javaPath}" ${jvmArgsNoCp.join(' ')} -cp "${classpathFinal}" ${mainClass} ${gameArgs.join(' ')}

echo.
echo ========================================
echo Exit code: %ERRORLEVEL%
echo ========================================
echo.
echo Press any key to close...
pause >nul
`;

      await fs.writeFile(batFilePath, batContent, 'utf8');

      console.log(`\n✓ Создан BAT файл для ручной отладки:`);
      console.log(`  ${batFilePath}`);
      logStream.write(`\n[INFO] Created BAT file\n`);

      // Запуск процесса
      const gameProcess = spawn(javaPath, allArgs, {
        cwd: gameDir,
        stdio: ['ignore', 'pipe', 'pipe'] // Захват вывода для отладки
      });

      let hasOutput = false;
      let errorOutput = '';
      let startTime = Date.now();

      // Вывод stdout и stderr в консоль И в файл
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
        callback(new Error(`Ошибка запуска процесса Java: ${error.message}`));
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

          // Если процесс упал быстро (меньше 5 секунд), это ошибка
          if (runTime < 5000) {
            console.error('\n⚠️  ПРОЦЕСС УПАЛ СРАЗУ ПОСЛЕ ЗАПУСКА!');
            console.error('Последние ошибки:');
            if (errorOutput) {
              console.error(errorOutput.split('\n').slice(-10).join('\n'));
            }
            console.error('\nПолные логи в:', logFile);
          }
        }
      });

      // Детектируем мгновенное падение
      setTimeout(() => {
        try {
          // Проверяем что процесс все еще жив
          process.kill(gameProcess.pid, 0);
          console.log('✓ Процесс стабилен (работает более 2 секунд)');
        } catch (e) {
          console.error('\n⚠️  ПРОЦЕСС УПАЛ В ПЕРВЫЕ 2 СЕКУНДЫ!');
          console.error('Проверьте логи:', logFile);
        }
      }, 2000);

      console.log('✓ Процесс запущен с PID:', gameProcess.pid);
      callback(null, gameProcess);
    } catch (error) {
      callback(new Error(`Ошибка при подготовке запуска: ${error.message}`));
    }
  }
}

module.exports = MinecraftLauncher;
