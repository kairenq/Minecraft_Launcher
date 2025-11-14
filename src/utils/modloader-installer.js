const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

class ModLoaderInstaller {
  constructor(launcherDir) {
    this.launcherDir = launcherDir;
    this.versionsDir = path.join(launcherDir, 'versions');
    this.librariesDir = path.join(launcherDir, 'libraries');

    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.librariesDir);
  }

  /**
   * Установка модлоадера (Forge или Fabric)
   */
  async install(modLoader, minecraftVersion, modLoaderVersion, onProgress) {
    console.log(`\n=== УСТАНОВКА MODLOADER ===`);
    console.log(`Тип: ${modLoader}`);
    console.log(`Minecraft: ${minecraftVersion}`);
    console.log(`Версия модлоадера: ${modLoaderVersion}`);

    if (modLoader === 'vanilla') {
      console.log('Vanilla Minecraft - модлоадер не требуется');
      return { success: true };
    }

    if (modLoader === 'fabric') {
      return await this.installFabric(minecraftVersion, modLoaderVersion, onProgress);
    } else if (modLoader === 'forge') {
      return await this.installForge(minecraftVersion, modLoaderVersion, onProgress);
    } else {
      throw new Error(`Неизвестный модлоадер: ${modLoader}`);
    }
  }

  /**
   * Установка Fabric
   */
  async installFabric(minecraftVersion, loaderVersion, onProgress) {
    try {
      onProgress({ stage: 'Загрузка Fabric', percent: 0 });

      // Если версия не указана - берём последнюю стабильную
      if (!loaderVersion) {
        console.log('[FABRIC] Версия не указана, получаем последнюю...');
        const loaders = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}`);
        if (loaders.data.length === 0) {
          throw new Error(`Fabric не найден для Minecraft ${minecraftVersion}`);
        }
        loaderVersion = loaders.data[0].loader.version;
        console.log(`[FABRIC] Выбрана версия: ${loaderVersion}`);
      }

      // Скачиваем профиль Fabric
      onProgress({ stage: 'Загрузка профиля Fabric', percent: 20 });
      const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}/${loaderVersion}/profile/json`;
      console.log(`[FABRIC] Загрузка профиля: ${profileUrl}`);

      const response = await axios.get(profileUrl);
      const fabricProfile = response.data;

      // Создаём директорию для версии
      const versionId = `fabric-loader-${loaderVersion}-${minecraftVersion}`;
      const versionDir = path.join(this.versionsDir, versionId);
      await fs.ensureDir(versionDir);

      // Сохраняем JSON профиль
      const versionJsonPath = path.join(versionDir, `${versionId}.json`);
      await fs.writeJson(versionJsonPath, fabricProfile, { spaces: 2 });
      console.log(`[FABRIC] Профиль сохранён: ${versionJsonPath}`);

      onProgress({ stage: 'Загрузка библиотек Fabric', percent: 40 });

      // Скачиваем библиотеки Fabric
      const libraries = fabricProfile.libraries || [];
      console.log(`[FABRIC] Библиотек для загрузки: ${libraries.length}`);

      let downloaded = 0;
      for (const lib of libraries) {
        if (lib.url && lib.name) {
          const parts = lib.name.split(':');
          const [group, artifact, version] = parts;
          const groupPath = group.replace(/\./g, '/');
          const libPath = `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;
          const fullPath = path.join(this.librariesDir, libPath);

          if (!fs.existsSync(fullPath)) {
            const url = `${lib.url}${libPath}`;
            console.log(`[FABRIC] Загрузка: ${artifact}-${version}.jar`);

            try {
              await fs.ensureDir(path.dirname(fullPath));
              const libResponse = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream'
              });

              const writer = fs.createWriteStream(fullPath);
              await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                libResponse.data.pipe(writer);
              });
            } catch (err) {
              console.warn(`[FABRIC] Не удалось загрузить ${artifact}: ${err.message}`);
            }
          }

          downloaded++;
          const progress = 40 + ((downloaded / libraries.length) * 50);
          onProgress({ stage: `Загрузка библиотек (${downloaded}/${libraries.length})`, percent: Math.floor(progress) });
        }
      }

      onProgress({ stage: 'Fabric установлен', percent: 100 });
      console.log('[FABRIC] ✓ Установка завершена');

      return {
        success: true,
        versionId: versionId,
        mainClass: fabricProfile.mainClass
      };

    } catch (error) {
      console.error('[FABRIC] Ошибка установки:', error.message);
      throw new Error(`Не удалось установить Fabric: ${error.message}`);
    }
  }

  /**
   * Установка Forge
   */
  async installForge(minecraftVersion, forgeVersion, onProgress) {
    try {
      onProgress({ stage: 'Загрузка Forge', percent: 0 });

      // Если версия не указана - берём рекомендованную
      if (!forgeVersion) {
        console.log('[FORGE] Версия не указана, получаем рекомендованную...');
        const promotions = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
        const promoKey = `${minecraftVersion}-recommended`;
        forgeVersion = promotions.data.promos[promoKey];

        if (!forgeVersion) {
          // Пробуем latest
          const latestKey = `${minecraftVersion}-latest`;
          forgeVersion = promotions.data.promos[latestKey];
        }

        if (!forgeVersion) {
          throw new Error(`Forge не найден для Minecraft ${minecraftVersion}`);
        }

        console.log(`[FORGE] Выбрана версия: ${forgeVersion}`);
      }

      // Полная версия Forge
      const fullForgeVersion = `${minecraftVersion}-${forgeVersion}`;
      const versionId = `forge-${fullForgeVersion}`;

      onProgress({ stage: 'Загрузка манифеста Forge', percent: 20 });

      // URL манифеста Forge
      const manifestUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${fullForgeVersion}/forge-${fullForgeVersion}-universal.jar.json`;
      console.log(`[FORGE] Попытка загрузки манифеста: ${manifestUrl}`);

      // ПРИМЕЧАНИЕ: Forge требует специальной установки через installer
      // Для упрощения, мы используем альтернативный подход:
      // Пользователь должен установить Forge через официальный installer,
      // а мы просто используем уже установленный профиль

      onProgress({ stage: 'Проверка установленного Forge', percent: 50 });

      const possiblePaths = [
        path.join(this.versionsDir, versionId),
        path.join(this.versionsDir, fullForgeVersion),
        path.join(this.versionsDir, `${minecraftVersion}-forge-${forgeVersion}`)
      ];

      let forgeDir = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          forgeDir = p;
          console.log(`[FORGE] Найдена установка: ${p}`);
          break;
        }
      }

      if (!forgeDir) {
        throw new Error(
          `Forge не установлен!\n\n` +
          `Пожалуйста:\n` +
          `1. Скачайте Forge Installer: https://files.minecraftforge.net/net/minecraftforge/forge/index_${minecraftVersion}.html\n` +
          `2. Запустите installer и установите Forge в директорию: ${this.versionsDir}\n` +
          `3. Попробуйте снова установить сборку в лаунчере`
        );
      }

      onProgress({ stage: 'Forge готов', percent: 100 });
      console.log('[FORGE] ✓ Forge найден и готов к использованию');

      return {
        success: true,
        versionId: path.basename(forgeDir)
      };

    } catch (error) {
      console.error('[FORGE] Ошибка установки:', error.message);
      throw error;
    }
  }

  /**
   * Проверка установки модлоадера
   */
  async checkInstalled(modLoader, minecraftVersion, modLoaderVersion) {
    if (modLoader === 'vanilla') {
      return true;
    }

    if (modLoader === 'fabric') {
      const versionId = modLoaderVersion
        ? `fabric-loader-${modLoaderVersion}-${minecraftVersion}`
        : `fabric-loader-*-${minecraftVersion}`;

      // Проверяем существование
      const versionDir = path.join(this.versionsDir, versionId);
      if (fs.existsSync(versionDir)) {
        return true;
      }

      // Ищем любую версию Fabric для этого Minecraft
      const versions = fs.readdirSync(this.versionsDir);
      for (const v of versions) {
        if (v.startsWith('fabric-loader-') && v.endsWith(`-${minecraftVersion}`)) {
          return true;
        }
      }

      return false;
    }

    if (modLoader === 'forge') {
      // Ищем Forge в различных форматах имён
      const versions = fs.readdirSync(this.versionsDir);
      for (const v of versions) {
        if (v.includes('forge') && v.includes(minecraftVersion)) {
          return true;
        }
      }
      return false;
    }

    return false;
  }
}

module.exports = ModLoaderInstaller;
