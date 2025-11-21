const { ipcRenderer } = require('electron');

// Состояние приложения
let config = {};
let modpacks = [];
let currentModpack = null;
let isDarkTheme = true;

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadModpacks();
  await loadSystemInfo();
  setupSidebar();
  setupNavigation();
  setupSettings();
  setupSocialLinks();
  setupModsList();
  updateUI();
});

// Загрузка конфигурации
async function loadConfig() {
  try {
    config = await ipcRenderer.invoke('get-config');
    console.log('Config loaded:', config);

    // Загрузка темы
    isDarkTheme = config.theme !== 'light';
    if (!isDarkTheme) {
      document.body.classList.add('light-theme');
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// Загрузка сборок
async function loadModpacks() {
  try {
    modpacks = await ipcRenderer.invoke('get-modpacks');
    console.log('Modpacks loaded:', modpacks);
    renderModpacks();
  } catch (error) {
    console.error('Failed to load modpacks:', error);
  }
}

// Загрузка системной информации
async function loadSystemInfo() {
  try {
    const sysInfo = await ipcRenderer.invoke('get-system-info');
    document.getElementById('total-memory').textContent = sysInfo.totalMemory;
    document.getElementById('free-memory').textContent = sysInfo.freeMemory;

    const maxMemory = Math.floor(sysInfo.totalMemory * 0.8);
    document.getElementById('memory-slider').max = maxMemory;

    const launcherDir = await ipcRenderer.invoke('get-launcher-dir');
    document.getElementById('game-dir-path').textContent = launcherDir;
  } catch (error) {
    console.error('Failed to load system info:', error);
  }
}

// Настройка бокового меню
function setupSidebar() {
  const sidebar = document.getElementById('modpacks-sidebar');
  const toggle = document.getElementById('sidebar-toggle');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

// Отрисовка сборок в боковом меню
function renderModpacks() {
  const list = document.getElementById('modpacks-list');
  list.innerHTML = '';

  modpacks.forEach((modpack, index) => {
    const item = document.createElement('div');
    item.className = 'modpack-item';
    item.onclick = () => openModpackPage(modpack);

    const gradient = getRandomGradient();
    const icon = modpack.icon || modpack.name.charAt(0).toUpperCase();

    item.innerHTML = `
      <div class="modpack-icon" style="background: linear-gradient(135deg, ${gradient})">
        ${typeof icon === 'string' && icon.length === 1 ? icon : '<img src="' + icon + '" alt="">'}
      </div>
      <div class="modpack-info">
        <h4>${modpack.name}</h4>
        <p>Minecraft ${modpack.minecraftVersion}</p>
      </div>
    `;

    list.appendChild(item);
  });
}

// Генерация случайного градиента
function getRandomGradient() {
  const gradients = [
    '#667eea 0%, #764ba2 100%',
    '#f093fb 0%, #f5576c 100%',
    '#4facfe 0%, #00f2fe 100%',
    '#43e97b 0%, #38f9d7 100%',
    '#fa709a 0%, #fee140 100%',
    '#30cfd0 0%, #330867 100%',
    '#a8edea 0%, #fed6e3 100%',
    '#ff9a9e 0%, #fecfef 100%'
  ];
  return gradients[Math.floor(Math.random() * gradients.length)];
}

// Открытие страницы сборки
function openModpackPage(modpack) {
  currentModpack = modpack;

  // Скрываем главную, показываем страницу сборки
  document.getElementById('home-page').classList.remove('active');
  document.getElementById('modpack-page').classList.add('active');

  // Заполняем информацию
  document.getElementById('modpack-title').textContent = modpack.name;
  document.getElementById('modpack-version-badge').textContent = `Minecraft ${modpack.minecraftVersion}`;
  document.getElementById('modpack-description-text').textContent = modpack.description;

  // Детальная информация - ИСПРАВЛЕНО: используем modLoader вместо loaderType
  document.getElementById('modpack-minecraft-version').textContent = modpack.minecraftVersion;

  const loaderType = modpack.modLoader || 'vanilla';
  document.getElementById('modpack-loader-type').textContent =
    loaderType.charAt(0).toUpperCase() + loaderType.slice(1);

  document.getElementById('modpack-mods-count').textContent = modpack.modsCount || 'Загружается...';
  document.getElementById('modpack-install-status').textContent = modpack.installed ? 'Установлено' : 'Не установлено';

  // Установка градиента для картинки
  const imageLarge = document.getElementById('modpack-image-large');
  imageLarge.style.background = `linear-gradient(135deg, ${getRandomGradient()})`;

  // Бейджи статуса
  const statusBadge = document.getElementById('modpack-status-badge');
  if (modpack.installed) {
    statusBadge.textContent = 'Установлено';
    statusBadge.classList.add('installed');
  } else {
    statusBadge.textContent = 'Не установлено';
    statusBadge.classList.remove('installed');
  }

  // Кнопки действий
  const installBtn = document.getElementById('modpack-action-btn');
  const playBtn = document.getElementById('modpack-play-btn');

  if (modpack.installed) {
    installBtn.style.display = 'none';
    playBtn.style.display = 'flex';
  } else {
    installBtn.style.display = 'flex';
    playBtn.style.display = 'none';
  }

  // Активная сборка в меню
  document.querySelectorAll('.modpack-item').forEach((item, index) => {
    if (index === modpacks.indexOf(modpack)) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// Настройка навигации
function setupNavigation() {
  // Кнопка "Назад" со страницы сборки
  document.getElementById('back-to-home').addEventListener('click', () => {
    document.getElementById('modpack-page').classList.remove('active');
    document.getElementById('home-page').classList.add('active');

    // Снимаем активность со всех сборок
    document.querySelectorAll('.modpack-item').forEach(item => {
      item.classList.remove('active');
    });
  });

  // Кнопка "Назад" из настроек
  document.getElementById('back-from-settings').addEventListener('click', () => {
    document.getElementById('settings-page').classList.remove('active');
    document.getElementById('home-page').classList.add('active');
  });

  // Плавающая кнопка настроек
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('settings-page').classList.add('active');
  });

  // Кнопка установки/запуска
  document.getElementById('modpack-action-btn').addEventListener('click', () => {
    if (currentModpack) {
      installModpack(currentModpack);
    }
  });

  document.getElementById('modpack-play-btn').addEventListener('click', () => {
    if (currentModpack) {
      launchModpack(currentModpack);
    }
  });
}

// Настройка ссылок на соц сети
function setupSocialLinks() {
  // Здесь можно добавить реальные ссылки
  document.getElementById('social-discord').addEventListener('click', (e) => {
    e.preventDefault();
    // ipcRenderer.send('open-external', 'https://discord.gg/your-server');
    console.log('Discord link clicked');
  });

  document.getElementById('social-telegram').addEventListener('click', (e) => {
    e.preventDefault();
    // ipcRenderer.send('open-external', 'https://t.me/your-channel');
    console.log('Telegram link clicked');
  });

  document.getElementById('social-boosty').addEventListener('click', (e) => {
    e.preventDefault();
    // ipcRenderer.send('open-external', 'https://boosty.to/your-page');
    console.log('Boosty link clicked');
  });
}

// Настройка списка модов
function setupModsList() {
  const btnModsList = document.getElementById('btn-mods-list');
  const modsModal = document.getElementById('mods-modal');
  const modsModalClose = document.getElementById('mods-modal-close');

  btnModsList.addEventListener('click', async () => {
    if (!currentModpack) return;

    modsModal.classList.add('active');
    document.getElementById('mods-loading').style.display = 'flex';
    document.getElementById('mods-list').classList.remove('active');

    try {
      const mods = await loadModsFromGitHub(currentModpack);
      displayMods(mods);
    } catch (error) {
      console.error('Failed to load mods:', error);
      document.getElementById('mods-loading').innerHTML = `
        <p style="color: var(--danger)">Не удалось загрузить список модов</p>
        <p style="color: var(--text-secondary); font-size: 12px;">${error.message}</p>
      `;
    }
  });

  modsModalClose.addEventListener('click', () => {
    modsModal.classList.remove('active');
  });

  modsModal.addEventListener('click', (e) => {
    if (e.target === modsModal) {
      modsModal.classList.remove('active');
    }
  });
}

// Загрузка списка модов из GitHub Release
async function loadModsFromGitHub(modpack) {
  if (!modpack.archiveUrl) {
    throw new Error('У сборки нет архива для анализа');
  }

  // Парсим URL релиза
  const match = modpack.archiveUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/releases\/download\/([^\/]+)/);
  if (!match) {
    throw new Error('Неверный формат URL архива');
  }

  const [, owner, repo, tag] = match;

  // Пытаемся получить информацию о релизе
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error('Не удалось получить данные о релизе');
  }

  const releaseData = await response.json();

  // Ищем в описании релиза информацию о модах
  // или возвращаем базовую информацию
  const mods = parseModsFromRelease(releaseData);

  return mods;
}

// Парсинг списка модов из релиза
function parseModsFromRelease(releaseData) {
  const mods = [];

  // Если в описании есть список модов (например, в формате - Mod Name vX.X.X)
  const body = releaseData.body || '';
  const modLines = body.split('\n').filter(line => line.trim().startsWith('-'));

  if (modLines.length > 0) {
    modLines.forEach(line => {
      const cleaned = line.replace(/^-\s*/, '').trim();
      if (cleaned) {
        mods.push({
          name: cleaned,
          version: 'Unknown'
        });
      }
    });
  }

  // Если модов не найдено, показываем базовую информацию
  if (mods.length === 0) {
    mods.push({
      name: 'Draconica Modpack',
      version: releaseData.tag_name || 'Unknown',
      description: 'Полная информация о модах доступна в архиве'
    });
  }

  return mods;
}

// Отображение списка модов
function displayMods(mods) {
  const modsList = document.getElementById('mods-list');
  const modsLoading = document.getElementById('mods-loading');

  modsLoading.style.display = 'none';
  modsList.innerHTML = '';

  if (mods.length === 0) {
    modsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">Модов не найдено</p>';
  } else {
    mods.forEach((mod, index) => {
      const modItem = document.createElement('div');
      modItem.className = 'mod-item';

      const icon = mod.name.charAt(0).toUpperCase();

      modItem.innerHTML = `
        <div class="mod-icon">${icon}</div>
        <div class="mod-info">
          <h4>${mod.name}</h4>
          <p>${mod.version || ''} ${mod.description ? '• ' + mod.description : ''}</p>
        </div>
      `;

      modsList.appendChild(modItem);
    });
  }

  modsList.classList.add('active');
}

// Настройка настроек
function setupSettings() {
  const usernameInput = document.getElementById('username-input');
  usernameInput.value = config.username || 'Player';

  const memorySlider = document.getElementById('memory-slider');
  const memoryValue = document.getElementById('memory-value');
  memorySlider.value = config.allocatedMemory || 2048;
  memoryValue.textContent = memorySlider.value;

  memorySlider.addEventListener('input', (e) => {
    memoryValue.textContent = e.target.value;
  });

  const windowSize = document.getElementById('window-size');
  windowSize.value = `${config.windowWidth || 1200}x${config.windowHeight || 750}`;

  // Настройка темы через select
  const themeSelect = document.getElementById('theme-select');
  themeSelect.value = config.theme || 'dark';

  themeSelect.addEventListener('change', (e) => {
    const newTheme = e.target.value;
    isDarkTheme = newTheme === 'dark';

    if (isDarkTheme) {
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
    }
  });

  document.getElementById('open-dir-btn').addEventListener('click', async () => {
    await ipcRenderer.invoke('open-game-dir');
  });

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const newConfig = {
      ...config,
      username: usernameInput.value,
      allocatedMemory: parseInt(memorySlider.value),
      windowWidth: parseInt(windowSize.value.split('x')[0]),
      windowHeight: parseInt(windowSize.value.split('x')[1]),
      theme: themeSelect.value
    };

    try {
      await ipcRenderer.invoke('save-config', newConfig);
      config = newConfig;
      updateUI();
      showNotification('Настройки сохранены!');
    } catch (error) {
      console.error('Failed to save config:', error);
      showNotification('Ошибка сохранения настроек', true);
    }
  });
}

// Установка сборки с прогрессом в кнопке - ИСПРАВЛЕНА ЛОГИКА ПРОГРЕССА
async function installModpack(modpack) {
  const btn = document.getElementById('modpack-action-btn');
  const btnProgress = document.getElementById('btn-progress');
  const btnProgressBar = document.getElementById('btn-progress-bar');
  const btnProgressText = document.getElementById('btn-progress-text');

  // Показываем прогресс в кнопке
  btn.disabled = true;
  btnProgress.classList.add('active');

  let currentStage = '';
  let stageProgress = 0;

  try {
    // Обработчик единого прогресса
    const progressHandler = (event, data) => {
      if (data.stage) {
        currentStage = data.stage;
        stageProgress = data.percent || 0;
      } else if (data.progress !== undefined) {
        stageProgress = data.progress || 0;
      }

      // Обновляем визуальный прогресс
      const progress = Math.min(100, Math.max(0, stageProgress));
      btnProgressBar.style.width = progress + '%';
      btnProgressText.textContent = Math.floor(progress) + '%';
    };

    ipcRenderer.on('download-progress', progressHandler);
    ipcRenderer.on('install-status', (event, data) => {
      if (data.status === 'downloading-java') {
        btnProgressText.textContent = 'Java...';
      } else if (data.status === 'downloading-minecraft') {
        btnProgressText.textContent = 'Minecraft...';
      } else if (data.status === 'installing-modloader') {
        btnProgressText.textContent = 'Модлоадер...';
      } else if (data.status === 'installing-archive') {
        btnProgressText.textContent = 'Архив...';
      } else if (data.status === 'installing-mods') {
        btnProgressText.textContent = 'Моды...';
      }
    });

    // Запуск установки
    await ipcRenderer.invoke('install-modpack', modpack.id);

    // Обновляем статус сборки
    modpack.installed = true;
    await loadModpacks();

    // Завершение
    btnProgressBar.style.width = '100%';
    btnProgressText.textContent = '100%';

    setTimeout(() => {
      btnProgress.classList.remove('active');
      btn.style.display = 'none';
      document.getElementById('modpack-play-btn').style.display = 'flex';
      btn.disabled = false;
      showNotification(`${modpack.name} успешно установлен!`);

      // Обновляем страницу сборки
      openModpackPage(modpack);
    }, 1000);

  } catch (error) {
    console.error('Installation error:', error);
    btnProgress.classList.remove('active');
    btn.disabled = false;
    showNotification('Ошибка установки: ' + error.message, true);
  } finally {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('install-status');
  }
}

// Запуск сборки
async function launchModpack(modpack) {
  const playBtn = document.getElementById('modpack-play-btn');
  const originalText = playBtn.querySelector('.btn-text').textContent;

  playBtn.disabled = true;
  playBtn.querySelector('.btn-text').textContent = 'Запуск...';

  try {
    await ipcRenderer.invoke('launch-minecraft', {
      version: modpack.minecraftVersion,
      username: config.username || 'Player',
      memory: config.allocatedMemory || 2048,
      modpackId: modpack.id
    });

    ipcRenderer.once('game-started', () => {
      playBtn.disabled = false;
      playBtn.querySelector('.btn-text').textContent = originalText;
      showNotification('Minecraft запущен!');
    });

    setTimeout(() => {
      playBtn.disabled = false;
      playBtn.querySelector('.btn-text').textContent = originalText;
    }, 3000);

  } catch (error) {
    console.error('Launch error:', error);
    playBtn.disabled = false;
    playBtn.querySelector('.btn-text').textContent = originalText;
    showNotification('Ошибка запуска: ' + error.message, true);
  }
}

// Обновление UI
function updateUI() {
  const usernameDisplays = document.querySelectorAll('#username-display');
  usernameDisplays.forEach(display => {
    display.textContent = config.username || 'Player';
  });
  renderModpacks();
}

// Уведомления
function showNotification(message, isError = false) {
  // Простое уведомление через alert (можно улучшить)
  if (isError) {
    alert('Ошибка: ' + message);
  } else {
    alert(message);
  }
}

// Обработка ошибок
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});
