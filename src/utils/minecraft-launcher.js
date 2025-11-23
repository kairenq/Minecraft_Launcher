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

      if (allowed) {
        let libPath = null;

        // Способ 1: Есть downloads.artifact (стандарт Mojang)
        if (lib.downloads && lib.downloads.artifact) {
          // Конвертируем Unix-style путь в platform-specific
          const normalizedPath = lib.downloads.artifact.path.split('/').join(path.sep);
          libPath = path.join(this.librariesDir, normalizedPath);
        }
        // Способ 2: Только name (Forge/Fabric библиотеки)
        else if (lib.name) {
          // Формат: "group:artifact:version"
          // Пример: "cpw.mods:bootstraplauncher:1.0.0"
          // Путь: "cpw/mods/bootstraplauncher/1.0.0/bootstraplauncher-1.0.0.jar"
          const parts = lib.name.split(':');
          if (parts.length >= 3) {
            const [group, artifact, version] = parts;
            const groupPath = group.replace(/\./g, '/');
            const fileName = `${artifact}-${version}.jar`;
            libPath = path.join(this.librariesDir, groupPath, artifact, version, fileName);
          }
        }

        if (libPath && fs.existsSync(libPath)) {
          // Не добавляем natives в classpath
          const libName = path.basename(libPath);
          if (!libName.includes('-natives-')) {
            libraries.push(libPath);
          }
        } else if (libPath) {
          console.warn(`⚠️  Библиотека не найдена: ${lib.name || 'unknown'}`);
          console.warn(`   Ожидаемый путь: ${libPath}`);
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

  async checkAndDownloadCriticalLibraries(versionData, logStream) {
    console.log('\n=== ПРОВЕРКА КРИТИЧНЫХ БИБЛИОТЕК FORGE ===');
    logStream.write('\n=== ПРОВЕРКА КРИТИЧНЫХ БИБЛИОТЕК FORGE ===\n');

    const axios = require('axios');
    const missingLibs = [];

    // Извлекаем версию Forge из versionData.id (например, "1.18.2-forge-40.3.0")
    const versionId = versionData.id || '';
    const forgeMatch = versionId.match(/forge-(.+)/);
    if (!forgeMatch) {
      console.log('⚠️  Не удалось определить версию Forge из versionId');
      logStream.write('[CHECK] Cannot determine Forge version\n\n');
      return;
    }

    const forgeVersion = forgeMatch[1]; // например "40.3.0"
    const mcVersionMatch = versionId.match(/^([0-9.]+)-/);
    const mcVersion = mcVersionMatch ? mcVersionMatch[1] : '';
    const fullForgeVersion = `${mcVersion}-${forgeVersion}`;

    console.log(`[FORGE] Версия: ${fullForgeVersion}`);
    logStream.write(`[FORGE] Version: ${fullForgeVersion}\n`);

    // ДЕБАГ: Версия кода для проверки
    console.log('[DEBUG] minecraft-launcher.js version: 2025-11-21-LWJGL-FIX');
    logStream.write('[DEBUG] Code version: 2025-11-21-LWJGL-FIX\n');

    // Жестко закодированные критичные библиотеки Forge (НЕ включены в version JSON!)
    // Эти библиотеки являются частью внутренних модулей Forge и загружаются динамически
    const hardcodedCriticalLibs = [
      {
        name: `net.minecraftforge:forge:${fullForgeVersion}:universal`,
        artifact: 'forge',
        group: 'net.minecraftforge',
        classifier: 'universal'
      },
      {
        name: `net.minecraftforge:fmlcore:${fullForgeVersion}`,
        artifact: 'fmlcore',
        group: 'net.minecraftforge'
      },
      {
        name: `net.minecraftforge:javafmllanguage:${fullForgeVersion}`,
        artifact: 'javafmllanguage',
        group: 'net.minecraftforge'
      },
      {
        name: `net.minecraftforge:lowcodelanguage:${fullForgeVersion}`,
        artifact: 'lowcodelanguage',
        group: 'net.minecraftforge'
      },
      {
        name: `net.minecraftforge:mclanguage:${fullForgeVersion}`,
        artifact: 'mclanguage',
        group: 'net.minecraftforge'
      },
      // LWJGL 3.2.2 - критичные библиотеки для Minecraft 1.18.2
      {
        name: 'org.lwjgl:lwjgl:3.2.2',
        artifact: 'lwjgl',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      },
      {
        name: 'org.lwjgl:lwjgl-jemalloc:3.2.2',
        artifact: 'lwjgl-jemalloc',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      },
      {
        name: 'org.lwjgl:lwjgl-openal:3.2.2',
        artifact: 'lwjgl-openal',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      },
      {
        name: 'org.lwjgl:lwjgl-opengl:3.2.2',
        artifact: 'lwjgl-opengl',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      },
      {
        name: 'org.lwjgl:lwjgl-glfw:3.2.2',
        artifact: 'lwjgl-glfw',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      },
      {
        name: 'org.lwjgl:lwjgl-stb:3.2.2',
        artifact: 'lwjgl-stb',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      },
      {
        name: 'org.lwjgl:lwjgl-tinyfd:3.2.2',
        artifact: 'lwjgl-tinyfd',
        group: 'org.lwjgl',
        version: '3.2.2',
        baseUrl: 'https://repo1.maven.org/maven2/'
      }
    ];

    // ДЕБАГ: Печатаем количество библиотек для проверки
    console.log(`[DEBUG] Checking ${hardcodedCriticalLibs.length} critical libraries (5 Forge + 7 LWJGL)`);
    logStream.write(`[DEBUG] Total libraries to check: ${hardcodedCriticalLibs.length}\n`);

    // Проверяем жестко закодированные критичные библиотеки
    for (const lib of hardcodedCriticalLibs) {
      const groupPath = lib.group.replace(/\./g, path.sep);
      const libVersion = lib.version || fullForgeVersion; // LWJGL имеет свою версию
      const fileName = lib.classifier
        ? `${lib.artifact}-${libVersion}-${lib.classifier}.jar`
        : `${lib.artifact}-${libVersion}.jar`;
      const libPath = path.join(this.librariesDir, groupPath, lib.artifact, libVersion, fileName);

      // ДЕБАГ: Логируем каждую проверку
      console.log(`[DEBUG] Checking: ${lib.name} at ${libPath}`);

      if (!fs.existsSync(libPath)) {
        console.log(`❌ Отсутствует критичная библиотека: ${lib.name}`);
        logStream.write(`[CRITICAL] Missing: ${lib.name}\n`);
        missingLibs.push({ lib, libPath, libVersion });
      } else {
        console.log(`✓ ${lib.name}`);
      }
    }

    // Если есть недостающие критичные библиотеки - загружаем
    if (missingLibs.length > 0) {
      console.log(`\n⚠️  Обнаружено ${missingLibs.length} недостающих критичных библиотек`);
      console.log('Автоматическая загрузка...\n');
      logStream.write(`\n[AUTO-REPAIR] Downloading ${missingLibs.length} missing critical libraries\n`);

      for (const { lib, libPath, libVersion } of missingLibs) {
        const libName = lib.name;
        console.log(`Загрузка: ${libName}...`);

        // Строим URL для загрузки критичных библиотек
        const groupPath = lib.group.replace(/\./g, '/');
        const fileName = lib.classifier
          ? `${lib.artifact}-${libVersion}-${lib.classifier}.jar`
          : `${lib.artifact}-${libVersion}.jar`;
        // LWJGL используется из Maven Central, Forge - из maven.minecraftforge.net
        const baseUrl = lib.baseUrl || 'https://maven.minecraftforge.net/';
        const downloadUrl = `${baseUrl}${groupPath}/${lib.artifact}/${libVersion}/${fileName}`;

        console.log(`  URL: ${downloadUrl}`);
        logStream.write(`[AUTO-REPAIR] URL: ${downloadUrl}\n`);

        // Создаём директорию
        await fs.ensureDir(path.dirname(libPath));

        // Загружаем с retry
        let success = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            console.log(`  Попытка ${attempt + 1}/5: ${downloadUrl}`);
            const response = await axios({
              url: downloadUrl,
              method: 'GET',
              responseType: 'stream',
              timeout: 60000
            });

            const writer = fs.createWriteStream(libPath);
            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
              response.data.pipe(writer);
            });

            console.log(`  ✓ Успешно загружено: ${libName}`);
            logStream.write(`[AUTO-REPAIR] Downloaded: ${libName}\n`);
            success = true;
            break;
          } catch (err) {
            console.warn(`  Попытка ${attempt + 1}/5 не удалась: ${err.message}`);
            if (attempt < 4) {
              const delay = 2000 * (attempt + 1);
              console.log(`  Повтор через ${delay/1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        if (!success) {
          const error = `Не удалось загрузить критичную библиотеку ${libName} после 5 попыток.\nURL: ${downloadUrl}\n\nПопробуйте переустановить сборку.`;
          console.error(`\n❌ ${error}`);
          logStream.write(`[AUTO-REPAIR] FAILED: ${error}\n`);
          throw new Error(error);
        }
      }

      console.log(`\n✓ Все критичные библиотеки восстановлены!\n`);
      logStream.write(`[AUTO-REPAIR] All critical libraries restored\n\n`);
    } else {
      console.log('✓ Все критичные библиотеки на месте\n');
      logStream.write('[CHECK] All critical libraries present\n\n');
    }
  }

  async launch(options, callback) {
    try {
      const { version, username, memory, javaPath, gameDir, modLoader, modLoaderVersion } = options;

      // Создаём лог-файл СРАЗУ, чтобы логировать все операции
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

      console.log('\n=== ЗАПУСК MINECRAFT ===');
      console.log('Версия:', version);
      console.log('Модлоадер:', modLoader || 'не указан (undefined)');
      if (modLoaderVersion) console.log('Версия модлоадера:', modLoaderVersion);
      console.log('Пользователь:', username);
      console.log('Память (RAM):', memory, 'MB');
      console.log('Java путь:', javaPath);
      console.log('Директория игры:', gameDir);
      console.log('DEBUG: modLoader type:', typeof modLoader, ', value:', modLoader);

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
      } else if (!modLoader && version.includes('forge')) {
        // Если modLoader не указан, но version содержит 'forge' - автоопределение
        console.log('⚠️  modLoader не указан, но версия содержит "forge" - автоопределение');
        versionId = version;
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

          // ЛОГИРОВАНИЕ: что в Forge профиле ДО объединения
          console.log('\n>>> DEBUG: Forge профиль ДО объединения:');
          console.log(`  - libraries: ${versionData.libraries ? versionData.libraries.length : 'НЕТ'}`);
          console.log(`  - arguments.jvm: ${versionData.arguments && versionData.arguments.jvm ? versionData.arguments.jvm.length : 'НЕТ'}`);
          console.log(`  - arguments.game: ${versionData.arguments && versionData.arguments.game ? versionData.arguments.game.length : 'НЕТ'}`);

          // Показываем первые 3 Forge JVM arguments если есть
          if (versionData.arguments && versionData.arguments.jvm && versionData.arguments.jvm.length > 0) {
            console.log('  Первые 3 Forge JVM arguments:');
            versionData.arguments.jvm.slice(0, 3).forEach((arg, i) => {
              console.log(`    [${i}] ${typeof arg === 'string' ? arg : JSON.stringify(arg).substring(0, 100)}`);
            });
          }

          // Объединяем библиотеки: сначала базовые, потом Forge/Fabric
          const baseLibraries = baseVersionData.libraries || [];
          const modLoaderLibraries = versionData.libraries || [];

          versionData.libraries = [...baseLibraries, ...modLoaderLibraries];

          console.log(`\nБиблиотек из базы: ${baseLibraries.length}`);
          console.log(`Библиотек ${modLoader}: ${modLoaderLibraries.length}`);
          console.log(`Всего библиотек: ${versionData.libraries.length}`);

          // Наследуем assetIndex если его нет
          if (!versionData.assetIndex && baseVersionData.assetIndex) {
            versionData.assetIndex = baseVersionData.assetIndex;
            console.log('✓ Унаследован assetIndex:', versionData.assetIndex.id);
          }

          // Наследуем другие поля если нужно
          if (!versionData.assets && baseVersionData.assets) {
            versionData.assets = baseVersionData.assets;
          }

          // КРИТИЧНО: Объединяем JVM arguments из базы и Forge
          if (baseVersionData.arguments && baseVersionData.arguments.jvm) {
            if (!versionData.arguments) {
              versionData.arguments = {};
            }
            if (!versionData.arguments.jvm) {
              versionData.arguments.jvm = [];
            }

            // Сначала базовые JVM args, потом Forge
            const baseJvmArgs = baseVersionData.arguments.jvm || [];
            const forgeJvmArgs = versionData.arguments.jvm || [];

            versionData.arguments.jvm = [...baseJvmArgs, ...forgeJvmArgs];

            console.log(`JVM arguments из базы: ${baseJvmArgs.length}`);
            console.log(`JVM arguments ${modLoader}: ${forgeJvmArgs.length}`);
            console.log(`Всего JVM arguments: ${versionData.arguments.jvm.length}`);
          }

          // Объединяем game arguments тоже
          if (baseVersionData.arguments && baseVersionData.arguments.game) {
            if (!versionData.arguments.game) {
              versionData.arguments.game = [];
            }

            const baseGameArgs = baseVersionData.arguments.game || [];
            const forgeGameArgs = versionData.arguments.game || [];

            versionData.arguments.game = [...baseGameArgs, ...forgeGameArgs];

            console.log(`Game arguments из базы: ${baseGameArgs.length}`);
            console.log(`Game arguments ${modLoader}: ${forgeGameArgs.length}`);
          }
        } else {
          console.warn(`⚠️  Базовый профиль не найден: ${baseVersionPath}`);
        }
      }

      // КРИТИЧНО: Проверяем и загружаем недостающие критичные библиотеки Forge
      if (versionId.includes('forge')) {
        await this.checkAndDownloadCriticalLibraries(versionData, logStream);
      }

      // Создание директорий
      await fs.ensureDir(gameDir);
      const nativesDir = path.join(gameDir, 'natives');
      await fs.ensureDir(nativesDir);

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

      // Добавляем JAR клиента
      if (modLoader === 'vanilla' || !modLoader) {
        // Для ванильного - используем версию напрямую
        const versionJar = path.join(this.versionsDir, version, `${version}.jar`);
        libraries.push(versionJar);
      } else if (versionData.inheritsFrom) {
        // ВАЖНО: Для Forge 1.17+ главный JAR НЕ добавляется в -cp!
        // Он будет в legacyClassPath из win_args.txt
        // Только для старых версий Forge (<1.17) добавляем в classpath
        const isForge117Plus = versionId.includes('forge') && versionData.arguments?.jvm;

        if (!isForge117Plus) {
          // Для Forge/Fabric - используем JAR базовой версии
          const baseVersionJar = path.join(this.versionsDir, versionData.inheritsFrom, `${versionData.inheritsFrom}.jar`);
          if (fs.existsSync(baseVersionJar)) {
            libraries.push(baseVersionJar);
            console.log(`✓ Добавлен client JAR в classpath: ${versionData.inheritsFrom}.jar`);
          } else {
            console.warn(`⚠️  Client JAR не найден: ${baseVersionJar}`);
          }
        } else {
          console.log(`✓ Для Forge 1.17+ главный JAR НЕ добавляется в -cp (будет в legacyClassPath)`);
          logStream.write(`[FORGE] Main JAR excluded from -cp (will be in legacyClassPath from win_args.txt)\n`);
        }
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

      // КРИТИЧНО: Убираем дубликаты из classpath
      // Set автоматически убирает повторяющиеся пути
      const uniqueLibraries = [...new Set(filteredLibraries)];
      if (uniqueLibraries.length < filteredLibraries.length) {
        const duplicates = filteredLibraries.length - uniqueLibraries.length;
        console.log(`✓ Убрано ${duplicates} дубликатов из classpath`);
        logStream.write(`[INFO] Removed ${duplicates} duplicates from classpath\n`);
      }

      // Для Forge 1.17+: убираем модульные библиотеки из classpath
      // Они должны быть ТОЛЬКО в module path, НЕ в classpath!
      let finalLibraries = uniqueLibraries;
      if (versionId.includes('forge')) {
        const modulePathLibs = [
          // FML библиотеки (КРИТИЧНО!)
          'fmlloader',
          'fmlcore',
          'javafmllanguage',
          'lowcodelanguage',
          'mclanguage',
          // Bootstrap и вспомогательные
          'bootstraplauncher',
          'securejarhandler',
          // ASM
          'asm-9.3.jar',
          'asm-commons',
          'asm-tree',
          'asm-util',
          'asm-analysis',
          // Forge SPI
          'forgespi',
          // LWJGL (КРИТИЧНО: должен быть ТОЛЬКО в module path!)
          'lwjgl-3.2.2.jar',
          'lwjgl-jemalloc',
          'lwjgl-openal',
          'lwjgl-opengl',
          'lwjgl-glfw',
          'lwjgl-stb',
          'lwjgl-tinyfd'
          // ВАЖНО: Главный Minecraft JAR (${version}.jar) НЕ исключается из classpath!
          // Он должен быть И в classpath, И в legacyClassPath для правильной работы Forge
        ];

        finalLibraries = uniqueLibraries.filter(lib => {
          const libName = path.basename(lib);
          const isModulePath = modulePathLibs.some(moduleName => libName.includes(moduleName));
          if (isModulePath) {
            console.log(`[DEBUG] Исключено из classpath (будет в module path): ${libName}`);
            logStream.write(`[FILTER] Excluded from classpath (module path): ${libName}\n`);
          }
          return !isModulePath;
        });

        console.log(`✓ Убрано ${uniqueLibraries.length - finalLibraries.length} модульных библиотек из classpath`);
        logStream.write(`[INFO] Removed ${uniqueLibraries.length - finalLibraries.length} module libs from classpath\n`);
      }

      const separator = process.platform === 'win32' ? ';' : ':';
      const classpath = finalLibraries.join(separator);

      console.log(`✓ Финальный classpath: ${finalLibraries.length} JAR файлов (без natives, дубликатов и модульных библиотек)`);

      // Логируем финальную команду
      console.log('\n=== ФИНАЛЬНАЯ КОМАНДА ЗАПУСКА ===');
      logStream.write('\n=== ФИНАЛЬНАЯ КОМАНДА ===\n');
      console.log('Java:', javaPath);
      logStream.write(`Java: ${javaPath}\n`);

      // Генерация UUID для offline режима
      const uuid = this.generateUUID(username);

      // Определяем assetIndex (для Forge может быть не определен напрямую)
      let assetIndexName = version;
      if (versionData.assetIndex && versionData.assetIndex.id) {
        assetIndexName = versionData.assetIndex.id;
      } else if (versionData.inheritsFrom) {
        // Для Forge/Fabric - используем базовую версию как fallback
        assetIndexName = versionData.inheritsFrom;
        console.log(`⚠️  assetIndex не найден, используем inheritsFrom: ${assetIndexName}`);
      }

      // Переменные для замены
      const variables = {
        auth_player_name: username,
        version_name: versionId, // Для Forge используем полное имя профиля
        game_directory: gameDir,
        assets_root: this.assetsDir,
        assets_index_name: assetIndexName,
        auth_uuid: uuid,
        auth_access_token: uuid, // В offline режиме используем UUID как токен
        clientid: '0', // Offline режим - нет OAuth client ID
        auth_xuid: '0', // Offline режим - нет Xbox User ID
        user_type: 'legacy',
        version_type: versionData.type || 'release',
        natives_directory: nativesDir,
        launcher_name: 'aureate-launcher',
        launcher_version: '1.0.0',
        classpath: classpath,
        library_directory: this.librariesDir, // Для Forge
        classpath_separator: separator, // Для Forge
        path: separator // Разделитель путей для ОС
      };

      // JVM аргументы
      const jvmArgs = [];

      // Базовые JVM аргументы
      jvmArgs.push(`-Xmx${memory}M`);
      jvmArgs.push(`-Xms${Math.floor(memory / 2)}M`);

      console.log(`\n=== ОБРАБОТКА JVM ARGUMENTS ===`);
      console.log(`Всего JVM arguments в JSON: ${versionData.arguments && versionData.arguments.jvm ? versionData.arguments.jvm.length : 0}`);

      // Для Forge 1.17+: загружаем аргументы из win_args.txt/unix_args.txt
      // Проверяем только versionId, т.к. modLoader может не передаваться
      console.log(`\nDEBUG: Проверка Forge - versionId.includes('forge'): ${versionId.includes('forge')}`);

      console.log(`\n[DEBUG] Проверка Forge: versionId.includes('forge') = ${versionId.includes('forge')}`);
      logStream.write(`\n[FORGE_CHECK] versionId: "${versionId}"\n`);
      logStream.write(`[FORGE_CHECK] Contains 'forge': ${versionId.includes('forge')}\n`);

      // Флаг для отслеживания успешной загрузки аргументов из win_args.txt
      // Вынесен наружу чтобы использовать для пропуска arguments.jvm
      let forgeArgsLoaded = false;

      if (versionId.includes('forge')) {
        console.log('>>> FORGE 1.17+ DETECTED: Загрузка специальных JVM аргументов');
        logStream.write('\n=== FORGE 1.17+ MODE ===\n');

        // FALLBACK аргументы - используются только если win_args.txt не найден
        // win_args.txt уже содержит все необходимые аргументы
        const essentialForgeArgs = [
          '--add-opens', 'java.base/java.util.jar=cpw.mods.securejarhandler',
          '--add-opens', 'java.base/java.lang.invoke=cpw.mods.securejarhandler',
          '--add-exports', 'java.base/sun.security.util=cpw.mods.securejarhandler',
          '--add-exports', 'jdk.naming.dns/com.sun.jndi.dns=java.naming'
        ];

        // НЕ добавляем здесь - добавим как fallback только если win_args.txt не найден
        // essentialForgeArgs.forEach(arg => jvmArgs.push(arg));
        logStream.write(`[FORGE] Essential args prepared for fallback (${essentialForgeArgs.length} args)\n`);

        const argsFileName = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
        logStream.write(`[FORGE] Args file: ${argsFileName}\n`);

        // Формат пути: libraries/net/minecraftforge/forge/{version}/win_args.txt
        // Из versionId (например "1.18.2-forge-40.3.0") извлекаем "1.18.2-40.3.0"
        // Убираем "-forge-" между версией майнкрафта и версией forge
        const forgeFullVersion = versionId.replace(/-forge-/, '-');
        console.log(`>>> FORGE: Ожидаемая версия: ${forgeFullVersion}`);
        logStream.write(`[FORGE] Expected version: ${forgeFullVersion}\n`);

        const argsFilePath = path.join(this.librariesDir, 'net', 'minecraftforge', 'forge', forgeFullVersion, argsFileName);

        console.log(`>>> FORGE: Поиск файла аргументов: ${argsFilePath}`);
        logStream.write(`[FORGE] Searching for: ${argsFilePath}\n`);

        if (fs.existsSync(argsFilePath)) {
          try {
            logStream.write(`[FORGE] ✓ File exists!\n`);
            const forgeArgsContent = await fs.readFile(argsFilePath, 'utf8');
            console.log(`✓ Найден ${argsFileName}, содержимое:`);
            console.log(forgeArgsContent.substring(0, 500));
            logStream.write(`[FORGE] Content (first 500 chars):\n${forgeArgsContent.substring(0, 500)}\n`);

            // Парсим аргументы (они разделены пробелами, но пути в module path - через ; или :)
            const forgeArgsParsed = forgeArgsContent.trim().split(/\s+/);

            console.log(`\n✓ Распарсено ${forgeArgsParsed.length} Forge arguments из ${argsFileName}`);
            logStream.write(`[FORGE] Parsed ${forgeArgsParsed.length} arguments\n`);

            // win_args.txt содержит: <jvm_args> <main_class> <program_args>
            // Нам нужны только JVM args (начинаются с - или являются путями для -p)
            // Когда встречаем main class (cpw.mods... или net.minecraftforge...), останавливаемся
            let hitMainClass = false;
            let prevWasFlag = false; // Предыдущий аргумент был флагом типа -p, нужен путь

            // Добавляем Forge аргументы ПЕРЕД базовыми JVM args
            forgeArgsParsed.forEach((arg, idx) => {
              // Проверяем не дошли ли до main class или program args
              if (hitMainClass) return;

              // Main class обычно это полное имя класса (cpw.mods... или net.minecraftforge...)
              if (arg.match(/^(cpw\.mods\.|net\.minecraftforge\.|com\.mojang\.)/) && !arg.startsWith('-')) {
                hitMainClass = true;
                console.log(`[FORGE] Stopping at main class: ${arg}`);
                logStream.write(`[FORGE] Stopped parsing at main class: ${arg}\n`);
                return;
              }

              // Пропускаем program arguments (начинаются с -- но не являются JVM аргументами)
              if (arg.startsWith('--') && !arg.startsWith('--add-') && !prevWasFlag) {
                // Это program argument типа --launchTarget, --fml.forgeVersion
                hitMainClass = true;
                console.log(`[FORGE] Stopping at program arg: ${arg}`);
                logStream.write(`[FORGE] Stopped parsing at program arg: ${arg}\n`);
                return;
              }

              // Отслеживаем флаги которым нужно значение
              prevWasFlag = (arg === '-p' || arg === '-cp' || arg === '-classpath');
              // Заменяем относительные пути на абсолютные
              let processedArg = arg;

              // КРИТИЧНО: Сначала проверяем специальные -D параметры (они могут не содержать libraries/ с слешем!)
              if (arg.startsWith('-DlibraryDirectory=')) {
                const eqIndex = arg.indexOf('=');
                const paramValue = arg.substring(eqIndex + 1);
                // Если значение "libraries" (без слеша!) - заменяем на абсолютный путь
                if (paramValue === 'libraries' || paramValue === 'libraries/' || paramValue === 'libraries\\') {
                  processedArg = '-DlibraryDirectory=' + this.librariesDir;
                  console.log(`[FORGE] Fixed libraryDirectory: ${paramValue} -> ${this.librariesDir}`);
                  logStream.write(`[FORGE] Arg[${idx}] FIXED libraryDirectory: ${arg} -> ${processedArg}\n`);
                }
              }
              // Специальная обработка для -DignoreList (не конвертируем пути - это список JAR файлов)
              else if (arg.startsWith('-DignoreList=')) {
                processedArg = arg; // Оставляем как есть
              }
              // Проверяем содержит ли аргумент относительные пути libraries/
              else if (arg.includes('libraries/') || arg.includes('libraries\\')) {
                // Функция для конвертации одного пути
                const convertPath = (p) => {
                  if (p.startsWith('libraries/') || p.startsWith('libraries\\')) {
                    let relativePath = p.replace(/^libraries[\/\\]/, '');

                    // Заменяем server на client для путей Minecraft (для клиентского запуска)
                    // net/minecraft/server/... -> net/minecraft/client/...
                    // server-1.18.2-... -> client-1.18.2-...
                    if (relativePath.includes('net/minecraft/server/') || relativePath.includes('net\\minecraft\\server\\')) {
                      relativePath = relativePath.replace(/net[\/\\]minecraft[\/\\]server[\/\\]/g, 'net/minecraft/client/');
                      relativePath = relativePath.replace(/server-(\d+\.\d+(?:\.\d+)?-)/g, 'client-$1');
                      console.log(`[PATH] Converted server->client: ${p} -> libraries/${relativePath}`);
                    }

                    const normalizedPath = relativePath.split('/').join(path.sep);
                    return path.join(this.librariesDir, normalizedPath);
                  }
                  return p;
                };

                // Проверяем это -D параметр с путями (например -DlegacyClassPath=...)
                if (arg.includes('=')) {
                  const eqIndex = arg.indexOf('=');
                  const paramName = arg.substring(0, eqIndex + 1); // включая =
                  const paramValue = arg.substring(eqIndex + 1);

                  // Обычная обработка путей для -D параметров с libraries/
                  if (paramValue.includes(';') || paramValue.includes(':')) {
                    const separator = paramValue.includes(';') ? ';' : ':';
                    const paths = paramValue.split(separator);
                    const convertedPaths = paths.map(convertPath);
                    processedArg = paramName + convertedPaths.join(path.delimiter);
                    logStream.write(`[FORGE] Arg[${idx}] converted (-D param): ${arg.substring(0, 100)}... -> ${processedArg.substring(0, 100)}...\n`);
                  } else {
                    processedArg = paramName + convertPath(paramValue);
                    logStream.write(`[FORGE] Arg[${idx}] converted (-D param): ${arg.substring(0, 100)}... -> ${processedArg.substring(0, 100)}...\n`);
                  }
                }
                // Обычный аргумент начинающийся с libraries/
                else if (arg.startsWith('libraries/') || arg.startsWith('libraries\\')) {
                  if (arg.includes(';') || arg.includes(':')) {
                    const separator = arg.includes(';') ? ';' : ':';
                    const paths = arg.split(separator);
                    const convertedPaths = paths.map(convertPath);
                    processedArg = convertedPaths.join(path.delimiter);
                  } else {
                    processedArg = convertPath(arg);
                  }
                  logStream.write(`[FORGE] Arg[${idx}] converted (multiple paths): ${arg.substring(0, 200)}... -> ${processedArg.substring(0, 200)}...\n`);
                }
              }
              jvmArgs.push(processedArg);
            });

            console.log(`✓ Добавлено ${forgeArgsParsed.length} Forge JVM arguments из ${argsFileName}`);
            logStream.write(`[FORGE] ✓ Added ${forgeArgsParsed.length} JVM arguments from ${argsFileName}\n`);
            forgeArgsLoaded = true; // Успешно загрузили из win_args.txt

            // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Добавляем LWJGL в module path
            // Embeddium пытается использовать org.lwjgl.system.Platform на ранней стадии загрузки
            // ВАЖНО: Главный Minecraft JAR добавляется через --patch-module (не в module path напрямую!)
            const modulepathIndex = jvmArgs.findIndex(arg => arg === '-p');
            if (modulepathIndex !== -1 && jvmArgs[modulepathIndex + 1]) {
              console.log('\n>>> FORGE: Исправление module path для совместимости с Embeddium/Sodium...');
              logStream.write('[FORGE] Adding LWJGL to module path...\n');

              // Находим все LWJGL библиотеки в classpath (ВАЖНО: убираем дубликаты через Set!)
              const uniqueLwjglLibs = [...new Set(libraries)].filter(lib => {
                const libName = path.basename(lib);
                return libName.startsWith('lwjgl-') && !libName.includes('-natives-');
              });
              const lwjglLibs = uniqueLwjglLibs;

              if (lwjglLibs.length > 0) {
                console.log(`✓ Найдено ${lwjglLibs.length} LWJGL библиотек для добавления в module path`);
                logStream.write(`[FORGE] Found ${lwjglLibs.length} LWJGL libraries\n`);

                // Добавляем LWJGL библиотеки к существующему module path
                const currentModulePath = jvmArgs[modulepathIndex + 1];
                const lwjglPaths = lwjglLibs.join(separator);
                jvmArgs[modulepathIndex + 1] = currentModulePath + separator + lwjglPaths;

                console.log(`✓ Добавлено ${lwjglLibs.length} LWJGL библиотек в module path`);
                lwjglLibs.forEach(lib => console.log(`  - ${path.basename(lib)}`));
                logStream.write(`[FORGE] ✓ Added ${lwjglLibs.length} LWJGL libs to module path\n`);
              }
            }

            // КРИТИЧЕСКИ ВАЖНО: Проверяем содержит ли legacyClassPath главный Minecraft JAR
            // win_args.txt может НЕ содержать его - официальный лаунчер добавляет отдельно!
            console.log('\n>>> FORGE: Проверка legacyClassPath...');
            logStream.write('[FORGE] Checking legacyClassPath for main Minecraft JAR...\n');

            const legacyClassPathIndex = jvmArgs.findIndex(arg => arg.startsWith('-DlegacyClassPath='));
            if (legacyClassPathIndex !== -1) {
              const legacyClassPathArg = jvmArgs[legacyClassPathIndex];
              const legacyClassPathValue = legacyClassPathArg.substring('-DlegacyClassPath='.length);

              // Определяем путь к главному Minecraft JAR
              const baseVersion = versionData.inheritsFrom || version;
              const mainJarPath = path.join(this.versionsDir, baseVersion, `${baseVersion}.jar`);

              console.log(`>>> Главный JAR: ${mainJarPath}`);
              console.log(`>>> legacyClassPath (первые 300 символов): ${legacyClassPathValue.substring(0, 300)}...`);
              logStream.write(`[FORGE] Main JAR path: ${mainJarPath}\n`);
              logStream.write(`[FORGE] legacyClassPath content (first 500 chars): ${legacyClassPathValue.substring(0, 500)}...\n`);

              // Проверяем существует ли главный JAR
              if (fs.existsSync(mainJarPath)) {
                // Проверяем содержит ли legacyClassPath главный JAR
                const pathsInLegacy = legacyClassPathValue.split(path.delimiter);
                const hasMainJar = pathsInLegacy.some(p =>
                  p.includes(`${baseVersion}.jar`) ||
                  p.includes(`client-${baseVersion}`) ||
                  p.endsWith(`\\${baseVersion}\\${baseVersion}.jar`) ||
                  p.endsWith(`/${baseVersion}/${baseVersion}.jar`)
                );

                if (!hasMainJar) {
                  // КРИТИЧНО: Главный JAR отсутствует в legacyClassPath - добавляем!
                  const newLegacyClassPath = mainJarPath + path.delimiter + legacyClassPathValue;
                  jvmArgs[legacyClassPathIndex] = `-DlegacyClassPath=${newLegacyClassPath}`;

                  console.log(`⚠️  КРИТИЧНО: Главный JAR НЕ найден в legacyClassPath!`);
                  console.log(`✓ Добавлен главный Minecraft JAR в legacyClassPath: ${baseVersion}.jar`);
                  logStream.write(`[FORGE] ⚠️ CRITICAL: Main JAR NOT in legacyClassPath from win_args.txt!\n`);
                  logStream.write(`[FORGE] ✓ Added main JAR to legacyClassPath: ${baseVersion}.jar\n`);
                } else {
                  console.log(`✓ Главный JAR уже в legacyClassPath`);
                  logStream.write(`[FORGE] ✓ Main JAR already in legacyClassPath\n`);
                }
              } else {
                console.error(`✗ ОШИБКА: Главный JAR не найден: ${mainJarPath}`);
                logStream.write(`[FORGE] ✗ ERROR: Main JAR not found: ${mainJarPath}\n`);
              }
            } else {
              console.warn(`⚠️  legacyClassPath не найден в win_args.txt`);
              logStream.write(`[FORGE] ✗ legacyClassPath not found in win_args.txt\n`);
            }
          } catch (err) {
            console.error(`⚠️  Ошибка чтения ${argsFileName}:`, err.message);
            logStream.write(`[FORGE] ✗ Error reading file: ${err.message}\n`);
          }
        } else {
          console.warn(`⚠️  Файл ${argsFileName} не найден: ${argsFilePath}`);
          console.warn(`   Пытаемся скачать...`);
          logStream.write(`[FORGE] ✗ File NOT found: ${argsFilePath}\n`);
          logStream.write(`[FORGE] Attempting to download...\n`);

          let downloadSuccessful = false;

          try {
            const axios = require('axios');
            const argsUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeFullVersion}/${argsFileName}`;
            console.log(`[FORGE] Скачивание с: ${argsUrl}`);
            logStream.write(`[FORGE] Downloading from: ${argsUrl}\n`);

            const response = await axios.get(argsUrl, { responseType: 'text', timeout: 10000 });

            // Создаём директорию если не существует
            await fs.ensureDir(path.dirname(argsFilePath));
            await fs.writeFile(argsFilePath, response.data, 'utf8');

            console.log(`✓ ${argsFileName} успешно скачан!`);
            logStream.write(`[FORGE] ✓ Downloaded successfully!\n`);

            // Теперь парсим скачанный файл
            const forgeArgsContent = response.data;
            console.log(`✓ Содержимое ${argsFileName}:`);
            console.log(forgeArgsContent.substring(0, 500));
            logStream.write(`[FORGE] Content (first 500 chars):\n${forgeArgsContent.substring(0, 500)}\n`);

            const forgeArgsParsed = forgeArgsContent.trim().split(/\s+/);
            console.log(`\n✓ Распарсено ${forgeArgsParsed.length} Forge arguments`);
            logStream.write(`[FORGE] Parsed ${forgeArgsParsed.length} arguments\n`);

            // win_args.txt содержит: <jvm_args> <main_class> <program_args>
            let hitMainClass = false;
            let prevWasFlag = false;

            forgeArgsParsed.forEach((arg, idx) => {
              // Проверяем не дошли ли до main class или program args
              if (hitMainClass) return;

              if (arg.match(/^(cpw\.mods\.|net\.minecraftforge\.|com\.mojang\.)/) && !arg.startsWith('-')) {
                hitMainClass = true;
                console.log(`[FORGE] Stopping at main class: ${arg}`);
                return;
              }

              if (arg.startsWith('--') && !arg.startsWith('--add-') && !prevWasFlag) {
                hitMainClass = true;
                console.log(`[FORGE] Stopping at program arg: ${arg}`);
                return;
              }

              prevWasFlag = (arg === '-p' || arg === '-cp' || arg === '-classpath');
              let processedArg = arg;

              // КРИТИЧНО: Сначала проверяем специальные -D параметры (они могут не содержать libraries/ с слешем!)
              if (arg.startsWith('-DlibraryDirectory=')) {
                const eqIndex = arg.indexOf('=');
                const paramValue = arg.substring(eqIndex + 1);
                // Если значение "libraries" (без слеша!) - заменяем на абсолютный путь
                if (paramValue === 'libraries' || paramValue === 'libraries/' || paramValue === 'libraries\\') {
                  processedArg = '-DlibraryDirectory=' + this.librariesDir;
                  console.log(`[FORGE] Fixed libraryDirectory: ${paramValue} -> ${this.librariesDir}`);
                  logStream.write(`[FORGE] Arg[${idx}] FIXED libraryDirectory: ${arg} -> ${processedArg}\n`);
                }
              }
              // Специальная обработка для -DignoreList (не конвертируем пути)
              else if (arg.startsWith('-DignoreList=')) {
                processedArg = arg;
              }
              // Проверяем содержит ли аргумент относительные пути libraries/
              else if (arg.includes('libraries/') || arg.includes('libraries\\')) {
                const convertPath = (p) => {
                  if (p.startsWith('libraries/') || p.startsWith('libraries\\')) {
                    let relativePath = p.replace(/^libraries[\/\\]/, '');

                    // Заменяем server на client для путей Minecraft (для клиентского запуска)
                    if (relativePath.includes('net/minecraft/server/') || relativePath.includes('net\\minecraft\\server\\')) {
                      relativePath = relativePath.replace(/net[\/\\]minecraft[\/\\]server[\/\\]/g, 'net/minecraft/client/');
                      relativePath = relativePath.replace(/server-(\d+\.\d+(?:\.\d+)?-)/g, 'client-$1');
                      console.log(`[PATH] Converted server->client: ${p} -> libraries/${relativePath}`);
                    }

                    const normalizedPath = relativePath.split('/').join(path.sep);
                    return path.join(this.librariesDir, normalizedPath);
                  }
                  return p;
                };

                // -D параметр с путями
                if (arg.includes('=')) {
                  const eqIndex = arg.indexOf('=');
                  const paramName = arg.substring(0, eqIndex + 1);
                  const paramValue = arg.substring(eqIndex + 1);

                  // Обычная обработка путей для -D параметров с libraries/
                  if (paramValue.includes(';') || paramValue.includes(':')) {
                    const separator = paramValue.includes(';') ? ';' : ':';
                    const paths = paramValue.split(separator);
                    const convertedPaths = paths.map(convertPath);
                    processedArg = paramName + convertedPaths.join(path.delimiter);
                    if (idx < 5) {
                      logStream.write(`[FORGE] Arg[${idx}] converted (-D param): ${arg.substring(0, 100)}...\n`);
                    }
                  } else {
                    processedArg = paramName + convertPath(paramValue);
                    if (idx < 5) {
                      logStream.write(`[FORGE] Arg[${idx}] converted (-D param): ${arg.substring(0, 100)}...\n`);
                    }
                  }
                }
                // Обычный аргумент
                else if (arg.startsWith('libraries/') || arg.startsWith('libraries\\')) {
                  if (arg.includes(';') || arg.includes(':')) {
                    const separator = arg.includes(';') ? ';' : ':';
                    const paths = arg.split(separator);
                    const convertedPaths = paths.map(convertPath);
                    processedArg = convertedPaths.join(path.delimiter);
                  } else {
                    processedArg = convertPath(arg);
                  }
                  if (idx < 5) {
                    logStream.write(`[FORGE] Arg[${idx}] converted: ${arg.substring(0, 200)}...\n`);
                  }
                }
              }
              jvmArgs.push(processedArg);
            });

            console.log(`✓ Добавлено ${forgeArgsParsed.length} Forge JVM arguments из скачанного ${argsFileName}`);
            logStream.write(`[FORGE] ✓ Added ${forgeArgsParsed.length} JVM arguments from downloaded file\n`);
            downloadSuccessful = true;
            forgeArgsLoaded = true; // Успешно загрузили из скачанного файла

            // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Добавляем LWJGL в module path
            // Embeddium пытается использовать org.lwjgl.system.Platform на ранней стадии загрузки
            // ВАЖНО: Главный Minecraft JAR добавляется через --patch-module (не в module path напрямую!)
            const modulepathIndexDownloaded = jvmArgs.findIndex(arg => arg === '-p');
            if (modulepathIndexDownloaded !== -1 && jvmArgs[modulepathIndexDownloaded + 1]) {
              console.log('\n>>> FORGE: Исправление module path для совместимости с Embeddium/Sodium...');
              logStream.write('[FORGE] Adding LWJGL to module path...\n');

              // Находим все LWJGL библиотеки в classpath (ВАЖНО: убираем дубликаты через Set!)
              const uniqueLwjglLibs = [...new Set(libraries)].filter(lib => {
                const libName = path.basename(lib);
                return libName.startsWith('lwjgl-') && !libName.includes('-natives-');
              });
              const lwjglLibs = uniqueLwjglLibs;

              if (lwjglLibs.length > 0) {
                console.log(`✓ Найдено ${lwjglLibs.length} LWJGL библиотек для добавления в module path`);
                logStream.write(`[FORGE] Found ${lwjglLibs.length} LWJGL libraries\n`);

                // Добавляем LWJGL библиотеки к существующему module path
                const currentModulePath = jvmArgs[modulepathIndexDownloaded + 1];
                const lwjglPaths = lwjglLibs.join(separator);
                jvmArgs[modulepathIndexDownloaded + 1] = currentModulePath + separator + lwjglPaths;

                console.log(`✓ Добавлено ${lwjglLibs.length} LWJGL библиотек в module path`);
                lwjglLibs.forEach(lib => console.log(`  - ${path.basename(lib)}`));
                logStream.write(`[FORGE] ✓ Added ${lwjglLibs.length} LWJGL libs to module path\n`);
              }

              // КРИТИЧЕСКИ ВАЖНО: Используем --patch-module для добавления Minecraft классов
              // Проблема: Minecraft JAR содержит классы в unnamed package (biq$i.class и т.д.)
              // Решение: Вклеиваем JAR в модуль Forge через --patch-module
              const baseVersion = versionData.inheritsFrom || version;
              const mainJarPath = path.join(this.versionsDir, baseVersion, `${baseVersion}.jar`);

              if (fs.existsSync(mainJarPath)) {
                // Добавляем --patch-module ПЕРЕД другими аргументами
                // Вклеиваем Minecraft JAR в модуль cpw.mods.securejarhandler (основной модуль Forge)
                const patchModuleArg = `--patch-module`;
                const patchModuleValue = `cpw.mods.securejarhandler=${mainJarPath}`;

                // Вставляем ПЕРЕД -p (module path)
                jvmArgs.splice(modulepathIndexDownloaded, 0, patchModuleArg, patchModuleValue);

                console.log(`✓ Добавлен --patch-module для главного Minecraft JAR`);
                logStream.write(`[FORGE] ✓ Added --patch-module cpw.mods.securejarhandler=${path.basename(mainJarPath)}\n`);
              } else {
                console.warn(`⚠️  Главный JAR не найден: ${mainJarPath}`);
                logStream.write(`[FORGE] ✗ Main JAR not found: ${mainJarPath}\n`);
              }
            }

          } catch (downloadErr) {
            console.error(`❌ Не удалось скачать ${argsFileName}: ${downloadErr.message}`);
            logStream.write(`[FORGE] ✗ Download failed: ${downloadErr.message}\n`);
          }

          // Если скачивание не удалось - используем fallback
          if (!downloadSuccessful) {
            console.warn(`   Создаю минимальные аргументы для запуска...`);
            logStream.write(`[FORGE] Creating fallback configuration...\n`);

            // Добавляем essential args как fallback
            essentialForgeArgs.forEach(arg => jvmArgs.push(arg));
            console.log(`✓ Добавлено ${essentialForgeArgs.length} fallback Forge аргументов`);
            logStream.write(`[FORGE] Added ${essentialForgeArgs.length} essential args as fallback\n`);

            // Строим module path вручную для критичных библиотек Forge 1.17+
          const forgeModuleLibs = [
            // КРИТИЧЕСКИ ВАЖНО: fmlloader предоставляет BootstrapLaunchConsumer!
            'net/minecraftforge/fmlloader',
            'net/minecraftforge/fmlcore',
            'net/minecraftforge/javafmllanguage',
            'net/minecraftforge/lowcodelanguage',
            'net/minecraftforge/mclanguage',
            // Bootstrap и вспомогательные
            'cpw/mods/bootstraplauncher',
            'cpw/mods/securejarhandler',
            // ASM для трансформации байткода
            'org/ow2/asm/asm',
            'org/ow2/asm/asm-commons',
            'org/ow2/asm/asm-tree',
            'org/ow2/asm/asm-util',
            'org/ow2/asm/asm-analysis',
            // Forge SPI
            'net/minecraftforge/forgespi'
          ];

          const modulePaths = [];
          for (const lib of forgeModuleLibs) {
            const libDir = path.join(this.librariesDir, lib.split('/').join(path.sep));
            if (fs.existsSync(libDir)) {
              // Находим JAR файл в директории (может быть любая версия)
              const files = fs.readdirSync(libDir);
              for (const file of files) {
                const filePath = path.join(libDir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                  // Ищем JAR в поддиректориях версий
                  const versionFiles = fs.readdirSync(filePath);
                  for (const vf of versionFiles) {
                    if (vf.endsWith('.jar')) {
                      modulePaths.push(path.join(filePath, vf));
                    }
                  }
                }
              }
            }
          }

          if (modulePaths.length > 0) {
            const separator = process.platform === 'win32' ? ';' : ':';
            jvmArgs.push('-p');
            jvmArgs.push(modulePaths.join(separator));
            console.log(`✓ Построен module path: ${modulePaths.length} библиотек`);
            logStream.write(`[FORGE] ✓ Built module path: ${modulePaths.length} libraries\n`);
            modulePaths.forEach((p, idx) => {
              logStream.write(`[FORGE]   [${idx}] ${p}\n`);
            });
          } else {
            console.error(`❌ Не найдены библиотеки для module path! Forge может не запуститься.`);
            logStream.write(`[FORGE] ✗ ERROR: No libraries found for module path!\n`);
          }

          // Добавляем --add-modules для активации всех модулей
          jvmArgs.push('--add-modules', 'ALL-MODULE-PATH');
          logStream.write(`[FORGE] Added --add-modules ALL-MODULE-PATH\n`);

          // Добавляем legacyClassPath для остальных библиотек
          // (будет добавлено позже после формирования полного classpath)
          console.log(`⚠️  legacyClassPath будет добавлен автоматически через переменные`);
          logStream.write(`[FORGE] legacyClassPath will be added later\n`);

          console.log(`✓ Fallback конфигурация для Forge 1.17+ создана`);
          logStream.write(`[FORGE] ✓ Fallback configuration created\n`);
          } // end if (!downloadSuccessful)
        } // end else (file not found)
      } else {
        logStream.write(`[FORGE_CHECK] NOT Forge - skipping Forge configuration\n`);
      }

      // Аргументы из версии (если есть)
      // Пропускаем для Forge если уже загрузили из win_args.txt (чтобы избежать дублирования)
      if (versionData.arguments && versionData.arguments.jvm && !forgeArgsLoaded) {
        let addedCount = 0;
        let skippedCount = 0;

        for (const arg of versionData.arguments.jvm) {
          if (typeof arg === 'string') {
            const replaced = this.replaceVariables(arg, variables);
            jvmArgs.push(replaced);
            addedCount++;
            console.log(`[+] String arg: ${replaced.substring(0, 100)}${replaced.length > 100 ? '...' : ''}`);
          } else if (arg.rules) {
            // ПРАВИЛЬНАЯ обработка правил (как в buildClasspath)
            let allowed = true; // По умолчанию разрешено

            // Обрабатываем rules
            for (const rule of arg.rules) {
              if (rule.action === 'allow') {
                // Проверяем OS если указана
                if (rule.os) {
                  allowed = this.checkOsRule(rule.os, osName);
                }
                // Проверяем features если указаны (пропускаем)
                else if (rule.features) {
                  allowed = false; // Features не поддерживаем
                }
                // Если нет ни OS ни features - разрешаем
                else {
                  allowed = true;
                }
              } else if (rule.action === 'disallow') {
                if (!rule.os || this.checkOsRule(rule.os, osName)) {
                  allowed = false;
                }
              }
            }

            if (allowed && arg.value) {
              if (Array.isArray(arg.value)) {
                arg.value.forEach(v => {
                  const replaced = this.replaceVariables(v, variables);
                  jvmArgs.push(replaced);
                  addedCount++;
                  console.log(`[+] Rule arg: ${replaced.substring(0, 100)}${replaced.length > 100 ? '...' : ''}`);
                });
              } else {
                const replaced = this.replaceVariables(arg.value, variables);
                jvmArgs.push(replaced);
                addedCount++;
                console.log(`[+] Rule arg: ${replaced.substring(0, 100)}${replaced.length > 100 ? '...' : ''}`);
              }
            } else {
              skippedCount++;
              console.log(`[-] Skipped arg (allowed=${allowed}, hasValue=${!!arg.value})`);
            }
          }
        }

        console.log(`\n✓ JVM arguments: добавлено ${addedCount}, пропущено ${skippedCount}`);
        console.log(`Всего JVM args (включая базовые): ${jvmArgs.length}`);
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
      // ВАЖНО: Используем finalLibraries (уже без модульных библиотек для Forge)
      const classpathFinal = finalLibraries.join(separator);
      logStream.write(`[CLASSPATH] Building final classpath from ${finalLibraries.length} libraries\n`);

      // Для Forge 1.17+: добавляем legacyClassPath если его ещё нет
      // КРИТИЧНО: Исключаем библиотеки которые уже в module path!
      if (versionId.includes('forge') && !jvmArgs.some(arg => arg.includes('legacyClassPath'))) {
        logStream.write(`[FORGE] Adding legacyClassPath for Forge...\n`);

        // Список библиотек которые НЕ должны быть в legacyClassPath (они в module path)
        const modulePathLibs = [
          'bootstraplauncher',
          'securejarhandler',
          'asm-9.3.jar',
          'asm-commons',
          'asm-tree',
          'asm-util',
          'asm-analysis',
          'forgespi'
        ];

        // ВАЖНО: finalLibraries уже без модульных библиотек и без главного JAR!
        // Но legacyClassPath ДОЛЖЕН содержать главный Minecraft JAR!
        const legacyLibraries = [...finalLibraries];

        // Добавляем главный Minecraft JAR в legacyClassPath
        const baseVersion = versionData.inheritsFrom || version;
        const mainJarPath = path.join(this.versionsDir, baseVersion, `${baseVersion}.jar`);
        if (fs.existsSync(mainJarPath)) {
          // Добавляем в НАЧАЛО для приоритета загрузки
          legacyLibraries.unshift(mainJarPath);
          console.log(`✓ Добавлен главный Minecraft JAR в legacyClassPath: ${baseVersion}.jar`);
          logStream.write(`[FORGE] Added main JAR to legacyClassPath: ${baseVersion}.jar\n`);
        } else {
          console.warn(`⚠️  Главный JAR не найден для legacyClassPath: ${mainJarPath}`);
          logStream.write(`[FORGE] ✗ Main JAR not found for legacyClassPath: ${mainJarPath}\n`);
        }

        const legacyClassPath = legacyLibraries.join(separator);
        jvmArgs.push(`-DlegacyClassPath=${legacyClassPath}`);
        console.log(`✓ Добавлен -DlegacyClassPath для Forge (${legacyLibraries.length} библиотек, ${legacyClassPath.length} символов)`);
        logStream.write(`[INFO] legacyClassPath: ${legacyLibraries.length} libraries, ${legacyClassPath.length} chars\n`);
      }

      console.log(`Classpath: ${finalLibraries.length} JAR файлов`);
      console.log(`Длина classpath: ${classpathFinal.length} символов`);
      logStream.write(`[CLASSPATH] ${finalLibraries.length} JARs, ${classpathFinal.length} chars\n`);
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
      console.log('Classpath entries:', finalLibraries.length);
      console.log('Main class:', mainClass);
      console.log('Game аргументов:', gameArgs.length);
      console.log('RAM выделено:', memory, 'MB');
      console.log('\nЗапуск процесса Java...\n');

      // Записываем полную команду запуска в лог
      logStream.write('\n=== ИСПОЛЬЗУЕТСЯ ПРЯМОЙ ЗАПУСК (spawn) ===\n');
      logStream.write(`Main class: ${mainClass}\n`);
      logStream.write(`Classpath entries: ${finalLibraries.length}\n`);
      logStream.write(`Classpath length: ${classpathFinal.length} chars\n\n`);
      logStream.write('JVM ARGS:\n');
      jvmArgsNoCp.forEach((arg, i) => logStream.write(`  [${i}] ${arg}\n`));
      logStream.write(`\n[CLASSPATH] ${finalLibraries.length} JARs:\n`);
      finalLibraries.forEach((jar, i) => {
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
echo Classpath JARs: ${finalLibraries.length}
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
