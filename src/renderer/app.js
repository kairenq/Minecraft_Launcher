const { ipcRenderer } = require('electron');

// Состояние приложения
let config = {};
let modpacks = [];
let currentModpack = null;

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadModpacks();
  await loadSystemInfo();
  setupNavigation();
  setupSettings();
  setupModal();
  updateUI();
});

// Загрузка конфигурации
async function loadConfig() {
  try {
    config = await ipcRenderer.invoke('get-config');
    console.log('Config loaded:', config);
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

    // Установка максимальной памяти (80% от общей)
    const maxMemory = Math.floor(sysInfo.totalMemory * 0.8);
    document.getElementById('memory-slider').max = maxMemory;

    // Загрузка пути к директории
    const launcherDir = await ipcRenderer.invoke('get-launcher-dir');
    document.getElementById('game-dir-path').textContent = launcherDir;
  } catch (error) {
    console.error('Failed to load system info:', error);
  }
}

// Отрисовка сборок
function renderModpacks() {
  const grid = document.getElementById('modpacks-grid');
  grid.innerHTML = '';

  modpacks.forEach(modpack => {
    const card = document.createElement('div');
    card.className = 'modpack-card';
    card.onclick = () => openModpackModal(modpack);

    const statusClass = modpack.installed ? 'installed' : 'not-installed';
    const statusText = modpack.installed ? 'Установлено' : 'Не установлено';

    card.innerHTML = `
      <div class="modpack-image" style="background: linear-gradient(135deg, ${getRandomGradient()})"></div>
      <div class="modpack-info">
        <h3>${modpack.name}</h3>
        <p>${modpack.description}</p>
        <div class="modpack-meta">
          <span class="modpack-version">v${modpack.minecraftVersion}</span>
          <span class="modpack-status ${statusClass}">${statusText}</span>
        </div>
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

// Навигация между страницами
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;

      // Обновление активных элементов навигации
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Переключение страниц
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(`${page}-page`).classList.add('active');
    });
  });
}

// Настройка настроек
function setupSettings() {
  // Имя пользователя
  const usernameInput = document.getElementById('username-input');
  usernameInput.value = config.username || 'Player';

  // Слайдер памяти
  const memorySlider = document.getElementById('memory-slider');
  const memoryValue = document.getElementById('memory-value');
  memorySlider.value = config.allocatedMemory || 2048;
  memoryValue.textContent = memorySlider.value;

  memorySlider.addEventListener('input', (e) => {
    memoryValue.textContent = e.target.value;
  });

  // Размер окна
  const windowSize = document.getElementById('window-size');
  windowSize.value = `${config.windowWidth || 1200}x${config.windowHeight || 750}`;

  // Открытие директории
  document.getElementById('open-dir-btn').addEventListener('click', async () => {
    await ipcRenderer.invoke('open-game-dir');
  });

  // Сохранение настроек
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const newConfig = {
      ...config,
      username: usernameInput.value,
      allocatedMemory: parseInt(memorySlider.value),
      windowWidth: parseInt(windowSize.value.split('x')[0]),
      windowHeight: parseInt(windowSize.value.split('x')[1])
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

// Настройка модального окна
function setupModal() {
  const modal = document.getElementById('modpack-modal');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', closeModpackModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModpackModal();
    }
  });
}

// Открытие модального окна сборки
function openModpackModal(modpack) {
  currentModpack = modpack;

  const modal = document.getElementById('modpack-modal');
  document.getElementById('modal-title').textContent = modpack.name;
  document.getElementById('modal-description').textContent = modpack.description;
  document.getElementById('modal-version').textContent = modpack.minecraftVersion;

  const statusText = modpack.installed ? 'Установлено' : 'Не установлено';
  const statusClass = modpack.installed ? 'installed' : 'not-installed';
  document.getElementById('modal-status').innerHTML = `<span class="modpack-status ${statusClass}">${statusText}</span>`;

  // Кнопки действий
  const installBtn = document.getElementById('modal-action-btn');
  const playBtn = document.getElementById('modal-play-btn');

  if (modpack.installed) {
    installBtn.style.display = 'none';
    playBtn.style.display = 'block';
    playBtn.onclick = () => launchModpack(modpack);
  } else {
    installBtn.style.display = 'block';
    playBtn.style.display = 'none';
    installBtn.onclick = () => installModpack(modpack);
  }

  modal.classList.add('active');
}

// Закрытие модального окна
function closeModpackModal() {
  document.getElementById('modpack-modal').classList.remove('active');
  currentModpack = null;
}

// Установка сборки
async function installModpack(modpack) {
  closeModpackModal();
  showProgress('Установка сборки', 0);

  try {
    // Подписка на прогресс
    ipcRenderer.on('download-progress', (event, data) => {
      if (data.stage) {
        updateProgress(data.stage, data.percent || 0);
      } else {
        updateProgress('Загрузка...', data.progress || 0);
      }
    });

    ipcRenderer.on('install-status', (event, data) => {
      const statusMessages = {
        'downloading-java': 'Загрузка Java...',
        'downloading-minecraft': 'Загрузка Minecraft...',
        'installing-mods': 'Установка модов...',
        'completed': 'Установка завершена!'
      };
      updateProgress(statusMessages[data.status] || data.status, 50);
    });

    // Запуск установки
    await ipcRenderer.invoke('install-modpack', modpack.id);

    // Обновление статуса сборки
    modpack.installed = true;
    await loadModpacks();

    updateProgress('Установка завершена!', 100);

    setTimeout(() => {
      hideProgress();
      showNotification(`${modpack.name} успешно установлено!`);
    }, 1500);

  } catch (error) {
    console.error('Installation error:', error);
    hideProgress();
    showNotification('Ошибка установки: ' + error.message, true);
  } finally {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.removeAllListeners('install-status');
  }
}

// Запуск сборки
async function launchModpack(modpack) {
  closeModpackModal();
  showProgress('Запуск Minecraft', 50);

  try {
    await ipcRenderer.invoke('launch-minecraft', {
      version: modpack.minecraftVersion,
      username: config.username || 'Player',
      memory: config.allocatedMemory || 2048,
      modpackId: modpack.id
    });

    ipcRenderer.once('game-started', () => {
      hideProgress();
      showNotification('Minecraft запущен!');
    });

    setTimeout(hideProgress, 3000);

  } catch (error) {
    console.error('Launch error:', error);
    hideProgress();
    showNotification('Ошибка запуска: ' + error.message, true);
  }
}

// Отображение прогресс-бара
function showProgress(title, percent) {
  const overlay = document.getElementById('progress-overlay');
  document.getElementById('progress-title').textContent = title;
  document.getElementById('progress-fill').style.width = percent + '%';
  document.getElementById('progress-text').textContent = Math.floor(percent) + '%';
  overlay.style.display = 'flex';
}

// Обновление прогресса
function updateProgress(title, percent) {
  document.getElementById('progress-title').textContent = title;
  document.getElementById('progress-fill').style.width = percent + '%';
  document.getElementById('progress-text').textContent = Math.floor(percent) + '%';
}

// Скрытие прогресс-бара
function hideProgress() {
  document.getElementById('progress-overlay').style.display = 'none';
}

// Обновление UI
function updateUI() {
  document.getElementById('username-display').textContent = config.username || 'Player';
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
