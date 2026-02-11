/**
 * 设置页面逻辑
 */

// 国际化
function getMessage(key) {
  return chrome.i18n.getMessage(key) || key;
}

function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = getMessage(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = getMessage(el.dataset.i18nPlaceholder);
  });
  document.title = getMessage('settingsTitle');
}

// Toast
function showToast(message, type = 'default', duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (type !== 'default' ? ` ${type}` : '');
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

// 加载设置
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(['settings']);
    const settings = result.settings || {};

    // API 设置（优先展示当前激活的多配置；兼容旧字段）
    let active = null;
    if (Array.isArray(settings.aiConfigs) && settings.activeAiConfigId) {
      active = settings.aiConfigs.find(c => c.id === settings.activeAiConfigId) || null;
    }
    const endpoint = active?.apiEndpoint ?? settings.apiEndpoint ?? '';
    const apiKey = active?.apiKey ?? settings.apiKey ?? '';
    const model = active?.model ?? settings.model ?? '';
    document.getElementById('apiEndpoint').value = endpoint;
    document.getElementById('apiKey').value = apiKey;
    document.getElementById('apiModel').value = model;

    // 防火墙白名单
    const whitelist = settings.firewallWhitelist || [];
    document.getElementById('firewallWhitelist').value = whitelist.join('\n');

    // 外观设置
    const darkModeRadios = document.querySelectorAll('input[name="darkMode"]');
    darkModeRadios.forEach(radio => {
      radio.checked = radio.value === (settings.darkMode || 'auto');
    });

    const languageRadios = document.querySelectorAll('input[name="language"]');
    languageRadios.forEach(radio => {
      radio.checked = radio.value === (settings.language || 'auto');
    });

    // 应用暗色模式
    applyDarkMode(settings.darkMode || 'auto');

    // 版本号
    document.getElementById('version').textContent = chrome.runtime.getManifest().version;
  } catch (error) {
    console.error('Failed to load settings:', error);
    showToast(getMessage('error'), 'error');
  }
}

// 保存设置
async function saveSettings() {
  try {
    const now = Date.now();
    const settings = {
      apiEndpoint: document.getElementById('apiEndpoint').value.trim(),
      apiKey: document.getElementById('apiKey').value.trim(),
      model: document.getElementById('apiModel').value.trim(),
      firewallWhitelist: document.getElementById('firewallWhitelist').value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0),
      darkMode: document.querySelector('input[name="darkMode"]:checked').value,
      language: document.querySelector('input[name="language"]:checked').value
    };

    // 多配置：如果存在 active config，则同步更新；否则从当前输入创建默认 config
    const existing = (await chrome.storage.sync.get(['settings'])).settings || {};
    const aiConfigs = Array.isArray(existing.aiConfigs) ? existing.aiConfigs.slice() : [];
    let activeId = typeof existing.activeAiConfigId === 'string' ? existing.activeAiConfigId : '';

    function newId() {
      return `cfg_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    }

    if (aiConfigs.length === 0 && (settings.apiEndpoint || settings.apiKey || settings.model)) {
      const id = newId();
      aiConfigs.push({
        id,
        name: '默认配置',
        provider: 'custom',
        apiEndpoint: settings.apiEndpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        createdAt: now,
        updatedAt: now,
        stats: {
          calls: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          history: []
        }
      });
      activeId = id;
    }

    if (aiConfigs.length > 0) {
      if (!activeId) activeId = aiConfigs[0].id;
      const idx = aiConfigs.findIndex(c => c.id === activeId);
      if (idx >= 0) {
        aiConfigs[idx] = {
          ...aiConfigs[idx],
          apiEndpoint: settings.apiEndpoint,
          apiKey: settings.apiKey,
          model: settings.model,
          updatedAt: now
        };
      } else {
        activeId = aiConfigs[0].id;
      }

      settings.aiConfigs = aiConfigs;
      settings.activeAiConfigId = activeId;
    } else {
      settings.aiConfigs = [];
      settings.activeAiConfigId = '';
    }

    await chrome.storage.sync.set({ settings });

    // 应用暗色模式
    applyDarkMode(settings.darkMode);

    showToast(getMessage('settingsSaved'), 'success');
    document.getElementById('saveStatus').textContent = getMessage('settingsSaved');
    setTimeout(() => {
      document.getElementById('saveStatus').textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Failed to save settings:', error);
    showToast(getMessage('error'), 'error');
  }
}

// 应用暗色模式
function applyDarkMode(mode) {
  if (mode === 'dark') {
    document.body.classList.add('dark-mode');
  } else if (mode === 'light') {
    document.body.classList.remove('dark-mode');
  } else {
    // auto - 跟随系统
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }
}

// 测试 API 连接
async function testApiConnection() {
  const endpoint = document.getElementById('apiEndpoint').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();

  if (!endpoint || !apiKey) {
    showToast('请先填写 API 端点和密钥', 'error');
    return;
  }

  const testBtn = document.getElementById('testApi');
  const originalText = testBtn.textContent;
  testBtn.textContent = '测试中...';
  testBtn.disabled = true;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: document.getElementById('apiModel').value.trim() || 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'Hello' }
        ],
        max_tokens: 5
      })
    });

    if (response.ok) {
      showToast('连接成功！', 'success');
    } else {
      const error = await response.json().catch(() => ({}));
      showToast(`连接失败: ${error.error?.message || response.status}`, 'error');
    }
  } catch (error) {
    showToast(`连接失败: ${error.message}`, 'error');
  } finally {
    testBtn.textContent = originalText;
    testBtn.disabled = false;
  }
}

// 切换密钥可见性
function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  initI18n();
  await loadSettings();

  // 事件绑定
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('testApi').addEventListener('click', testApiConnection);
  document.getElementById('toggleApiKey').addEventListener('click', toggleApiKeyVisibility);

  // 暗色模式实时预览
  document.querySelectorAll('input[name="darkMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      applyDarkMode(e.target.value);
    });
  });

  // 监听系统暗色模式变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentMode = document.querySelector('input[name="darkMode"]:checked').value;
    if (currentMode === 'auto') {
      applyDarkMode('auto');
    }
  });

  // 快捷键保存
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSettings();
    }
  });
});
