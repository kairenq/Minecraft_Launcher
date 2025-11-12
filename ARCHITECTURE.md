# Как работает скачивание Minecraft

## Архитектура системы загрузки

Лаунчер использует официальные API Mojang для скачивания всех компонентов Minecraft.

## Процесс установки

### 1. Загрузка Java (если не установлена)

**Источник:** Adoptium OpenJDK 17 (LTS)
- Windows: автоматическое определение архитектуры (x64/x86)
- Размер: ~180-200 MB
- Устанавливается в: `~/.minecraft-custom-launcher/java/`

**Код:** `src/utils/java-downloader.js`

### 2. Загрузка Minecraft

#### Шаг 1: Получение манифеста версий
```
GET https://launchermeta.mojang.com/mc/game/version_manifest.json
```

Возвращает список всех доступных версий Minecraft с их URL.

#### Шаг 2: Получение данных конкретной версии
```
GET https://launchermeta.mojang.com/v1/packages/.../1.20.1.json
```

Содержит:
- URL клиента (client.jar)
- Список библиотек с зависимостями
- Информацию об ассетах
- JVM аргументы
- Главный класс для запуска

#### Шаг 3: Загрузка клиента
```
GET https://launcher.mojang.com/v1/objects/.../client.jar
```

Основной JAR файл игры (~15-30 MB в зависимости от версии).

#### Шаг 4: Загрузка библиотек
Скачивание всех необходимых библиотек:
- LWJGL (графика)
- Netty (сеть)
- Gson (JSON)
- И другие (~50-100 файлов, ~50-80 MB)

Библиотеки фильтруются по платформе (Windows/Linux/macOS).

#### Шаг 5: Загрузка ассетов
```
GET https://resources.download.minecraft.net/.../assets/indexes/1.20.json
GET https://resources.download.minecraft.net/...
```

Ассеты включают:
- Звуки
- Текстуры
- Языковые файлы
- Шрифты

Всего ~100-300 MB и ~1000-3000 файлов.

**Код:** `src/utils/minecraft-downloader.js`

## Структура директорий

После установки создается следующая структура:

```
~/.minecraft-custom-launcher/
├── java/                          # Установленная Java
│   └── bin/
│       └── java.exe
├── versions/                      # JAR файлы версий
│   ├── 1.20.1/
│   │   ├── 1.20.1.jar
│   │   └── 1.20.1.json
│   └── 1.12.2/
│       ├── 1.12.2.jar
│       └── 1.12.2.json
├── libraries/                     # Библиотеки
│   └── com/mojang/...
├── assets/                        # Ресурсы игры
│   ├── indexes/
│   └── objects/
├── instances/                     # Экземпляры игр
│   ├── vanilla-1-20-1/
│   │   ├── saves/                # Миры
│   │   ├── screenshots/
│   │   ├── mods/                 # Для будущих модов
│   │   └── natives/              # Нативные библиотеки
│   └── vanilla-1-12-2/
├── config.json                    # Конфигурация лаунчера
└── modpacks.json                  # Список установленных версий
```

## Запуск игры

### Offline режим

Лаунчер запускает игру в offline режиме:

1. **Генерация UUID** - создается детерминированный UUID на основе имени пользователя
2. **Извлечение нативных библиотек** - распаковываются нативные библиотеки для текущей ОС
3. **Построение classpath** - собирается путь ко всем JAR файлам
4. **Формирование аргументов** - JVM аргументы + game аргументы
5. **Запуск процесса** - `java.exe` запускается с правильными параметрами

**Код:** `src/utils/minecraft-launcher.js`

### Параметры запуска

```bash
java -Xmx2048M -Xms1024M \
  -Djava.library.path=natives/ \
  -cp libraries/*:versions/1.20.1/1.20.1.jar \
  net.minecraft.client.main.Main \
  --username Player \
  --version 1.20.1 \
  --gameDir ~/.minecraft-custom-launcher/instances/vanilla-1-20-1 \
  --assetsDir ~/.minecraft-custom-launcher/assets \
  --assetIndex 1.20 \
  --uuid [generated-uuid] \
  --accessToken [generated-uuid] \
  --userType legacy
```

## Безопасность

- ✅ Все файлы скачиваются с официальных серверов Mojang
- ✅ Проверка существования файлов перед повторным скачиванием
- ✅ Фильтрация библиотек по платформе
- ✅ Безопасная генерация UUID
- ✅ Изолированные экземпляры для каждой версии

## Поддерживаемые версии

Технически лаунчер поддерживает **ВСЕ** версии Minecraft, доступные через Mojang API.

Предустановлены популярные версии:
- 1.20.1 (последняя)
- 1.19.4, 1.18.2 (современные)
- 1.16.5, 1.12.2 (популярны для модов)

Можно добавить любую другую версию, отредактировав `modpacks.json`.

## Будущие улучшения

- [ ] Поддержка Forge
- [ ] Поддержка Fabric
- [ ] Скачивание модов из CurseForge/Modrinth
- [ ] Автообновление версий
- [ ] Импорт/экспорт модпаков
- [ ] Поддержка серверов
