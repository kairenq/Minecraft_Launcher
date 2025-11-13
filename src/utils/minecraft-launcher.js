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
      const { version, username, memory, javaPath, gameDir } = options;

      console.log('\n=== ЗАПУСК MINECRAFT ===');
      console.log('Версия:', version);
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

      // Загрузка данных версии
      const versionJsonPath = path.join(this.versionsDir, version, `${version}.json`);

      if (!fs.existsSync(versionJsonPath)) {
        const error = `Файл версии не найден: ${versionJsonPath}.\nПереустановите сборку.`;
        console.error(error);
        throw new Error(error);
      }

      const versionJarPath = path.join(this.versionsDir, version, `${version}.jar`);
      if (!fs.existsSync(versionJarPath)) {
        const error = `JAR файл игры не найден: ${versionJarPath}.\nПереустановите сборку.`;
        console.error(error);
        throw new Error(error);
      }

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
      for (const lib of versionData.libraries) {
        if (lib.downloads && lib.downloads.classifiers && lib.natives) {
          const nativeKey = lib.natives[osName];
          if (nativeKey && lib.downloads.classifiers[nativeKey]) {
            const nativePath = path.join(this.librariesDir, lib.downloads.classifiers[nativeKey].path);
            if (fs.existsSync(nativePath)) {
              const StreamZip = require('node-stream-zip');
              const zip = new StreamZip({ file: nativePath, storeEntries: true });

              await new Promise((resolve, reject) => {
                zip.on('ready', () => {
                  zip.extract(null, nativesDir, (err) => {
                    zip.close();
                    if (err) reject(err);
                    else resolve();
                  });
                });
                zip.on('error', reject);
              });
            }
          }
        }
      }

      // Построение classpath
      const libraries = await this.buildClasspath(versionData, osName);
      const versionJar = path.join(this.versionsDir, version, `${version}.jar`);
      libraries.push(versionJar);

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
          }
        }
      } else if (versionData.minecraftArguments) {
        // Старый формат
        const args = versionData.minecraftArguments.split(' ');
        args.forEach(arg => gameArgs.push(this.replaceVariables(arg, variables)));
      }

      // Главный класс
      const mainClass = versionData.mainClass;

      // ВАЖНО: На Windows с длинным classpath используем @argfile для передачи аргументов
      // Это решает проблему с путями содержащими пробелы и длинной командной строкой
      const argsFilePath = path.join(gameDir, 'jvm_args.txt');

      // Формируем содержимое файла аргументов
      // Каждый аргумент на отдельной строке
      // Для аргументов с пробелами используем кавычки
      const argsFileContent = jvmArgs.map((arg, index) => {
        // КРИТИЧНО: Classpath (строка с ; разделителями) НЕ оборачиваем в кавычки!
        // В argfile Java сам правильно парсит пути, кавычки могут сломать парсинг
        // Проверяем: если предыдущий аргумент был -cp, то текущий - это classpath
        if (index > 0 && jvmArgs[index - 1] === '-cp') {
          console.log(`[DEBUG] Classpath detected at index ${index}, NOT quoting`);
          logStream.write(`[ARGFILE] Classpath (unquoted): ${arg.substring(0, 100)}...\n`);
          return arg; // Возвращаем БЕЗ кавычек, даже если содержит пробелы!
        }

        // Если аргумент содержит пробелы, оборачиваем в кавычки
        if (arg.includes(' ')) {
          // Для аргументов вида -Dkey=value где value содержит пробелы
          if (arg.startsWith('-D') && arg.includes('=')) {
            const eqIndex = arg.indexOf('=');
            const key = arg.substring(0, eqIndex + 1);
            const value = arg.substring(eqIndex + 1);
            return `${key}"${value}"`;
          }
          // Для остальных просто оборачиваем весь аргумент
          return `"${arg}"`;
        }

        // Возвращаем как есть
        return arg;
      }).join('\n');

      await fs.writeFile(argsFilePath, argsFileContent, 'utf8');
      console.log(`✓ Аргументы JVM записаны в файл: ${argsFilePath}`);
      console.log(`  Размер файла: ${argsFileContent.length} байт`);

      // Проверяем client.jar и главный класс
      console.log('\n=== ПРОВЕРКА CLIENT.JAR ===');
      const clientJar = libraries[libraries.length - 1]; // Последний элемент - client.jar
      const clientJarName = path.basename(clientJar);
      console.log(`Client JAR: ${clientJarName}`);

      if (fs.existsSync(clientJar)) {
        const stats = fs.statSync(clientJar);
        console.log(`✓ Размер: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        // Попробуем проверить содержимое JAR
        try {
          const { execSync } = require('child_process');
          const jarList = execSync(`"${javaPath}" -jar "${clientJar}" --help 2>&1 || echo "Cannot run as jar"`, { encoding: 'utf8', timeout: 2000 }).substring(0, 200);
          console.log(`JAR info: ${jarList.split('\n')[0]}`);
        } catch (e) {
          console.log('(не удалось проверить JAR напрямую)');
        }
      } else {
        console.error(`❌ Client JAR не найден: ${clientJar}`);
        throw new Error(`Client JAR не найден: ${clientJar}`);
      }

      // Используем @argfile для передачи JVM аргументов
      const allArgs = [`@${argsFilePath}`, mainClass, ...gameArgs];

      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА ===');
      console.log('Аргументов JVM:', jvmArgs.length, '(в файле)');
      console.log('Аргументов игры:', gameArgs.length);
      console.log('RAM выделено:', memory, 'MB');
      console.log('Используется @argfile:', argsFilePath);
      console.log('\nЗапуск процесса Java...\n');

      // Записываем полную команду запуска в лог
      logStream.write('\nИСПОЛЬЗУЕТСЯ @ARGFILE:\n');
      logStream.write(`Файл аргументов: ${argsFilePath}\n\n`);
      logStream.write('СОДЕРЖИМОЕ ARGFILE:\n');
      logStream.write(argsFileContent + '\n\n');
      logStream.write('ПОЛНАЯ КОМАНДА:\n');
      logStream.write(`"${javaPath}" @${argsFilePath} ${mainClass} ${gameArgs.join(' ')}\n`);
      logStream.write('='.repeat(80) + '\n\n');

      console.log('\n💾 Логи записываются в:', logFile);
      console.log('\n📋 ПОЛНАЯ КОМАНДА ЗАПУСКА (для ручной проверки):');
      console.log(`"${javaPath}" ${allArgs.slice(0, 10).join(' ')} ...`);
      console.log('(полная команда записана в лог-файл)\n');

      // ========== СОЗДАЁМ .BAT ФАЙЛ ДЛЯ РУЧНОЙ ОТЛАДКИ ==========
      const batFilePath = path.join(gameDir, 'run_minecraft.bat');
      const batContent = `@echo off
chcp 65001 >nul
echo ========================================
echo MINECRAFT LAUNCHER - MANUAL DEBUG
echo ========================================
echo.
echo Working directory: ${gameDir}
echo Java: ${javaPath}
echo Argfile: ${argsFilePath}
echo.
echo Press ENTER to start Minecraft...
pause >nul
echo.
echo Starting Minecraft with @argfile...
echo.

cd /d "${gameDir}"
"${javaPath}" @"${argsFilePath}" ${mainClass} ${gameArgs.join(' ')}

echo.
echo ========================================
echo Exit code: %ERRORLEVEL%
echo ========================================
echo.
echo Press any key to close...
pause >nul
`;

      await fs.writeFile(batFilePath, batContent, 'utf8');

      // ========== СОЗДАЁМ ВТОРОЙ BAT БЕЗ ARGFILE ==========
      const batFilePath2 = path.join(gameDir, 'run_minecraft_direct.bat');
      const classpathForBat = filteredLibraries.join(';');

      // Создаем jvmArgs без -cp и classpath
      const jvmArgsNoCp = jvmArgs.filter((arg, i) => {
        if (arg === '-cp') return false;
        if (i > 0 && jvmArgs[i-1] === '-cp') return false;
        return true;
      });

      const batContent2 = `@echo off
chcp 65001 >nul
echo ========================================
echo DIRECT RUN (БЕЗ @argfile)
echo ========================================
echo.

cd /d "${gameDir}"

"${javaPath}" ${jvmArgsNoCp.join(' ')} -cp "${classpathForBat}" ${mainClass} ${gameArgs.join(' ')}

echo.
echo ========================================
echo Exit code: %ERRORLEVEL%
echo ========================================
pause
`;

      await fs.writeFile(batFilePath2, batContent2, 'utf8');

      console.log(`\n✓ Создано 2 BAT файла:`);
      console.log(`  1) ${batFilePath} (@argfile)`);
      console.log(`  2) ${batFilePath2} (ПРЯМОЙ запуск БЕЗ argfile!)`);
      console.log(`\n  ⚠️  Попробуй запустить ВТОРОЙ файл!`);
      logStream.write(`\n[INFO] Created 2 BAT files for testing\n`);

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
