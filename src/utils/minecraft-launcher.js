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

      // Определение ОС
      const osName = process.platform === 'win32' ? 'windows' :
                     process.platform === 'darwin' ? 'osx' : 'linux';

      // Загрузка данных версии
      const versionJsonPath = path.join(this.versionsDir, version, `${version}.json`);
      const versionData = await fs.readJson(versionJsonPath);

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
      const classpath = libraries.join(separator);

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

      console.log('Запуск Minecraft...');
      console.log('Java:', javaPath);
      console.log('Версия:', version);
      console.log('Пользователь:', username);
      console.log('Память:', memory, 'MB');

      // Запуск процесса
      const gameProcess = spawn(javaPath, allArgs, {
        cwd: gameDir,
        stdio: 'inherit'
      });

      gameProcess.on('error', (error) => {
        callback(new Error(`Ошибка запуска: ${error.message}`));
      });

      gameProcess.on('close', (code) => {
        console.log(`Minecraft завершён с кодом ${code}`);
      });

      callback(null, gameProcess);
    } catch (error) {
      callback(new Error(`Ошибка при подготовке запуска: ${error.message}`));
    }
  }
}

module.exports = MinecraftLauncher;
