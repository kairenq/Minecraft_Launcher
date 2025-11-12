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

      // Нативные библиотеки
      if (allowed && lib.downloads && lib.downloads.classifiers && lib.natives) {
        const nativeKey = lib.natives[osName];
        if (nativeKey && lib.downloads.classifiers[nativeKey]) {
          const nativePath = path.join(this.librariesDir, lib.downloads.classifiers[nativeKey].path);
          if (fs.existsSync(nativePath)) {
            libraries.push(nativePath);
          }
        }
      }
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

      const separator = process.platform === 'win32' ? ';' : ':';

      // ВАЖНО: spawn() передает аргументы напрямую процессу без shell,
      // поэтому мы НЕ должны добавлять кавычки сами - spawn() обработает это автоматически
      // Просто соединяем пути разделителем
      const classpath = libraries.join(separator);

      console.log('Библиотек в classpath:', libraries.length);
      console.log('Пример первой библиотеки:', libraries[0]);

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

      // Полная команда
      const allArgs = [...jvmArgs, mainClass, ...gameArgs];

      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА ===');
      console.log('Аргументов JVM:', jvmArgs.length);
      console.log('Аргументов игры:', gameArgs.length);
      console.log('RAM выделено:', memory, 'MB');
      console.log('Первые JVM аргументы:', jvmArgs.slice(0, 3).join(' '));
      console.log('\nЗапуск процесса Java...\n');

      // Создаем файл для логов
      const logsDir = path.join(gameDir, 'logs');
      await fs.ensureDir(logsDir);
      const logFile = path.join(logsDir, 'launcher.log');
      const logStream = fs.createWriteStream(logFile, { flags: 'a' });

      // Записываем команду запуска в лог
      logStream.write('\n' + '='.repeat(80) + '\n');
      logStream.write(`ЗАПУСК: ${new Date().toISOString()}\n`);
      logStream.write(`Версия: ${version}\n`);
      logStream.write(`Пользователь: ${username}\n`);
      logStream.write(`RAM: ${memory} MB\n`);
      logStream.write(`Java: ${javaPath}\n`);
      logStream.write(`GameDir: ${gameDir}\n`);
      logStream.write('\nПОЛНАЯ КОМАНДА:\n');
      logStream.write(`"${javaPath}" ${allArgs.join(' ')}\n`);
      logStream.write('='.repeat(80) + '\n\n');

      console.log('\n💾 Логи записываются в:', logFile);
      console.log('\n📋 ПОЛНАЯ КОМАНДА ЗАПУСКА (для ручной проверки):');
      console.log(`"${javaPath}" ${allArgs.slice(0, 10).join(' ')} ...`);
      console.log('(полная команда записана в лог-файл)\n');

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
