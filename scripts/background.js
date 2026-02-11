/**
 * Background Service Worker
 * 后台服务脚本
 */

// 扩展安装/更新时执行
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Bookmark Tree 扩展已安装');

    // 初始化默认设置
    chrome.storage.sync.set({
      settings: {
        darkMode: 'auto',
        language: 'auto',
        apiEndpoint: '',
        apiKey: '',
        model: '',
        aiConfigs: [],
        activeAiConfigId: '',
        firewallWhitelist: [
          'google.com',
          'youtube.com',
          'twitter.com',
          'facebook.com',
          'instagram.com',
          'github.com',
          'stackoverflow.com',
          'medium.com',
          'reddit.com',
          'wikipedia.org',
          'whatsapp.com',
          'telegram.org',
          'discord.com'
        ]
      }
    });
  } else if (details.reason === 'update') {
    console.log('Bookmark Tree 扩展已更新到版本', chrome.runtime.getManifest().version);
  }
});

// 监听来自 popup 或其他页面的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'CHECK_LINK':
      checkLink(message.url)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true; // 保持消息通道开启以支持异步响应

    case 'CHECK_LINKS_BATCH':
      checkLinksBatch(message.urls)
        .then(results => sendResponse(results))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    case 'AI_CLASSIFY':
      classifyBookmarks(message.bookmarks)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    case 'AI_TEST':
      testAiConnection(message.configId)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    case 'GET_SETTINGS':
      chrome.storage.sync.get(['settings'], (result) => {
        sendResponse(result.settings || {});
      });
      return true;

    case 'SAVE_SETTINGS':
      chrome.storage.sync.set({ settings: message.settings }, () => {
        sendResponse({ success: true });
      });
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

function now() {
  return Date.now();
}

function normalizeStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function randomId() {
  return `cfg_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function ensureConfigStats(config) {
  if (!config.stats || typeof config.stats !== 'object') config.stats = {};
  if (!Array.isArray(config.stats.history)) config.stats.history = [];
  if (typeof config.stats.calls !== 'number') config.stats.calls = 0;
  if (typeof config.stats.promptTokens !== 'number') config.stats.promptTokens = 0;
  if (typeof config.stats.completionTokens !== 'number') config.stats.completionTokens = 0;
  if (typeof config.stats.totalTokens !== 'number') config.stats.totalTokens = 0;
  return config;
}

function normalizeAiConfigs(settings) {
  if (!settings || typeof settings !== 'object') settings = {};

  const changed = { value: false };
  const out = { ...settings };

  const legacyEndpoint = normalizeStr(out.apiEndpoint);
  const legacyKey = normalizeStr(out.apiKey);
  const legacyModel = normalizeStr(out.model);

  if (!Array.isArray(out.aiConfigs)) out.aiConfigs = [];
  if (typeof out.activeAiConfigId !== 'string') out.activeAiConfigId = '';

  if (out.aiConfigs.length === 0 && (legacyEndpoint || legacyKey || legacyModel)) {
    const id = randomId();
    out.aiConfigs = [
      ensureConfigStats({
        id,
        name: '默认配置',
        provider: 'custom',
        apiEndpoint: legacyEndpoint,
        apiKey: legacyKey,
        model: legacyModel,
        createdAt: now(),
        updatedAt: now()
      })
    ];
    out.activeAiConfigId = id;
    changed.value = true;
  }

  out.aiConfigs = out.aiConfigs.map(cfg => {
    const config = { ...cfg };
    if (!config.id) { config.id = randomId(); changed.value = true; }
    if (!config.provider) config.provider = 'custom';
    if (typeof config.name !== 'string') config.name = '';
    if (typeof config.apiEndpoint !== 'string') config.apiEndpoint = '';
    if (typeof config.apiKey !== 'string') config.apiKey = '';
    if (typeof config.model !== 'string') config.model = '';
    if (typeof config.createdAt !== 'number') { config.createdAt = now(); changed.value = true; }
    config.updatedAt = typeof config.updatedAt === 'number' ? config.updatedAt : config.createdAt;
    ensureConfigStats(config);
    return config;
  });

  if (!out.activeAiConfigId && out.aiConfigs.length > 0) {
    out.activeAiConfigId = out.aiConfigs[0].id;
    changed.value = true;
  }
  if (out.activeAiConfigId && !out.aiConfigs.some(c => c.id === out.activeAiConfigId)) {
    out.activeAiConfigId = out.aiConfigs[0]?.id || '';
    changed.value = true;
  }

  const active = out.aiConfigs.find(c => c.id === out.activeAiConfigId);
  if (active) {
    if (out.apiEndpoint !== active.apiEndpoint) { out.apiEndpoint = active.apiEndpoint; changed.value = true; }
    if (out.apiKey !== active.apiKey) { out.apiKey = active.apiKey; changed.value = true; }
    if (out.model !== active.model) { out.model = active.model; changed.value = true; }
  }

  return { settings: out, changed: changed.value };
}

async function getNormalizedSettings() {
  const { settings } = await chrome.storage.sync.get(['settings']);
  const migrated = normalizeAiConfigs(settings || {});
  if (migrated.changed) {
    await chrome.storage.sync.set({ settings: migrated.settings });
  }
  return migrated.settings;
}

function extractJsonFromText(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fallthrough
    }
  }

  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
}

function pushHistory(stats, entry) {
  if (!Array.isArray(stats.history)) stats.history = [];
  stats.history.push(entry);
  if (stats.history.length > 30) stats.history = stats.history.slice(-30);
}

async function updateAiConfigStats(configId, updater) {
  if (!configId) return;
  const settings = await getNormalizedSettings();
  const idx = (settings.aiConfigs || []).findIndex(c => c.id === configId);
  if (idx < 0) return;

  const cfg = ensureConfigStats({ ...settings.aiConfigs[idx] });
  updater(cfg.stats, cfg);
  settings.aiConfigs[idx] = cfg;
  await chrome.storage.sync.set({ settings });
}

async function getAiConfigByIdOrActive(configId = null) {
  const settings = await getNormalizedSettings();
  const configs = settings.aiConfigs || [];
  let cfg = null;
  if (configId) cfg = configs.find(c => c.id === configId) || null;
  if (!cfg) cfg = configs.find(c => c.id === settings.activeAiConfigId) || null;
  return { settings, config: cfg };
}

function assertAiConfigReady(config) {
  if (!config) throw new Error('API not configured');
  if (!normalizeStr(config.apiEndpoint) || !normalizeStr(config.apiKey)) {
    throw new Error('API not configured');
  }
}

/**
 * 检测单个链接是否有效
 * @param {string} url 要检测的 URL
 * @returns {Promise<Object>} 检测结果
 */
async function checkLink(url) {
  try {
    // 获取防火墙白名单
    const { settings } = await chrome.storage.sync.get(['settings']);
    const whitelist = settings?.firewallWhitelist || [];

    // 检查是否在白名单中
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    const isWhitelisted = whitelist.some(w => domain.includes(w) || w.includes(domain));

    if (isWhitelisted) {
      return {
        url,
        status: 'whitelisted',
        message: 'possiblyBlocked'
      };
    }

    // 发送 HEAD 请求检测
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors', // 避免 CORS 问题
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // no-cors 模式下无法获取状态码，只能判断是否成功
    return {
      url,
      status: 'valid',
      message: 'OK'
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        url,
        status: 'timeout',
        message: 'Request timeout'
      };
    }

    // 网络错误可能是被墙或服务器关闭
    return {
      url,
      status: 'invalid',
      message: error.message
    };
  }
}

/**
 * 批量检测链接
 * @param {Array<string>} urls URL 列表
 * @returns {Promise<Array>} 检测结果列表
 */
async function checkLinksBatch(urls) {
  const results = [];
  const batchSize = 5; // 并发数量

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(url => checkLink(url))
    );
    results.push(...batchResults);

    // 发送进度更新
    chrome.runtime.sendMessage({
      type: 'CHECK_PROGRESS',
      checked: results.length,
      total: urls.length
    }).catch(() => {}); // 忽略无接收者的错误
  }

  return results;
}

/**
 * 使用 AI 分类书签
 * @param {Array} bookmarks 书签列表
 * @returns {Promise<Object>} 分类结果
 */
async function classifyBookmarks(bookmarks) {
  const { config } = await getAiConfigByIdOrActive(null);
  assertAiConfigReady(config);

  // 准备请求数据
  const bookmarkData = bookmarks.map(b => ({
    id: b.id,
    title: b.title,
    url: b.url
  }));

  const prompt = `你是一个书签分类助手。请根据以下书签的标题和URL，为每个书签建议一个合适的分类文件夹名称。

书签列表：
${JSON.stringify(bookmarkData, null, 2)}

请以 JSON 格式返回结果，格式如下：
{
  "classifications": [
    { "id": "书签ID", "url": "书签URL", "category": "建议的分类名称" }
  ]
}

分类名称应该简洁明了，如：开发工具、学习资源、新闻媒体、社交娱乐、购物网站等。`;

  try {
    const usedModel = normalizeStr(config.model) || 'gpt-3.5-turbo';

    const response = await fetch(config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: usedModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errMsg = errJson?.error?.message || errJson?.message || `API error: ${response.status}`;
      await updateAiConfigStats(config.id, (stats) => {
        stats.lastError = String(errMsg);
        stats.lastErrorAt = now();
        pushHistory(stats, { at: now(), action: 'classify_error', model: usedModel, totalTokens: null });
      });
      throw new Error(errMsg);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.content || '';
    const parsed = extractJsonFromText(content);
    if (!parsed) {
      const errMsg = 'Invalid API response format';
      await updateAiConfigStats(config.id, (stats) => {
        stats.lastError = errMsg;
        stats.lastErrorAt = now();
        pushHistory(stats, { at: now(), action: 'classify_error', model: usedModel, totalTokens: null });
      });
      throw new Error(errMsg);
    }

    const usage = data?.usage || null;
    const promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? null;
    const completionTokens = usage?.completion_tokens ?? usage?.completionTokens ?? null;
    const totalTokens = usage?.total_tokens ?? usage?.totalTokens ?? null;

    await updateAiConfigStats(config.id, (stats) => {
      stats.calls += 1;
      if (typeof promptTokens === 'number') stats.promptTokens += promptTokens;
      if (typeof completionTokens === 'number') stats.completionTokens += completionTokens;
      if (typeof totalTokens === 'number') stats.totalTokens += totalTokens;
      stats.lastUsedAt = now();
      stats.lastModel = usedModel;
      pushHistory(stats, { at: now(), action: 'classify', model: usedModel, totalTokens });
      if (stats.lastError) {
        delete stats.lastError;
        delete stats.lastErrorAt;
      }
    });

    return {
      ...parsed,
      usage,
      model: usedModel,
      configId: config.id
    };
  } catch (error) {
    console.error('AI classification error:', error);
    await updateAiConfigStats(config.id, (stats) => {
      stats.lastError = String(error.message || error);
      stats.lastErrorAt = now();
    });
    throw error;
  }
}

/**
 * 测试 AI 连接（可指定 configId，否则使用当前配置）
 * @param {string|null} configId
 * @returns {Promise<Object>}
 */
async function testAiConnection(configId = null) {
  const { config } = await getAiConfigByIdOrActive(configId);
  assertAiConfigReady(config);

  const usedModel = normalizeStr(config.model) || 'gpt-3.5-turbo';

  try {
    const response = await fetch(config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: usedModel,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 8,
        temperature: 0
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errMsg = errJson?.error?.message || errJson?.message || `API error: ${response.status}`;
      await updateAiConfigStats(config.id, (stats) => {
        stats.lastError = String(errMsg);
        stats.lastErrorAt = now();
        pushHistory(stats, { at: now(), action: 'test_error', model: usedModel, totalTokens: null });
      });
      throw new Error(errMsg);
    }

    const data = await response.json().catch(() => ({}));
    const usage = data?.usage || null;
    const promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? null;
    const completionTokens = usage?.completion_tokens ?? usage?.completionTokens ?? null;
    const totalTokens = usage?.total_tokens ?? usage?.totalTokens ?? null;

    await updateAiConfigStats(config.id, (stats) => {
      stats.calls += 1;
      if (typeof promptTokens === 'number') stats.promptTokens += promptTokens;
      if (typeof completionTokens === 'number') stats.completionTokens += completionTokens;
      if (typeof totalTokens === 'number') stats.totalTokens += totalTokens;
      stats.lastUsedAt = now();
      stats.lastModel = usedModel;
      pushHistory(stats, { at: now(), action: 'test', model: usedModel, totalTokens });
      if (stats.lastError) {
        delete stats.lastError;
        delete stats.lastErrorAt;
      }
    });

    return { success: true, usage, model: usedModel, configId: config.id };
  } catch (error) {
    console.error('AI test error:', error);
    await updateAiConfigStats(config.id, (stats) => {
      stats.lastError = String(error.message || error);
      stats.lastErrorAt = now();
    });
    throw error;
  }
}

// 监听书签变化
chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  console.log('Bookmark created:', bookmark);
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  console.log('Bookmark removed:', id);
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  console.log('Bookmark changed:', id, changeInfo);
});

chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
  console.log('Bookmark moved:', id, moveInfo);
});
