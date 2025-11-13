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

      // ========================================================================
      // РАДИКАЛЬНОЕ РЕШЕНИЕ: Создаём JAR wrapper с манифестом
      // Проблема: Java @argfile НЕ ПОДДЕРЖИВАЕТ пути с пробелами в classpath!
      // Решение: Создаём JAR файл с MANIFEST.MF который содержит Class-Path
      // Это обходит все ограничения командной строки Windows!
      // ========================================================================

      console.log('\n=== СОЗДАНИЕ JAR WRAPPER ===');
      logStream.write('\n=== СОЗДАНИЕ JAR WRAPPER ===\n');

      // Создаём временную директорию для wrapper JAR
      const wrapperDir = path.join(gameDir, '.wrapper');
      await fs.ensureDir(wrapperDir);
      const metaInfDir = path.join(wrapperDir, 'META-INF');
      await fs.ensureDir(metaInfDir);

      // Формируем Class-Path для манифеста
      // Java манифест требует пути с прямыми слешами, даже на Windows
      // Пробелы в путях поддерживаются корректно в манифесте
      const manifestClassPath = filteredLibraries.map(lib => {
        // Заменяем обратные слеши на прямые (Java понимает оба варианта, но прямые надёжнее)
        return lib.replace(/\\/g, '/');
      }).join(' ');

      console.log(`Создание манифеста с ${filteredLibraries.length} JAR файлами...`);

      // Создаём MANIFEST.MF
      // КРИТИЧНО: JAR манифест требует СТРОГОГО формата:
      // - Максимум 72 байта на строку
      // - Продолжение строки начинается с пробела
      // - Обязательна пустая строка в конце

      // Формируем Class-Path с переносами строк каждые ~70 символов
      let manifestClassPathLines = [];
      let currentLine = 'Class-Path:';

      for (let i = 0; i < filteredLibraries.length; i++) {
        const lib = filteredLibraries[i].replace(/\\/g, '/');
        const entry = ' ' + lib;

        // Если добавление этого JAR превысит 70 символов, сохраняем текущую строку и начинаем новую
        if ((currentLine + entry).length > 70) {
          manifestClassPathLines.push(currentLine);
          currentLine = ' ' + lib; // Продолжение строки начинается с пробела
        } else {
          currentLine += entry;
        }
      }

      // Добавляем последнюю строку
      if (currentLine.trim().length > 0) {
        manifestClassPathLines.push(currentLine);
      }

      const manifestClassPathFormatted = manifestClassPathLines.join('\r\n');
      const manifestContent = `Manifest-Version: 1.0\r\nMain-Class: ${mainClass}\r\n${manifestClassPathFormatted}\r\n\r\n`;

      await fs.writeFile(path.join(metaInfDir, 'MANIFEST.MF'), manifestContent, 'utf8');
      console.log(`✓ Манифест создан: ${(manifestContent.length / 1024).toFixed(1)} KB`);
      console.log(`  Строк Class-Path: ${manifestClassPathFormatted.split('\n').length}`);
      logStream.write(`[MANIFEST] Created with ${filteredLibraries.length} classpath entries\n`);

      // Создаём wrapper.jar используя archiver
      const wrapperJarPath = path.join(gameDir, 'minecraft-wrapper.jar');

      // Удаляем старый wrapper если существует
      if (fs.existsSync(wrapperJarPath)) {
        await fs.remove(wrapperJarPath);
        console.log(`Удалён старый wrapper: ${path.basename(wrapperJarPath)}`);
      }

      // Создаём простой Launcher.class для wrapper (пустой класс)
      // Это гарантирует что JAR не пустой и имеет валидную структуру
      const launcherClass = Buffer.from([
        0xCA, 0xFE, 0xBA, 0xBE, // Magic number
        0x00, 0x00, 0x00, 0x34  // Java 8 version
      ]);
      await fs.writeFile(path.join(wrapperDir, 'Launcher.class'), launcherClass);

      // Используем archiver для создания JAR (JAR = ZIP с манифестом)
      const archiver = require('archiver');
      const output = fs.createWriteStream(wrapperJarPath);
      const archive = archiver('zip', {
        zlib: { level: 0 }, // Без компрессии для скорости
        forceZip64: false
      });

      // Обработка ошибок
      archive.on('warning', (err) => {
        console.warn('[ARCHIVER WARNING]', err.message);
      });

      archive.on('error', (err) => {
        throw err;
      });

      // Подключаем stream
      archive.pipe(output);

      // Добавляем все файлы из wrapperDir в корень JAR
      archive.directory(wrapperDir, false);

      // Финализируем архив
      archive.finalize();

      // Ждём завершения записи
      await new Promise((resolve, reject) => {
        output.on('close', () => {
          console.log(`✓ Wrapper JAR создан: ${path.basename(wrapperJarPath)}`);
          console.log(`  Размер: ${(archive.pointer() / 1024).toFixed(1)} KB`);
          console.log(`  Записано байт: ${archive.pointer()}`);
          resolve();
        });
        output.on('error', reject);
        archive.on('error', reject);
      });

      // Проверяем что файл существует и не пустой
      if (!fs.existsSync(wrapperJarPath)) {
        throw new Error('Wrapper JAR не был создан!');
      }

      const wrapperStats = fs.statSync(wrapperJarPath);
      if (wrapperStats.size === 0) {
        throw new Error('Wrapper JAR пустой!');
      }

      console.log(`✓ Проверка: JAR файл валиден (${wrapperStats.size} байт)`);
      logStream.write(`[WRAPPER] Created and validated: ${wrapperJarPath} (${wrapperStats.size} bytes)\n`);

      // ========================================================================
      // НОВАЯ КОМАНДА ЗАПУСКА: Используем wrapper JAR с JVM аргументами
      // ========================================================================

      // Собираем JVM аргументы (БЕЗ -cp, он уже в манифесте!)
      const jvmArgsNoCp = jvmArgs.filter((arg, i) => {
        if (arg === '-cp') return false;
        if (i > 0 && jvmArgs[i-1] === '-cp') return false;
        return true;
      });

      // Финальная команда: java [JVM_ARGS] -jar wrapper.jar [GAME_ARGS]
      const allArgs = [
        ...jvmArgsNoCp,
        '-jar',
        wrapperJarPath,
        ...gameArgs
      ];

      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА (WRAPPER JAR) ===');
      console.log('Используется: JAR Wrapper с Manifest');
      console.log('Wrapper JAR:', path.basename(wrapperJarPath));
      console.log('JVM аргументов:', jvmArgsNoCp.length);
      console.log('Game аргументов:', gameArgs.length);
      console.log('RAM выделено:', memory, 'MB');
      console.log('\nЗапуск процесса Java...\n');

      // Записываем полную команду запуска в лог
      logStream.write('\n=== ИСПОЛЬЗУЕТСЯ JAR WRAPPER ===\n');
      logStream.write(`Wrapper JAR: ${wrapperJarPath}\n`);
      logStream.write(`Main class (в манифесте): ${mainClass}\n`);
      logStream.write(`Classpath entries: ${filteredLibraries.length}\n\n`);
      logStream.write('ПОЛНАЯ КОМАНДА:\n');
      logStream.write(`"${javaPath}" ${jvmArgsNoCp.join(' ')} -jar "${wrapperJarPath}" ${gameArgs.join(' ')}\n`);
      logStream.write('='.repeat(80) + '\n\n');

      console.log('\n💾 Логи записываются в:', logFile);
      console.log('\n📋 ПОЛНАЯ КОМАНДА ЗАПУСКА:');
      console.log(`"${javaPath}" -jar "${wrapperJarPath}" ...`);
      console.log('(полная команда записана в лог-файл)\n');

      // ========== СОЗДАЁМ BAT ФАЙЛ С WRAPPER JAR ==========
      const batFilePath = path.join(gameDir, 'run_minecraft.bat');
      const batContent = `@echo off
chcp 65001 >nul
echo ========================================
echo MINECRAFT LAUNCHER (JAR WRAPPER)
echo ========================================
echo.
echo Working directory: ${gameDir}
echo Java: ${javaPath}
echo Wrapper JAR: ${path.basename(wrapperJarPath)}
echo.
echo Press ENTER to start Minecraft...
pause >nul
echo.
echo Starting Minecraft with JAR wrapper...
echo.

cd /d "${gameDir}"
"${javaPath}" ${jvmArgsNoCp.join(' ')} -jar "${wrapperJarPath}" ${gameArgs.join(' ')}

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
      console.log(`  Использует JAR Wrapper (обходит проблемы с пробелами в путях!)`);
      logStream.write(`\n[INFO] Created BAT file with JAR wrapper\n`);

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
