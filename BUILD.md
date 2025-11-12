# Руководство по сборке

## GitHub Actions - автоматическая сборка

Проект настроен для автоматической сборки через GitHub Actions.

### Автоматическая сборка при каждом коммите

При каждом push в ветки `main`, `master` или `claude/**` автоматически запускается сборка:

1. Перейдите в раздел **Actions** в вашем GitHub репозитории
2. Выберите workflow **"Build Minecraft Launcher"**
3. Дождитесь завершения сборки (обычно 5-10 минут)
4. Скачайте артефакты:
   - `minecraft-launcher-windows` - Windows .exe установщик
   - `minecraft-launcher-linux` - Linux AppImage

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

```bash
npm install
npm run build:linux
```

Результат: `dist/Minecraft-Launcher-1.0.0.AppImage`

## Подготовка иконки .ico (для Windows)

GitHub Actions будет использовать `assets/icon.png` если нет `.ico`.

Для создания .ico файла:

1. Используйте онлайн конвертер (например, https://convertio.co/ru/png-ico/)
2. Загрузите `assets/icon.svg` или создайте PNG 256x256
3. Конвертируйте в .ico с размерами: 16, 32, 48, 64, 128, 256
4. Сохраните как `assets/icon.ico`

Или используйте ImageMagick локально:

```bash
# Установка ImageMagick
# Windows: https://imagemagick.org/script/download.php#windows
# Linux: sudo apt install imagemagick
# macOS: brew install imagemagick

# Конвертация
convert assets/icon.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico
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

- Установщик Windows: ~150-200 MB
- Распакованное приложение: ~250-300 MB
- Linux AppImage: ~180-220 MB

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
