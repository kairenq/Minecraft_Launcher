# Руководство по сборке

## GitHub Actions - автоматическая сборка

Проект настроен для автоматической сборки через GitHub Actions.

### Автоматическая сборка при каждом коммите

При каждом push в ветки `main`, `master` или `claude/**` автоматически запускается сборка:

1. Перейдите в раздел **Actions** в вашем GitHub репозитории
2. Выберите workflow **"Build Minecraft Launcher"**
3. Дождитесь завершения сборки (обычно 5-10 минут)
4. Скачайте артефакт `minecraft-launcher-windows` - Windows .exe установщик

### Создание релиза с тегом

Для создания официального релиза:

```bash
# Создайте тег версии
git tag v1.0.0

# Отправьте тег в GitHub
git push origin v1.0.0
```

После этого автоматически:
- Соберется .exe файл
- Создастся GitHub Release
- Установщик прикрепится к релизу

### Ручной запуск сборки

Можно запустить сборку вручную:

1. Перейдите в **Actions**
2. Выберите **"Build Minecraft Launcher"**
3. Нажмите **"Run workflow"**
4. Выберите ветку и нажмите **"Run workflow"**

## Локальная сборка

### Windows

```bash
# Установка зависимостей
npm install

# Сборка
npm run build:win
```

Результат: `dist/Minecraft Launcher Setup 1.0.0.exe`

### Linux

Сборка под Linux запланирована для следующих версий.
Пока используйте только Windows сборку.

## Добавление своей иконки (опционально)

В текущей версии используется дефолтная иконка Electron.

Для добавления своей иконки:

1. Создайте .ico файл с размерами: 16, 32, 48, 64, 128, 256
2. Сохраните как `assets/icon.ico`
3. Добавьте в `package.json` в секцию `"win"`:
   ```json
   "icon": "assets/icon.ico"
   ```

Можно использовать онлайн конвертер:
- https://convertio.co/ru/png-ico/
- https://icoconvert.com/

Или ImageMagick локально:
```bash
convert your-image.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico
```

## Устранение проблем сборки

### Ошибка: "node-gyp rebuild failed"

Установите Visual Studio Build Tools (Windows):
```bash
npm install --global windows-build-tools
```

### Ошибка: "Cannot find module"

Очистите кеш и переустановите:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Сборка слишком большая

Добавьте в electron-builder конфигурацию:
```json
"asar": true,
"compression": "maximum"
```

## Размер итогового файла

- Установщик Windows (.exe): ~150-200 MB
- Распакованное приложение: ~250-300 MB

Размер связан с встроенным Electron и зависимостями Node.js.

## Оптимизация размера

Для уменьшения размера:

1. Используйте `electron-builder` с максимальным сжатием
2. Исключите ненужные файлы через `files` в package.json
3. Используйте `asar` архивирование
4. Минифицируйте код (опционально)

## CI/CD статусы

После настройки вы можете добавить бейдж в README:

```markdown
![Build Status](https://github.com/USERNAME/Minecraft_Launcher/workflows/Build%20Minecraft%20Launcher/badge.svg)
```

## Подписание кода (опционально)

Для подписания Windows .exe:

1. Получите код-подписывающий сертификат
2. Добавьте секреты в GitHub:
   - `WINDOWS_CERTIFICATE`
   - `WINDOWS_CERTIFICATE_PASSWORD`
3. Обновите workflow для подписания

Без подписания Windows может показывать предупреждение SmartScreen при первом запуске.
