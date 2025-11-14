const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const versionJsonPath = path.join(
  os.homedir(),
  '.minecraft-custom-launcher',
  'versions',
  '1.20.1',
  '1.20.1.json'
);

console.log('Чтение:', versionJsonPath);
console.log('Существует:', fs.existsSync(versionJsonPath));

if (fs.existsSync(versionJsonPath)) {
  const versionData = fs.readJsonSync(versionJsonPath);

  console.log('\n=== АНАЛИЗ БИБЛИОТЕК С NATIVES ===\n');

  let nativeLibs = 0;

  for (const lib of versionData.libraries) {
    // Проверяем есть ли natives
    if (lib.downloads && lib.downloads.classifiers && lib.natives) {
      nativeLibs++;
      console.log(`[${nativeLibs}] ${lib.name}`);
      console.log('   downloads.classifiers:', Object.keys(lib.downloads.classifiers));
      console.log('   natives:', lib.natives);
      console.log('');
    }
  }

  console.log(`\nВсего библиотек с natives: ${nativeLibs}`);

  if (nativeLibs === 0) {
    console.log('\n⚠️  НЕ НАЙДЕНО библиотек с natives!');
    console.log('Проверяем альтернативные структуры...\n');

    // Ищем библиотеки которые содержат "natives" в имени
    console.log('Библиотеки содержащие "natives" в имени:');
    for (const lib of versionData.libraries) {
      if (lib.name.includes('natives')) {
        console.log('  -', lib.name);
        console.log('    downloads:', lib.downloads ? Object.keys(lib.downloads) : 'нет');
      }
    }

    // Ищем библиотеки с classifiers
    console.log('\nБиблиотеки с classifiers (но без поля natives):');
    for (const lib of versionData.libraries) {
      if (lib.downloads && lib.downloads.classifiers && !lib.natives) {
        console.log('  -', lib.name);
        console.log('    classifiers:', Object.keys(lib.downloads.classifiers));
      }
    }
  }
}
