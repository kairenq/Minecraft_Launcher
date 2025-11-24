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

// Отрисовка сборок в grid
function renderModpacks() {
  const grid = document.getElementById('modpacks-grid');
  grid.innerHTML = '';

  modpacks.forEach((modpack) => {
    const card = document.createElement('div');
    card.className = 'modpack-card';
    card.onclick = () => openModpackPage(modpack);

    const gradient = getRandomGradient();
    const bannerStyle = modpack.icon
      ? `background-image: url(${modpack.icon}); background-size: cover;`
      : `background: linear-gradient(135deg, ${gradient})`;

    const statusClass = modpack.installed ? 'installed' : '';
    const statusText = modpack.installed ? 'Установлено' : 'Не установлено';

    card.innerHTML = `
      <div class="modpack-card-banner" style="${bannerStyle}"></div>
      <div class="modpack-card-content">
        <h3 class="modpack-card-title">${modpack.name}</h3>
        <p class="modpack-card-version">Minecraft ${modpack.minecraftVersion}</p>
        <div class="modpack-card-status ${statusClass}">${statusText}</div>
      </div>
    `;

    grid.appendChild(card);
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

  // Скрываем grid, показываем страницу сборки
  document.getElementById('modpacks-grid-page').classList.remove('active');
  document.getElementById('modpack-page').classList.add('active');

  // Заполняем информацию
  document.getElementById('modpack-title').textContent = modpack.name;
  document.getElementById('modpack-version-tag').textContent = `Minecraft ${modpack.minecraftVersion}`;
  document.getElementById('modpack-description-text').textContent = modpack.description;

  // Установка градиента для баннера
  const banner = document.getElementById('modpack-banner');
  if (modpack.icon) {
    banner.style.backgroundImage = `url(${modpack.icon})`;
    banner.style.backgroundSize = 'cover';
  } else {
    banner.style.background = `linear-gradient(135deg, ${getRandomGradient()})`;
  }

  // Тег статуса
  const statusTag = document.getElementById('modpack-status-tag');
  if (modpack.installed) {
    statusTag.textContent = 'Установлено';
    statusTag.classList.add('installed');
  } else {
    statusTag.textContent = 'Не установлено';
    statusTag.classList.remove('installed');
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
}

// Настройка навигации
function setupNavigation() {
  // Навигация в sidebar
  document.getElementById('nav-modpacks').addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('modpacks-grid-page').classList.add('active');

    // Обновляем активную кнопку
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('nav-modpacks').classList.add('active');
  });

  document.getElementById('nav-settings').addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('settings-page').classList.add('active');

    // Обновляем активную кнопку
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('nav-settings').classList.add('active');
  });

  // Кнопка "Назад" со страницы сборки
  document.getElementById('back-to-modpacks').addEventListener('click', () => {
    document.getElementById('modpack-page').classList.remove('active');
    document.getElementById('modpacks-grid-page').classList.add('active');
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
  const modalBackdrop = document.getElementById('modal-backdrop');

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

  modalBackdrop.addEventListener('click', () => {
    modsModal.classList.remove('active');
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
    mods.forEach((mod) => {
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
  memoryValue.textContent = memorySlider.value + ' MB';

  memorySlider.addEventListener('input', (e) => {
    memoryValue.textContent = e.target.value + ' MB';
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
      showNotification('Ошибка сохранения настроек', 'error');
    }
  });
}

// Установка сборки с прогрессом в кнопке
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
      if (data.modpackId && data.modpackId !== modpack.id) {
        return;
      }

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
      if (data.modpackId && data.modpackId !== modpack.id) {
        return;
      }

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
    showNotification('Ошибка установки: ' + error.message, 'error');
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
    showNotification('Ошибка запуска: ' + error.message, 'error');
  }
}

// Обновление UI
function updateUI() {
  // Обновляем отображение имени в sidebar
  const sidebarUsername = document.getElementById('username-display-sidebar');
  if (sidebarUsername) {
    sidebarUsername.textContent = config.username || 'Player';
  }

  renderModpacks();
}

// Система toast-уведомлений
function showNotification(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Иконки для разных типов
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>'
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <p class="toast-message">${message}</p>
    </div>
    <button class="toast-close" aria-label="Закрыть">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  `;

  // Добавляем toast в контейнер
  container.appendChild(toast);

  // Обработчик кнопки закрытия
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => removeToast(toast));

  // Автоматическое удаление через 5 секунд
  setTimeout(() => removeToast(toast), 5000);
}

function removeToast(toast) {
  if (!toast || toast.classList.contains('removing')) return;

  toast.classList.add('removing');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

// Обработка ошибок
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});
