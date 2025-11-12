// Скрипт для отладки запуска Minecraft
// Показывает последние логи и позволяет запустить вручную
// Использование: node debug-launch.js

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { spawn } = require('child_process');

const launcherDir = path.join(os.homedir(), '.minecraft-custom-launcher');

console.log('='.repeat(80));
console.log('ОТЛАДКА ЗАПУСКА MINECRAFT');
console.log('='.repeat(80));

async function showDebugInfo() {
  // Находим последний лог
  const instances = fs.readdirSync(path.join(launcherDir, 'instances'));
  console.log('\nДоступные экземпляры:');
  instances.forEach((inst, i) => {
    console.log(`  ${i + 1}. ${inst}`);
  });

  for (const instance of instances) {
    const logFile = path.join(launcherDir, 'instances', instance, 'logs', 'launcher.log');

    if (fs.existsSync(logFile)) {
      console.log('\n' + '='.repeat(80));
      console.log(`ЛОГИ ДЛЯ: ${instance}`);
      console.log('='.repeat(80));

      const logContent = fs.readFileSync(logFile, 'utf-8');
      const lines = logContent.split('\n');

      // Показываем последние 50 строк
      console.log('\nПоследние 50 строк лога:');
      console.log('-'.repeat(80));
      console.log(lines.slice(-50).join('\n'));
      console.log('-'.repeat(80));

      // Извлекаем команду запуска
      const commandMatch = logContent.match(/ПОЛНАЯ КОМАНДА:\n(.+)/);
      if (commandMatch) {
        const fullCommand = commandMatch[1];
        console.log('\n📋 КОМАНДА ДЛЯ РУЧНОГО ЗАПУСКА:');
        console.log('-'.repeat(80));
        console.log(fullCommand);
        console.log('-'.repeat(80));

        // Сохраняем в скрипт
        const scriptPath = path.join(launcherDir, 'instances', instance, 'run-minecraft.bat');
        fs.writeFileSync(scriptPath, `@echo off
echo Starting Minecraft...
${fullCommand}
pause
`);
        console.log('\n✓ Скрипт для запуска сохранен в:');
        console.log('  ', scriptPath);
        console.log('\nВы можете запустить его вручную для детальной отладки.');
      }

      // Анализируем ошибки
      const errors = lines.filter(line =>
        line.includes('[STDERR]') ||
        line.includes('ERROR') ||
        line.includes('Exception') ||
        line.includes('Error')
      );

      if (errors.length > 0) {
        console.log('\n⚠️  НАЙДЕНЫ ОШИБКИ:');
        console.log('-'.repeat(80));
        errors.slice(-20).forEach(err => {
          console.log(err);
        });
        console.log('-'.repeat(80));
      }
    }
  }

  // Проверка установленных файлов
  console.log('\n' + '='.repeat(80));
  console.log('ПРОВЕРКА ФАЙЛОВ');
  console.log('='.repeat(80));

  const javaPath = path.join(launcherDir, 'java', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  console.log('\nJava:', fs.existsSync(javaPath) ? '✓' : '✗', javaPath);

  const versionsDir = path.join(launcherDir, 'versions');
  if (fs.existsSync(versionsDir)) {
    const versions = fs.readdirSync(versionsDir);
    console.log('\nУстановленные версии:');
    versions.forEach(ver => {
      const jsonPath = path.join(versionsDir, ver, `${ver}.json`);
      const jarPath = path.join(versionsDir, ver, `${ver}.jar`);
      const jsonExists = fs.existsSync(jsonPath);
      const jarExists = fs.existsSync(jarPath);

      console.log(`  ${ver}:`);
      console.log(`    JSON: ${jsonExists ? '✓' : '✗'} ${jsonPath}`);
      console.log(`    JAR:  ${jarExists ? '✓' : '✗'} ${jarPath}`);

      if (jarExists) {
        const jarSize = fs.statSync(jarPath).size;
        console.log(`    Размер JAR: ${(jarSize / 1024 / 1024).toFixed(2)} MB`);
      }
    });
  }

  const librariesDir = path.join(launcherDir, 'libraries');
  if (fs.existsSync(librariesDir)) {
    const libCount = countFiles(librariesDir);
    console.log(`\nБиблиотеки: ${libCount} файлов`);
  }

  const assetsDir = path.join(launcherDir, 'assets', 'objects');
  if (fs.existsSync(assetsDir)) {
    const assetCount = countFiles(assetsDir);
    console.log(`Ассеты: ${assetCount} файлов`);
  }

  // Проверка системных требований
  console.log('\n' + '='.repeat(80));
  console.log('СИСТЕМНАЯ ИНФОРМАЦИЯ');
  console.log('='.repeat(80));
  console.log('ОС:', os.platform(), os.release());
  console.log('Архитектура:', os.arch());
  console.log('RAM:', Math.floor(os.totalmem() / 1024 / 1024), 'MB всего,', Math.floor(os.freemem() / 1024 / 1024), 'MB свободно');
  console.log('CPU:', os.cpus()[0].model, `(${os.cpus().length} cores)`);

  console.log('\n' + '='.repeat(80));
  console.log('РЕКОМЕНДАЦИИ');
  console.log('='.repeat(80));
  console.log('1. Проверьте логи выше на наличие ошибок');
  console.log('2. Запустите run-minecraft.bat вручную для детальной отладки');
  console.log('3. Если видите ошибки OpenGL - обновите видеодрайвера');
  console.log('4. Если ошибки памяти - уменьшите выделенную RAM');
  console.log('5. Попробуйте старую версию (1.12.2) - она более стабильная');
  console.log('\n' + '='.repeat(80));
}

function countFiles(dir) {
  let count = 0;
  function walk(d) {
    const files = fs.readdirSync(d);
    for (const f of files) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) {
        walk(p);
      } else {
        count++;
      }
    }
  }
  walk(dir);
  return count;
}

showDebugInfo().catch(error => {
  console.error('Ошибка:', error);
  process.exit(1);
});
