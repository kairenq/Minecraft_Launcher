const fs = require('fs');
const path = require('path');
const StreamZip = require('node-stream-zip');

// Скрипт для проверки содержимого client.jar

const clientJar = path.join(process.env.USERPROFILE || process.env.HOME, '.minecraft-custom-launcher', 'versions', '1.20.1', '1.20.1.jar');

console.log('='.repeat(60));
console.log('ПРОВЕРКА CLIENT.JAR');
console.log('='.repeat(60));

if (fs.existsSync(clientJar)) {
    const stats = fs.statSync(clientJar);
    console.log(`✓ Файл найден: ${clientJar}`);
    console.log(`✓ Размер: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Пробуем прочитать как ZIP и показать содержимое
    const zip = new StreamZip({
        file: clientJar,
        storeEntries: true
    });

    zip.on('ready', () => {
        const entries = Object.values(zip.entries());
        console.log(`\n✓ ZIP архив открыт успешно`);
        console.log(`✓ Всего файлов в JAR: ${entries.length}`);

        // Ищем главный класс
        const mainClass = 'net/minecraft/client/main/Main.class';
        const mainClassEntry = zip.entry(mainClass);

        if (mainClassEntry) {
            console.log(`\n✅ ГЛАВНЫЙ КЛАСС НАЙДЕН!`);
            console.log(`   Путь: ${mainClass}`);
            console.log(`   Размер: ${mainClassEntry.size} байт`);
        } else {
            console.log(`\n❌ ГЛАВНЫЙ КЛАСС НЕ НАЙДЕН!`);
            console.log(`   Ожидался: ${mainClass}`);

            // Показываем похожие файлы
            const similar = entries.filter(e =>
                e.name.includes('minecraft') &&
                e.name.includes('Main') &&
                e.name.endsWith('.class')
            ).slice(0, 10);

            if (similar.length > 0) {
                console.log(`\n   Похожие классы:`);
                similar.forEach(e => console.log(`   - ${e.name}`));
            }

            // Показываем корневую структуру
            console.log(`\n   Корневые папки в JAR:`);
            const rootDirs = new Set();
            entries.forEach(e => {
                const parts = e.name.split('/');
                if (parts.length > 0) rootDirs.add(parts[0]);
            });
            Array.from(rootDirs).slice(0, 20).forEach(d => console.log(`   - ${d}/`));
        }

        // Показываем несколько примеров файлов
        console.log(`\n📁 Примеры файлов в JAR (первые 20):`);
        entries.slice(0, 20).forEach(e => {
            console.log(`   ${e.name} (${e.size} байт)`);
        });

        zip.close();
        console.log('\n' + '='.repeat(60));
    });

    zip.on('error', err => {
        console.error(`\n❌ ОШИБКА: Не удалось открыть JAR как ZIP архив!`);
        console.error(`   ${err.message}`);
        console.error(`\n⚠️  Это означает что client.jar БИТЫЙ!`);
        console.log('\n' + '='.repeat(60));
    });
} else {
    console.error(`❌ Файл НЕ НАЙДЕН: ${clientJar}`);
    console.log('\n' + '='.repeat(60));
}
