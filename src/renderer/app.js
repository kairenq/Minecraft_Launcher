const { ipcRenderer } = require('electron');

// Состояние приложения
let config = {};
let modpacks = [];
let currentModpack = null;
let isDarkTheme = true;
let favorites = [];
let searchQuery = '';
let activeFilter = 'all';
let currentViewMode = 'grid';

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadModpacks();
  await loadFavorites();
  await loadSystemInfo();
  setupWindowControls();
  setupNavigation();
  setupSettings();
  setupSocialLinks();
  setupModsList();
  setupSearchAndFilters();
  setupViewControls();
  setupContextMenu();
  setupConfirmDialog();
  setupCustomization();
  setupKeyboardShortcuts();
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
    // Показываем skeleton loading
    showSkeletonLoading();

    modpacks = await ipcRenderer.invoke('get-modpacks');
    console.log('Modpacks loaded:', modpacks);

    // Небольшая задержка для демонстрации skeleton (можно убрать в продакшене)
    await new Promise(resolve => setTimeout(resolve, 500));

    hideSkeletonLoading();
    renderModpacks();
  } catch (error) {
    console.error('Failed to load modpacks:', error);
    hideSkeletonLoading();
  }
}

// Загрузка избранного
async function loadFavorites() {
  try {
    favorites = await ipcRenderer.invoke('get-favorites');
    console.log('Favorites loaded:', favorites);
  } catch (error) {
    console.error('Failed to load favorites:', error);
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

  // Фильтрация сборок
  let filteredModpacks = modpacks.filter(modpack => {
    // Поиск
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!modpack.name.toLowerCase().includes(query) &&
          !modpack.description.toLowerCase().includes(query)) {
        return false;
      }
    }

    // Фильтры
    if (activeFilter === 'favorites') {
      if (!favorites.includes(modpack.id)) return false;
    } else if (activeFilter === 'installed') {
      if (!modpack.installed) return false;
    }

    return true;
  });

  // Проверка пустого состояния
  const emptyState = document.getElementById('empty-state');
  if (filteredModpacks.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'flex';
    emptyState.classList.add('active');
    return;
  } else {
    grid.style.display = 'grid';
    emptyState.style.display = 'none';
    emptyState.classList.remove('active');
  }

  // Применяем размер карточек и режим просмотра
  grid.className = 'modpacks-grid';
  if (config.customization) {
    if (config.customization.cardSize) {
      grid.classList.add(`size-${config.customization.cardSize}`);
    }
    if (config.customization.viewMode === 'compact') {
      grid.classList.add('view-compact');
    }
  }

  filteredModpacks.forEach((modpack) => {
    const card = document.createElement('div');
    card.className = 'modpack-card';
    card.dataset.modpackId = modpack.id;
    card.onclick = (e) => {
      // Игнорируем клики по правой кнопке мыши
      if (e.button !== 0) return;
      openModpackPage(modpack);
    };

    // Контекстное меню
    card.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, modpack);
    };

    const gradient = getRandomGradient();
    const bannerStyle = modpack.icon
      ? `background-image: url(${modpack.icon}); background-size: cover;`
      : `background: linear-gradient(135deg, ${gradient})`;

    const statusClass = modpack.installed ? 'installed' : '';
    const statusText = modpack.installed ? 'Установлено' : 'Не установлено';
    const isFavorite = favorites.includes(modpack.id);
    const favoriteIcon = isFavorite ? '★' : '☆';

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
async function openModpackPage(modpack) {
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

  // Кнопка избранного
  const favoriteBtn = document.getElementById('favorite-btn');
  const isFavorite = favorites.includes(modpack.id);
  if (isFavorite) {
    favoriteBtn.classList.add('active');
  } else {
    favoriteBtn.classList.remove('active');
  }

  // Настройка обработчика избранного
  favoriteBtn.onclick = async () => {
    await toggleFavorite(modpack.id);
  };

  // Загрузка и отображение статистики
  try {
    const stats = await ipcRenderer.invoke('get-stats', modpack.id);
    document.getElementById('stat-launches').textContent = `${stats.launches || 0} запусков`;
    const hours = Math.floor((stats.playtime || 0) / 3600000);
    document.getElementById('stat-playtime').textContent = `${hours} ч`;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }

  // Кнопки действий
  const installBtn = document.getElementById('modpack-action-btn');
  const playBtn = document.getElementById('modpack-play-btn');
  const deleteBtn = document.getElementById('btn-delete-modpack');

  if (modpack.installed) {
    installBtn.style.display = 'none';
    playBtn.style.display = 'flex';
    deleteBtn.style.display = 'flex';
  } else {
    installBtn.style.display = 'flex';
    playBtn.style.display = 'none';
    deleteBtn.style.display = 'none';
  }

  // Настройка обработчика удаления
  deleteBtn.onclick = () => {
    showConfirmation(
      'Удалить сборку?',
      `Вы уверены, что хотите удалить сборку "${modpack.name}"? Это действие нельзя отменить.`,
      async () => {
        await deleteModpack(modpack);
      }
    );
  };

  // Добавляем сборку в историю
  try {
    await ipcRenderer.invoke('add-to-history', modpack.id);
  } catch (error) {
    console.error('Failed to add to history:', error);
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
  // ========================================
  // 📍 ВАЖНО: ЗДЕСЬ УСТАНОВИТЬ СВОИ ССЫЛКИ
  // ========================================
  const SOCIAL_LINKS = {
    discord: 'https://discord.gg/your-server',     // <-- ВАШ DISCORD СЕРВЕР
    telegram: 'https://t.me/your-channel',         // <-- ВАШ TELEGRAM КАНАЛ
    boosty: 'https://boosty.to/your-page'          // <-- ВАШ BOOSTY
  };

  const { shell } = require('electron');

  // Discord
  const discordLink = document.getElementById('social-discord-sidebar');
  if (discordLink) {
    discordLink.href = SOCIAL_LINKS.discord;
    discordLink.addEventListener('click', (e) => {
      e.preventDefault();
      shell.openExternal(SOCIAL_LINKS.discord);
    });
  }

  // Telegram
  const telegramLink = document.getElementById('social-telegram-sidebar');
  if (telegramLink) {
    telegramLink.href = SOCIAL_LINKS.telegram;
    telegramLink.addEventListener('click', (e) => {
      e.preventDefault();
      shell.openExternal(SOCIAL_LINKS.telegram);
    });
  }

  // Boosty
  const boostyLink = document.getElementById('social-boosty-sidebar');
  if (boostyLink) {
    boostyLink.href = SOCIAL_LINKS.boosty;
    boostyLink.addEventListener('click', (e) => {
      e.preventDefault();
      shell.openExternal(SOCIAL_LINKS.boosty);
    });
  }
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
  const savedTheme = config.theme || 'dark';
  themeSelect.value = savedTheme;

  // Применяем сохраненную тему при загрузке
  applyTheme(savedTheme);

  themeSelect.addEventListener('change', (e) => {
    const newTheme = e.target.value;
    applyTheme(newTheme);
  });

  // Настройка фона
  const backgroundSelect = document.getElementById('background-select');
  const customBgField = document.getElementById('custom-bg-field');
  const customBgInput = document.getElementById('custom-bg-input');

  // Переменная для хранения текущего фона
  let currentBgImage = config.backgroundImage || '';

  // Применяем сохраненный фон при загрузке
  const savedBg = config.background || 'none';
  backgroundSelect.value = savedBg;
  applyBackground(savedBg, currentBgImage);

  if (savedBg === 'custom') {
    customBgField.style.display = 'block';
  }

  backgroundSelect.addEventListener('change', (e) => {
    const bg = e.target.value;
    if (bg === 'custom') {
      customBgField.style.display = 'block';
    } else {
      customBgField.style.display = 'none';
      applyBackground(bg, null);
    }
  });

  // Обработка загрузки файла
  customBgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        currentBgImage = event.target.result;
        applyBackground('custom', currentBgImage);
      };
      reader.readAsDataURL(file);
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
      theme: themeSelect.value,
      background: backgroundSelect.value,
      backgroundImage: currentBgImage
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

// Установка сборки с новым прогрессом
async function installModpack(modpack) {
  const btn = document.getElementById('modpack-action-btn');
  const progressWrapper = document.getElementById('install-progress-wrapper');
  const progressFill = document.getElementById('install-progress-fill');
  const progressText = document.getElementById('install-progress-text');

  // Показываем новый прогресс
  btn.disabled = true;
  btn.style.display = 'none';
  progressWrapper.classList.add('active');
  progressWrapper.style.display = 'flex';

  // Стейджи установки
  const stages = {
    'downloading-java': 'java',
    'downloading-minecraft': 'minecraft',
    'installing-modloader': 'modloader',
    'installing-archive': 'mods',
    'installing-mods': 'mods'
  };

  let currentStageElement = null;

  function updateStage(status) {
    // Сбрасываем предыдущий
    if (currentStageElement) {
      currentStageElement.classList.remove('active');
      currentStageElement.classList.add('completed');
    }

    // Активируем текущий
    const stageName = stages[status];
    if (stageName) {
      currentStageElement = document.querySelector(`.stage[data-stage="${stageName}"]`);
      if (currentStageElement) {
        currentStageElement.classList.add('active');
      }
    }
  }

  try {
    // Обработчик прогресса
    const progressHandler = (event, data) => {
      if (data.modpackId && data.modpackId !== modpack.id) return;

      const progress = data.percent || 0;
      progressFill.style.width = progress + '%';

      if (data.stage) {
        progressText.textContent = data.stage;
      }
    };

    // Обработчик статуса
    const statusHandler = (event, data) => {
      if (data.modpackId && data.modpackId !== modpack.id) return;

      if (data.status) {
        updateStage(data.status);

        const statusTexts = {
          'downloading-java': 'Загрузка Java...',
          'downloading-minecraft': 'Загрузка Minecraft...',
          'installing-modloader': 'Установка модлоадера...',
          'installing-archive': 'Установка архива сборки...',
          'installing-mods': 'Загрузка модов...',
          'completed': 'Завершено!'
        };

        progressText.textContent = statusTexts[data.status] || data.status;
      }
    };

    ipcRenderer.on('download-progress', progressHandler);
    ipcRenderer.on('install-status', statusHandler);

    // Запуск установки
    await ipcRenderer.invoke('install-modpack', modpack.id);

    // Завершение - отмечаем все стейджи как completed
    document.querySelectorAll('.stage').forEach(stage => {
      stage.classList.remove('active');
      stage.classList.add('completed');
    });

    progressFill.style.width = '100%';
    progressText.textContent = 'Установка завершена!';

    // Обновляем статус сборки
    modpack.installed = true;
    await loadModpacks();

    setTimeout(() => {
      progressWrapper.classList.remove('active');
      progressWrapper.style.display = 'none';
      document.getElementById('modpack-play-btn').style.display = 'flex';
      document.getElementById('btn-delete-modpack').style.display = 'flex';
      btn.disabled = false;

      // Сбрасываем стейджи
      document.querySelectorAll('.stage').forEach(stage => {
        stage.classList.remove('active', 'completed');
      });
      progressFill.style.width = '0%';

      showNotification(`${modpack.name} успешно установлен!`);
      openModpackPage(modpack);
    }, 1500);

  } catch (error) {
    console.error('Installation error:', error);
    progressWrapper.classList.remove('active');
    progressWrapper.style.display = 'none';
    btn.style.display = 'flex';
    btn.disabled = false;

    // Сбрасываем стейджи
    document.querySelectorAll('.stage').forEach(stage => {
      stage.classList.remove('active', 'completed');
    });
    progressFill.style.width = '0%';

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

// ===== SKELETON LOADING =====
function showSkeletonLoading() {
  const skeleton = document.getElementById('modpacks-skeleton');
  const grid = document.getElementById('modpacks-grid');
  skeleton.style.display = 'grid';
  skeleton.classList.add('active');
  grid.style.display = 'none';
}

function hideSkeletonLoading() {
  const skeleton = document.getElementById('modpacks-skeleton');
  const grid = document.getElementById('modpacks-grid');
  skeleton.style.display = 'none';
  skeleton.classList.remove('active');
  grid.style.display = 'grid';
}

// ===== ИЗБРАННОЕ =====
async function toggleFavorite(modpackId) {
  try {
    const result = await ipcRenderer.invoke('toggle-favorite', modpackId);
    favorites = await ipcRenderer.invoke('get-favorites');

    // Обновляем UI
    const favoriteBtn = document.getElementById('favorite-btn');
    if (result.isFavorite) {
      favoriteBtn.classList.add('active');
      showNotification('Добавлено в избранное');
    } else {
      favoriteBtn.classList.remove('active');
      showNotification('Удалено из избранного');
    }

    // Перерисовываем grid если активен фильтр избранного
    if (activeFilter === 'favorites') {
      renderModpacks();
    }
  } catch (error) {
    console.error('Failed to toggle favorite:', error);
    showNotification('Ошибка при работе с избранным', 'error');
  }
}

// ===== ПОИСК И ФИЛЬТРЫ =====
function setupSearchAndFilters() {
  const searchInput = document.getElementById('search-input');
  const clearSearch = document.getElementById('clear-search');
  const filterBtns = document.querySelectorAll('.filter-btn');

  // Поиск
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderModpacks();

    // Показать/скрыть кнопку очистки
    if (searchQuery) {
      clearSearch.style.display = 'flex';
    } else {
      clearSearch.style.display = 'none';
    }
  });

  // Очистка поиска
  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearch.style.display = 'none';
    renderModpacks();
  });

  // Фильтры
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Снимаем активный класс со всех
      filterBtns.forEach(b => b.classList.remove('active'));
      // Активируем текущий
      btn.classList.add('active');

      activeFilter = btn.dataset.filter;
      renderModpacks();
    });
  });
}

// ===== ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ ПРОСМОТРА =====
function setupViewControls() {
  const viewBtns = document.querySelectorAll('.view-btn');

  viewBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      // Снимаем активный класс
      viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const viewMode = btn.dataset.view;
      currentViewMode = viewMode;

      // Сохраняем в конфиг
      try {
        await ipcRenderer.invoke('update-customization', { viewMode });
        config.customization = { ...config.customization, viewMode };
        renderModpacks();
      } catch (error) {
        console.error('Failed to save view mode:', error);
      }
    });
  });
}

// ===== КОНТЕКСТНОЕ МЕНЮ =====
function setupContextMenu() {
  const contextMenu = document.getElementById('context-menu');

  // Закрытие при клике вне меню
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.style.display = 'none';
    }
  });

  // Обработчики действий
  contextMenu.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      const modpackId = contextMenu.dataset.modpackId;
      const modpack = modpacks.find(m => m.id === modpackId);

      if (!modpack) return;

      contextMenu.style.display = 'none';

      if (action === 'launch') {
        if (modpack.installed) {
          await launchModpack(modpack);
        } else {
          showNotification('Сборка не установлена', 'warning');
        }
      } else if (action === 'favorite') {
        await toggleFavorite(modpackId);
        renderModpacks();
      } else if (action === 'delete') {
        if (modpack.installed) {
          showConfirmation(
            'Удалить сборку?',
            `Вы уверены, что хотите удалить сборку "${modpack.name}"?`,
            async () => {
              await deleteModpack(modpack);
            }
          );
        } else {
          showNotification('Сборка не установлена', 'warning');
        }
      }
    });
  });
}

function showContextMenu(x, y, modpack) {
  const contextMenu = document.getElementById('context-menu');
  contextMenu.dataset.modpackId = modpack.id;

  // Обновляем текст для избранного
  const favoriteItem = contextMenu.querySelector('[data-action="favorite"]');
  if (favorites.includes(modpack.id)) {
    favoriteItem.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      Удалить из избранного
    `;
  } else {
    favoriteItem.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      В избранное
    `;
  }

  // Позиционирование
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';

  // Проверяем, не вышло ли меню за пределы экрана
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = (x - rect.width) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = (y - rect.height) + 'px';
  }
}

// ===== ДИАЛОГ ПОДТВЕРЖДЕНИЯ =====
function setupConfirmDialog() {
  const modal = document.getElementById('confirm-modal');
  const backdrop = document.getElementById('confirm-backdrop');
  const closeBtn = document.getElementById('confirm-close');
  const cancelBtn = document.getElementById('confirm-cancel');

  const closeModal = () => {
    modal.classList.remove('active');
  };

  backdrop.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
}

function showConfirmation(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok');

  titleEl.textContent = title;
  messageEl.textContent = message;

  // Удаляем старые обработчики
  const newOkBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);

  // Добавляем новый обработчик
  newOkBtn.addEventListener('click', async () => {
    modal.classList.remove('active');
    if (onConfirm) {
      await onConfirm();
    }
  });

  modal.classList.add('active');
}

// ===== УДАЛЕНИЕ СБОРКИ =====
async function deleteModpack(modpack) {
  try {
    const fs = require('fs-extra');
    const path = require('path');
    const launcherDir = await ipcRenderer.invoke('get-launcher-dir');
    const instanceDir = path.join(launcherDir, 'instances', modpack.id);

    // Удаляем директорию
    if (fs.existsSync(instanceDir)) {
      await fs.remove(instanceDir);
    }

    // Обновляем статус
    modpack.installed = false;
    await loadModpacks();

    showNotification(`Сборка "${modpack.name}" удалена`);

    // Если мы на странице сборки, возвращаемся назад
    if (document.getElementById('modpack-page').classList.contains('active')) {
      document.getElementById('modpack-page').classList.remove('active');
      document.getElementById('modpacks-grid-page').classList.add('active');
    }
  } catch (error) {
    console.error('Failed to delete modpack:', error);
    showNotification('Ошибка удаления сборки: ' + error.message, 'error');
  }
}

// ===== КАСТОМИЗАЦИЯ =====
function setupCustomization() {
  // Акцентный цвет
  const accentColor = document.getElementById('accent-color');
  if (config.customization && config.customization.accentColor) {
    accentColor.value = config.customization.accentColor;
  }

  accentColor.addEventListener('change', async (e) => {
    const color = e.target.value;
    document.documentElement.style.setProperty('--accent', color);

    // Вычисляем hover цвет (немного темнее)
    const rgb = parseInt(color.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const hoverColor = `rgb(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)})`;
    document.documentElement.style.setProperty('--accent-hover', hoverColor);

    try {
      await ipcRenderer.invoke('update-customization', { accentColor: color });
      config.customization = { ...config.customization, accentColor: color };
    } catch (error) {
      console.error('Failed to save accent color:', error);
    }
  });

  // Размер карточек
  const cardSize = document.getElementById('card-size');
  if (config.customization && config.customization.cardSize) {
    cardSize.value = config.customization.cardSize;
  }

  cardSize.addEventListener('change', async (e) => {
    const size = e.target.value;
    try {
      await ipcRenderer.invoke('update-customization', { cardSize: size });
      config.customization = { ...config.customization, cardSize: size };
      renderModpacks();
    } catch (error) {
      console.error('Failed to save card size:', error);
    }
  });

  // Glassmorphism
  const glassmorphism = document.getElementById('glassmorphism');
  if (config.customization && config.customization.glassmorphism) {
    glassmorphism.checked = config.customization.glassmorphism;
    document.body.classList.add('glassmorphism-enabled');
  }

  glassmorphism.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      document.body.classList.add('glassmorphism-enabled');
    } else {
      document.body.classList.remove('glassmorphism-enabled');
    }

    try {
      await ipcRenderer.invoke('update-customization', { glassmorphism: enabled });
      config.customization = { ...config.customization, glassmorphism: enabled };
    } catch (error) {
      console.error('Failed to save glassmorphism:', error);
    }
  });
}

// ===== УПРАВЛЕНИЕ ОКНОМ (FRAMELESS) =====
function setupWindowControls() {
  const minimizeBtn = document.getElementById('window-minimize');
  const maximizeBtn = document.getElementById('window-maximize');
  const closeBtn = document.getElementById('window-close');

  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('window-minimize');
    });
  }

  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('window-maximize');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('window-close');
    });
  }
}

// ===== КЛАВИАТУРНЫЕ СОЧЕТАНИЯ =====
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + F - фокус на поиск
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      const searchInput = document.getElementById('search-input');
      searchInput.focus();
      searchInput.select();
    }

    // Escape - закрыть модальные окна, контекстное меню
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.active').forEach(modal => {
        modal.classList.remove('active');
      });
      document.getElementById('context-menu').style.display = 'none';

      // Вернуться к списку сборок
      if (document.getElementById('modpack-page').classList.contains('active')) {
        document.getElementById('modpack-page').classList.remove('active');
        document.getElementById('modpacks-grid-page').classList.add('active');
      }
    }

    // Ctrl/Cmd + 1 - Сборки
    if ((e.ctrlKey || e.metaKey) && e.key === '1') {
      e.preventDefault();
      document.getElementById('nav-modpacks').click();
    }

    // Ctrl/Cmd + 2 - Настройки
    if ((e.ctrlKey || e.metaKey) && e.key === '2') {
      e.preventDefault();
      document.getElementById('nav-settings').click();
    }
  });
}

// ===== ПРИМЕНЕНИЕ ТЕМЫ =====
function applyTheme(theme) {
  // Удаляем все theme классы
  document.body.classList.remove('light-theme', 'purple-theme', 'ocean-theme', 'forest-theme', 'sunset-theme', 'crimson-theme');

  // Применяем новую тему
  if (theme !== 'dark') {
    document.body.classList.add(`${theme}-theme`);
  }
}

// ===== ПРИМЕНЕНИЕ ФОНА =====
function applyBackground(bg, customUrl) {
  // Удаляем все bg классы
  document.body.classList.remove('bg-none', 'bg-stars', 'bg-grid', 'bg-dots', 'bg-minecraft', 'bg-custom');

  // Применяем новый фон
  document.body.classList.add(`bg-${bg}`);

  // Если кастомный фон, устанавливаем URL
  if (bg === 'custom' && customUrl) {
    document.body.style.backgroundImage = `url(${customUrl})`;
  } else {
    document.body.style.backgroundImage = '';
  }
}

// Обработка ошибок
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});
