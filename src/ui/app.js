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
    console.log('Initializing application...');
    
    try {
        // Инициализируем C++ лаунчер
        const launcherInit = await ipcRenderer.invoke('initialize-launcher');
        console.log('Launcher initialized:', launcherInit);
        
        if (launcherInit.isNative) {
            showNotification('C++ ядро успешно загружено!', 'success');
        } else {
            showNotification('Используется JavaScript лаунчер', 'warning');
        }
        
        await loadConfig();
        await loadInstalledVersions(); // Новый метод для загрузки версий из C++
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
        
        console.log('Application initialized successfully');
    } catch (error) {
        console.error('Failed to initialize application:', error);
        showNotification('Ошибка инициализации: ' + error.message, 'error');
    }
});

// ===== НОВЫЕ МЕТОДЫ ДЛЯ C++ =====

// Загрузка установленных версий из C++
async function loadInstalledVersions() {
    try {
        const result = await ipcRenderer.invoke('get-installed-versions');
        if (result.success) {
            console.log('Installed versions from C++:', result.versions);
            
            // Здесь можно обновить интерфейс с версиями
            // Например, показать установленные версии в настройках
        } else {
            console.warn('Failed to get versions:', result.message);
        }
    } catch (error) {
        console.error('Error loading installed versions:', error);
    }
}

// Загрузка Java версий из C++
async function loadJavaVersions() {
    try {
        const result = await ipcRenderer.invoke('get-java-versions');
        if (result.success) {
            console.log('Java versions from C++:', result.javaVersions);
            
            // Обновляем информацию о Java в интерфейсе
            const javaInfo = document.getElementById('java-info');
            if (javaInfo && result.javaVersions.length > 0) {
                const bestJava = result.javaVersions[0]; // Первый - лучшая версия
                javaInfo.textContent = `Java ${bestJava.version} (${bestJava.vendor})`;
            }
        }
    } catch (error) {
        console.error('Error loading Java versions:', error);
    }
}

// ===== ОБНОВЛЕННЫЙ МЕТОД УСТАНОВКИ =====
async function installModpack(modpack) {
    const btn = document.getElementById('modpack-action-btn');
    const progressWrapper = document.getElementById('install-progress-wrapper');
    const progressFill = document.getElementById('install-progress-fill');
    const progressText = document.getElementById('install-progress-text');

    btn.disabled = true;
    btn.style.display = 'none';
    progressWrapper.classList.add('active');
    progressWrapper.style.display = 'flex';

    let currentStageElement = null;

    function updateStage(stageName) {
        if (currentStageElement) {
            currentStageElement.classList.remove('active');
            currentStageElement.classList.add('completed');
        }

        currentStageElement = document.querySelector(`.stage[data-stage="${stageName}"]`);
        if (currentStageElement) {
            currentStageElement.classList.add('active');
        }
    }

    try {
        // 1. Проверяем и устанавливаем Java через C++
        progressFill.style.width = '10%';
        progressText.textContent = 'Проверка Java...';
        updateStage('java');
        
        const javaResult = await ipcRenderer.invoke('get-java-versions');
        if (!javaResult.success || javaResult.javaVersions.length === 0) {
            throw new Error('Java не найдена. Установите Java 17+');
        }

        // 2. Устанавливаем Minecraft версию через C++
        progressFill.style.width = '30%';
        progressText.textContent = 'Установка Minecraft...';
        updateStage('minecraft');
        
        const installResult = await ipcRenderer.invoke('install-version', 
            modpack.minecraftVersion, 
            modpack.modLoader || 'vanilla'
        );
        
        if (!installResult.success) {
            throw new Error('Ошибка установки Minecraft: ' + installResult.message);
        }

        // 3. Устанавливаем модлоадер если нужно
        if (modpack.modLoader && modpack.modLoader !== 'vanilla') {
            progressFill.style.width = '50%';
            progressText.textContent = 'Установка модлоадера...';
            updateStage('modloader');
            
            // Здесь будет логика установки модлоадера
            await new Promise(resolve => setTimeout(resolve, 1000)); // Заглушка
        }

        // 4. Устанавливаем моды/контент сборки
        progressFill.style.width = '70%';
        progressText.textContent = 'Установка контента сборки...';
        updateStage('mods');
        
        // Используем старый метод установки для контента сборки
        // (пока не переписали на C++)
        const oldInstallResult = await ipcRenderer.invoke('install-modpack', modpack.id);
        if (!oldInstallResult.success) {
            throw new Error('Ошибка установки сборки: ' + oldInstallResult.message);
        }

        // Завершение
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
    }
}

// ===== ОБНОВЛЕННЫЙ МЕТОД ЗАПУСКА =====
async function launchModpack(modpack) {
    const playBtn = document.getElementById('modpack-play-btn');
    const originalText = playBtn.querySelector('.btn-text').textContent;

    playBtn.disabled = true;
    playBtn.querySelector('.btn-text').textContent = 'Запуск...';

    try {
        // Запуск через C++
        const result = await ipcRenderer.invoke('launch-minecraft', {
            version: modpack.minecraftVersion,
            username: config.username || 'Player',
            memory: config.allocatedMemory || 2048,
            modpackId: modpack.id,
            serverIp: '',
            serverPort: 25565,
            demo: false
        });

        if (result.success) {
            playBtn.disabled = false;
            playBtn.querySelector('.btn-text').textContent = originalText;
            showNotification('Minecraft запущен! PID: ' + result.pid);
            
            // Обновляем статистику
            ipcRenderer.invoke('update-stats', modpack.id, 0); // playtime обновим позже
        } else {
            throw new Error(result.message);
        }

    } catch (error) {
        console.error('Launch error:', error);
        playBtn.disabled = false;
        playBtn.querySelector('.btn-text').textContent = originalText;
        showNotification('Ошибка запуска: ' + error.message, 'error');
    }
}

// Остальной код твоего app.js остается без изменений
// Только заменяем вызовы ipcRenderer.invoke('launch-minecraft', ...) на наши новые методы
