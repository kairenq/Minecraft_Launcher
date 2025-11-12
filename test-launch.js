// Тестовый скрипт для проверки установки и запуска Minecraft
// Запускать: node test-launch.js

const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const MinecraftDownloader = require('./src/utils/minecraft-downloader');
const JavaDownloader = require('./src/utils/java-downloader');
const MinecraftLauncher = require('./src/utils/minecraft-launcher');
const ConfigManager = require('./src/utils/config-manager');

const launcherDir = path.join(os.homedir(), '.minecraft-custom-launcher');

console.log('='.repeat(60));
console.log('ТЕСТИРОВАНИЕ MINECRAFT LAUNCHER');
console.log('='.repeat(60));
console.log('Директория лаунчера:', launcherDir);
console.log('');

async function testDownloadAndLaunch() {
  const configManager = new ConfigManager(launcherDir);
  const javaDownloader = new JavaDownloader(launcherDir);
  const minecraftDownloader = new MinecraftDownloader(launcherDir);
  const minecraftLauncher = new MinecraftLauncher(launcherDir);

  const testVersion = '1.20.1'; // Тестовая версия

  console.log('1. Проверка Java...');
  const javaInstalled = await javaDownloader.checkJava();
  console.log('   Java установлена:', javaInstalled);

  if (!javaInstalled) {
    console.log('   Начинаем загрузку Java...');
    await new Promise((resolve, reject) => {
      javaDownloader.download(
        (progress) => {
          if (progress.percent && progress.percent % 10 === 0) {
            console.log(`   Прогресс: ${progress.stage} - ${progress.percent}%`);
          }
        },
        (error) => {
          if (error) {
            console.error('   ОШИБКА загрузки Java:', error.message);
            reject(error);
          } else {
            console.log('   ✓ Java успешно загружена');
            resolve();
          }
        }
      );
    });
  }

  const javaPath = javaDownloader.getJavaPath();
  console.log('   Путь к Java:', javaPath);

  if (!fs.existsSync(javaPath)) {
    throw new Error('Java не найдена после установки!');
  }

  console.log('\n2. Проверка Minecraft', testVersion, '...');
  const minecraftInstalled = await minecraftDownloader.checkMinecraft(testVersion);
  console.log('   Minecraft установлен:', minecraftInstalled);

  if (!minecraftInstalled) {
    console.log('   Начинаем загрузку Minecraft...');
    await new Promise((resolve, reject) => {
      minecraftDownloader.download(
        testVersion,
        (progress) => {
          console.log(`   ${progress.stage} - ${progress.percent}%`);
        },
        (error) => {
          if (error) {
            console.error('   ОШИБКА загрузки Minecraft:', error.message);
            reject(error);
          } else {
            console.log('   ✓ Minecraft успешно загружен');
            resolve();
          }
        }
      );
    });
  }

  // Проверка файлов после установки
  console.log('\n3. Проверка установленных файлов...');
  const versionDir = path.join(launcherDir, 'versions', testVersion);
  const versionJson = path.join(versionDir, `${testVersion}.json`);
  const versionJar = path.join(versionDir, `${testVersion}.jar`);

  console.log('   JSON файл:', fs.existsSync(versionJson) ? '✓' : '✗', versionJson);
  console.log('   JAR файл:', fs.existsSync(versionJar) ? '✓' : '✗', versionJar);

  if (fs.existsSync(versionJson)) {
    const jsonData = fs.readJsonSync(versionJson);
    console.log('   Главный класс:', jsonData.mainClass);
    console.log('   Тип версии:', jsonData.type);
  }

  // Проверка библиотек
  const librariesDir = path.join(launcherDir, 'libraries');
  if (fs.existsSync(librariesDir)) {
    const libCount = countFiles(librariesDir);
    console.log('   Библиотек установлено:', libCount, 'файлов');
  }

  // Проверка ассетов
  const assetsDir = path.join(launcherDir, 'assets', 'objects');
  if (fs.existsSync(assetsDir)) {
    const assetCount = countFiles(assetsDir);
    console.log('   Ассетов установлено:', assetCount, 'файлов');
  }

  console.log('\n4. Попытка запуска Minecraft...');
  console.log('   Версия:', testVersion);
  console.log('   Пользователь: TestPlayer');
  console.log('   Память: 2048 MB');

  const gameDir = path.join(launcherDir, 'instances', 'test-instance');
  await fs.ensureDir(gameDir);

  await new Promise((resolve, reject) => {
    minecraftLauncher.launch({
      version: testVersion,
      username: 'TestPlayer',
      memory: 2048,
      javaPath: javaPath,
      gameDir: gameDir
    }, (error, gameProcess) => {
      if (error) {
        console.error('\n   ✗ ОШИБКА запуска:', error.message);
        reject(error);
      } else {
        console.log('\n   ✓ Процесс запущен с PID:', gameProcess.pid);
        console.log('\n   Ожидаем 10 секунд для проверки стабильности...');

        // Проверяем что процесс не упал сразу
        setTimeout(() => {
          try {
            process.kill(gameProcess.pid, 0);
            console.log('   ✓ Процесс все еще работает');
            console.log('\n   УСПЕХ! Minecraft запустился корректно!');
            console.log('   Вы должны видеть окно игры.');
            resolve();
          } catch (e) {
            console.log('   ✗ Процесс упал');
            reject(new Error('Процесс завершился сразу после запуска'));
          }
        }, 10000);
      }
    });
  });

  console.log('\n' + '='.repeat(60));
  console.log('ТЕСТИРОВАНИЕ ЗАВЕРШЕНО');
  console.log('='.repeat(60));
}

function countFiles(dir) {
  let count = 0;

  function walkDir(currentPath) {
    const files = fs.readdirSync(currentPath);
    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        walkDir(filePath);
      } else {
        count++;
      }
    }
  }

  if (fs.existsSync(dir)) {
    walkDir(dir);
  }

  return count;
}

// Запуск теста
testDownloadAndLaunch().catch(error => {
  console.error('\n' + '='.repeat(60));
  console.error('КРИТИЧЕСКАЯ ОШИБКА:', error.message);
  console.error('='.repeat(60));
  console.error(error.stack);
  process.exit(1);
});
