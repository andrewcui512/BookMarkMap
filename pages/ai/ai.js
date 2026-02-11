/**
 * AI classify page
 */

const PROVIDER_PRESETS = [
  {
    id: 'kimi',
    label: 'Kimi（月之暗面 Moonshot）',
    apiEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat'
  },
  {
    id: 'glm',
    label: 'GLM（智谱 BigModel）',
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4'
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    apiEndpoint: '',
    model: ''
  }
];

const UI_STATE = {
  settings: null,
  selectedConfigId: null,
  editingConfigId: null,
  lastClassify: {
    results: [],
    skipped: 0,
    usage: null
  }
};

function now() {
  return Date.now();
}

function randomId() {
  return `cfg_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function maskKey(key) {
  const k = normalizeStr(key);
  if (!k) return '';
  if (k.length <= 8) return `${k.slice(0, 2)}****${k.slice(-2)}`;
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

function formatTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function showToast(message, type = 'default', duration = 2200) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (type !== 'default' ? ` ${type}` : '');
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.style.display = 'flex';
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.style.display = 'none';
}

function setupModalDismiss(modalEl) {
  if (!modalEl) return;
  const backdrop = modalEl.querySelector('.modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => closeModal(modalEl));
  modalEl.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => closeModal(modalEl));
  });
}

function getProviderLabel(providerId) {
  return PROVIDER_PRESETS.find(p => p.id === providerId)?.label || providerId || '—';
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

  // Migrate legacy single config into aiConfigs when needed
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

  // Normalize configs
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

  // Choose active if missing
  if (!out.activeAiConfigId && out.aiConfigs.length > 0) {
    out.activeAiConfigId = out.aiConfigs[0].id;
    changed.value = true;
  }
  if (out.activeAiConfigId && !out.aiConfigs.some(c => c.id === out.activeAiConfigId)) {
    out.activeAiConfigId = out.aiConfigs[0]?.id || '';
    changed.value = true;
  }

  // Mirror active into legacy fields for compatibility
  const active = out.aiConfigs.find(c => c.id === out.activeAiConfigId);
  if (active) {
    if (out.apiEndpoint !== active.apiEndpoint) { out.apiEndpoint = active.apiEndpoint; changed.value = true; }
    if (out.apiKey !== active.apiKey) { out.apiKey = active.apiKey; changed.value = true; }
    if (out.model !== active.model) { out.model = active.model; changed.value = true; }
  }

  return { settings: out, changed: changed.value };
}

async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  const raw = result.settings || {};
  const migrated = normalizeAiConfigs(raw);
  if (migrated.changed) {
    await chrome.storage.sync.set({ settings: migrated.settings });
  }
  UI_STATE.settings = migrated.settings;
}

async function saveSettings(settings) {
  const migrated = normalizeAiConfigs(settings);
  UI_STATE.settings = migrated.settings;
  await chrome.storage.sync.set({ settings: migrated.settings });
}

function getActiveConfig() {
  const settings = UI_STATE.settings || {};
  const activeId = settings.activeAiConfigId;
  return settings.aiConfigs?.find(c => c.id === activeId) || null;
}

function isConfigReady(config) {
  if (!config) return false;
  return !!normalizeStr(config.apiEndpoint) && !!normalizeStr(config.apiKey);
}

function renderGuideIfNeeded() {
  const guideCard = document.getElementById('guideCard');
  const classifyCard = document.getElementById('classifyCard');
  const warningEl = document.getElementById('classifyWarning');
  const activeLineEl = document.getElementById('currentConfigLine');
  const settings = UI_STATE.settings || {};
  const active = getActiveConfig();
  const activeReady = isConfigReady(active);
  const anyReady = Array.isArray(settings.aiConfigs) && settings.aiConfigs.some(c => isConfigReady(c));

  if (activeLineEl) {
    if (!active) {
      activeLineEl.textContent = '当前配置：—';
    } else {
      const name = normalizeStr(active.name) || getProviderLabel(active.provider);
      const model = normalizeStr(active.model) || '（未填模型）';
      activeLineEl.textContent = `当前配置：${name} · ${model}`;
    }
  }

  guideCard.style.display = anyReady ? 'none' : 'block';

  if (!activeReady) {
    warningEl.style.display = 'block';
    warningEl.textContent = anyReady
      ? '当前配置未完整。请在上方选择一个可用配置并点击“设为当前”，然后再开始分类。'
      : '请先在上方添加并保存一个可用的 API 配置，然后再开始分类。';
  } else {
    warningEl.style.display = 'none';
  }

  classifyCard.querySelectorAll('button, input, select').forEach(el => {
    if (el.id === 'btnReloadGuide') return;
    if (el.id === 'btnAddConfig') return;
    el.disabled = !activeReady;
  });
}

async function loadGuideContent() {
  const guideEl = document.getElementById('guideContent');
  try {
    const res = await fetch(chrome.runtime.getURL('ai_guide.md'));
    const text = await res.text();
    guideEl.textContent = text;
  } catch (error) {
    guideEl.textContent = `无法加载 ai_guide.md：${error.message}`;
  }
}

function renderConfigList() {
  const listEl = document.getElementById('configList');
  const settings = UI_STATE.settings || {};
  const configs = settings.aiConfigs || [];
  const selectedId = UI_STATE.selectedConfigId || settings.activeAiConfigId || null;

  if (configs.length === 0) {
    listEl.innerHTML = '<div class="placeholder"><div class="placeholder-title">暂无配置</div><div class="placeholder-desc">点击右上角“添加配置”创建。</div></div>';
    return;
  }

  listEl.innerHTML = '';

  configs.forEach(cfg => {
    const item = document.createElement('div');
    item.className = 'config-item'
      + (cfg.id === settings.activeAiConfigId ? ' active' : '')
      + (cfg.id === selectedId ? ' selected' : '');
    item.dataset.id = cfg.id;

    const top = document.createElement('div');
    top.className = 'config-item-top';

    const title = document.createElement('div');
    title.className = 'config-item-title';

    const name = document.createElement('div');
    name.className = 'config-name';
    const displayName = normalizeStr(cfg.name) || getProviderLabel(cfg.provider);
    name.textContent = displayName;

    const meta = document.createElement('div');
    meta.className = 'config-meta';
    const model = normalizeStr(cfg.model) || '（未填模型）';
    meta.textContent = `${getProviderLabel(cfg.provider)} · ${model}`;

    title.appendChild(name);
    title.appendChild(meta);

    const badge = document.createElement('span');
    badge.className = 'pill' + (cfg.id === settings.activeAiConfigId ? ' primary' : '');
    badge.textContent = cfg.id === settings.activeAiConfigId ? '当前' : '可切换';

    top.appendChild(title);
    top.appendChild(badge);

    const bottom = document.createElement('div');
    bottom.className = 'config-item-bottom';

    const stats = cfg.stats || {};
    const calls = typeof stats.calls === 'number' ? stats.calls : 0;
    const tokens = typeof stats.totalTokens === 'number' ? stats.totalTokens : 0;
    const left = document.createElement('span');
    left.className = 'pill';
    left.textContent = `调用 ${calls} 次`;

    const right = document.createElement('span');
    right.className = 'pill';
    right.textContent = `tokens ${tokens}`;

    bottom.appendChild(left);
    bottom.appendChild(right);

    item.appendChild(top);
    item.appendChild(bottom);

    item.addEventListener('click', async () => {
      UI_STATE.selectedConfigId = cfg.id;
      renderConfigList();
      renderConfigDetail();
    });

    listEl.appendChild(item);
  });
}

function getSelectedConfig() {
  const settings = UI_STATE.settings || {};
  const configs = settings.aiConfigs || [];
  const id = UI_STATE.selectedConfigId || settings.activeAiConfigId;
  return configs.find(c => c.id === id) || null;
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return '—';
  const lines = history
    .slice(-8)
    .reverse()
    .map(h => {
      const when = formatTime(h.at);
      const action = h.action || 'call';
      const model = h.model || '—';
      const tokens = h.totalTokens ?? '—';
      return `${when} · ${action} · ${model} · tokens ${tokens}`;
    });
  return lines.join('\n');
}

function renderConfigDetail() {
  const detailEl = document.getElementById('configDetail');
  const settings = UI_STATE.settings || {};
  const cfg = getSelectedConfig();

  if (!cfg) {
    detailEl.innerHTML = '<div class="placeholder"><div class="placeholder-title">请选择一个配置</div><div class="placeholder-desc">在左侧列表选择后可查看详情并测试连接。</div></div>';
    return;
  }

  const active = cfg.id === settings.activeAiConfigId;
  const stats = cfg.stats || {};

  const endpoint = normalizeStr(cfg.apiEndpoint) || '—';
  const model = normalizeStr(cfg.model) || '—';
  const keyMasked = cfg.apiKey ? maskKey(cfg.apiKey) : '—';

  const ready = isConfigReady(cfg);
  const statusPill = ready
    ? `<span class="pill primary">可用</span>`
    : `<span class="pill">未配置完整</span>`;

  detailEl.innerHTML = `
    <div class="detail-grid">
      <div class="detail-row">
        <div class="detail-label">当前使用</div>
        <div class="detail-value">${active ? '是' : '否'} ${active ? '<span class="pill primary">当前</span>' : '<span class="pill">可切换</span>'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">状态</div>
        <div class="detail-value">${statusPill}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">服务提供商</div>
        <div class="detail-value">${getProviderLabel(cfg.provider)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">名称</div>
        <div class="detail-value">${normalizeStr(cfg.name) || '—'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">API 端点</div>
        <div class="detail-value">${endpoint}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">模型</div>
        <div class="detail-value">${model}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">API Key</div>
        <div class="detail-value">${keyMasked} <button class="btn btn-ghost btn-sm" id="btnRevealKey">显示</button></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">更新时间</div>
        <div class="detail-value">${formatTime(cfg.updatedAt)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">调用次数</div>
        <div class="detail-value">${stats.calls ?? 0}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">累计 tokens</div>
        <div class="detail-value">${stats.totalTokens ?? 0}（prompt ${stats.promptTokens ?? 0} / completion ${stats.completionTokens ?? 0}）</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">最近使用</div>
        <div class="detail-value">${formatTime(stats.lastUsedAt)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">最近错误</div>
        <div class="detail-value">${stats.lastError ? `${stats.lastError}（${formatTime(stats.lastErrorAt)}）` : '—'}</div>
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn btn-secondary" id="btnSetActive" ${active ? 'disabled' : ''}>设为当前</button>
      <button class="btn btn-secondary" id="btnTestConfig" ${ready ? '' : 'disabled'}>测试连接</button>
      <button class="btn btn-ghost" id="btnEditConfig">编辑</button>
      <button class="btn btn-danger" id="btnDeleteConfig">删除</button>
    </div>

    <div class="meta" style="margin-top: 12px;">
      <div style="font-weight: 600; margin-bottom: 6px;">最近使用记录（最多展示 8 条）</div>
      <pre style="margin: 0; white-space: pre-wrap;">${renderHistory(stats.history)}</pre>
    </div>
  `;

  detailEl.querySelector('#btnRevealKey').addEventListener('click', () => {
    const isVisible = detailEl.querySelector('#btnRevealKey').dataset.visible === '1';
    const btn = detailEl.querySelector('#btnRevealKey');
    btn.dataset.visible = isVisible ? '0' : '1';
    btn.textContent = isVisible ? '显示' : '隐藏';
    const keyEl = btn.parentElement;
    const shown = isVisible ? keyMasked : (cfg.apiKey || '—');
    keyEl.childNodes[0].textContent = shown + ' ';
  });

  detailEl.querySelector('#btnSetActive').addEventListener('click', async () => {
    const s = UI_STATE.settings;
    s.activeAiConfigId = cfg.id;
    await saveSettings(s);
    renderConfigList();
    renderConfigDetail();
    renderGuideIfNeeded();
    showToast('已切换为当前配置', 'success');
  });

  detailEl.querySelector('#btnEditConfig').addEventListener('click', () => openConfigModal(cfg.id));
  detailEl.querySelector('#btnDeleteConfig').addEventListener('click', async () => deleteConfig(cfg.id));
  detailEl.querySelector('#btnTestConfig').addEventListener('click', async () => testSelectedConfig(cfg.id));
}

function renderProviderOptions() {
  const select = document.getElementById('configProvider');
  select.innerHTML = '';
  PROVIDER_PRESETS.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.label;
    select.appendChild(option);
  });
}

function fillModalFromPreset(providerId, mode = 'maybe') {
  const preset = PROVIDER_PRESETS.find(p => p.id === providerId);
  if (!preset) return;

  const endpointInput = document.getElementById('configEndpoint');
  const modelInput = document.getElementById('configModel');

  if (mode === 'force') {
    endpointInput.value = preset.apiEndpoint || '';
    modelInput.value = preset.model || '';
    return;
  }

  if (!normalizeStr(endpointInput.value)) endpointInput.value = preset.apiEndpoint || '';
  if (!normalizeStr(modelInput.value)) modelInput.value = preset.model || '';
}

function openConfigModal(configId = null) {
  const modal = document.getElementById('modalConfig');
  const title = document.getElementById('modalTitle');
  const nameInput = document.getElementById('configName');
  const providerSelect = document.getElementById('configProvider');
  const endpointInput = document.getElementById('configEndpoint');
  const modelInput = document.getElementById('configModel');
  const keyInput = document.getElementById('configKey');

  UI_STATE.editingConfigId = configId;

  if (!configId) {
    title.textContent = '添加配置';
    nameInput.value = '';
    providerSelect.value = 'deepseek';
    endpointInput.value = '';
    modelInput.value = '';
    keyInput.value = '';
    fillModalFromPreset(providerSelect.value, 'force');
  } else {
    title.textContent = '编辑配置';
    const cfg = (UI_STATE.settings.aiConfigs || []).find(c => c.id === configId);
    nameInput.value = cfg?.name || '';
    providerSelect.value = cfg?.provider || 'custom';
    endpointInput.value = cfg?.apiEndpoint || '';
    modelInput.value = cfg?.model || '';
    keyInput.value = cfg?.apiKey || '';
  }

  openModal(modal);
}

async function deleteConfig(configId) {
  if (!confirm('确定要删除该配置吗？')) return;

  const s = UI_STATE.settings;
  s.aiConfigs = (s.aiConfigs || []).filter(c => c.id !== configId);
  if (s.activeAiConfigId === configId) {
    s.activeAiConfigId = s.aiConfigs[0]?.id || '';
  }
  if (UI_STATE.selectedConfigId === configId) {
    UI_STATE.selectedConfigId = s.activeAiConfigId || null;
  }

  await saveSettings(s);
  renderConfigList();
  renderConfigDetail();
  renderGuideIfNeeded();
  showToast('已删除配置', 'success');
}

async function saveConfigFromModal() {
  const s = UI_STATE.settings;
  const name = normalizeStr(document.getElementById('configName').value);
  const provider = document.getElementById('configProvider').value;
  const apiEndpoint = normalizeStr(document.getElementById('configEndpoint').value);
  const model = normalizeStr(document.getElementById('configModel').value);
  const apiKey = normalizeStr(document.getElementById('configKey').value);

  if (!apiEndpoint || !apiEndpoint.includes('/chat/completions')) {
    showToast('请填写包含 /chat/completions 的完整端点', 'error');
    return;
  }

  if (!apiKey) {
    showToast('请填写 API Key', 'error');
    return;
  }

  const editingId = UI_STATE.editingConfigId;
  if (!Array.isArray(s.aiConfigs)) s.aiConfigs = [];

  if (!editingId) {
    const id = randomId();
    s.aiConfigs.push(
      ensureConfigStats({
        id,
        name,
        provider,
        apiEndpoint,
        apiKey,
        model,
        createdAt: now(),
        updatedAt: now()
      })
    );
    if (!s.activeAiConfigId) s.activeAiConfigId = id;
    UI_STATE.selectedConfigId = id;
  } else {
    s.aiConfigs = s.aiConfigs.map(cfg => {
      if (cfg.id !== editingId) return cfg;
      const updated = ensureConfigStats({
        ...cfg,
        name,
        provider,
        apiEndpoint,
        apiKey,
        model,
        updatedAt: now()
      });
      return updated;
    });
    UI_STATE.selectedConfigId = editingId;
  }

  await saveSettings(s);
  closeModal(document.getElementById('modalConfig'));
  renderConfigList();
  renderConfigDetail();
  renderGuideIfNeeded();
  showToast('配置已保存', 'success');
}

function collectFoldersForUi(nodes) {
  const result = [];

  function walk(list, depth) {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node) continue;
      if (node.id === '0') {
        if (node.children) walk(node.children, depth);
        continue;
      }

      const isFolder = !node.url;
      if (isFolder) {
        result.push({
          id: node.id,
          title: node.title || '未命名文件夹',
          depth
        });
      }
      if (node.children) walk(node.children, depth + 1);
    }
  }

  walk(nodes, 0);
  return result;
}

async function populateParentFolders() {
  const select = document.getElementById('classifyParent');
  if (!select) return;

  select.innerHTML = '';

  try {
    const tree = await BookmarkManager.getAll();
    const folders = collectFoldersForUi(tree);
    folders.forEach(f => {
      const option = document.createElement('option');
      option.value = f.id;
      option.textContent = `${'  '.repeat(f.depth)}${f.title}`;
      select.appendChild(option);
    });

    const preferred = folders.find(f => f.id === '2');
    if (preferred) select.value = preferred.id;
  } catch (error) {
    console.error('Failed to load folders:', error);
    showToast('加载文件夹失败', 'error');
  }
}

function sanitizeCategory(category) {
  const s = normalizeStr(category);
  if (!s) return '';
  // Keep it short and filesystem-friendly (bookmarks allow many chars, but we avoid weird control chars).
  const cleaned = s.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 50);
  return cleaned;
}

async function getOrCreateFolderUnderParent(parentId, title, cache) {
  const key = `${parentId}:${title}`;
  if (cache.has(key)) return cache.get(key);

  const children = await BookmarkManager.getChildren(parentId);
  const existing = children.find(c => !c.url && c.title === title);
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const created = await BookmarkManager.createFolder(parentId, title);
  cache.set(key, created.id);
  return created.id;
}

async function callBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => resolve(resp));
  });
}

async function testSelectedConfig(configId) {
  const settings = UI_STATE.settings;
  const cfg = (settings.aiConfigs || []).find(c => c.id === configId);
  if (!cfg) return;

  const resp = await callBackground({ type: 'AI_TEST', configId });
  if (!resp) {
    showToast('测试失败：无响应', 'error');
    return;
  }
  if (resp.error) {
    showToast(`测试失败：${resp.error}`, 'error');
    await loadSettings();
    renderConfigList();
    renderConfigDetail();
    return;
  }

  showToast('连接成功', 'success');
  await loadSettings();
  renderConfigList();
  renderConfigDetail();
}

async function runClassify() {
  const active = getActiveConfig();
  if (!isConfigReady(active)) {
    showToast('请先配置可用的 API', 'error');
    return;
  }

  const limit = Math.max(1, Math.min(200, Number(document.getElementById('classifyLimit').value) || 60));
  const runBtn = document.getElementById('btnRunClassify');
  const applyBtn = document.getElementById('btnApplyClassify');
  const metaEl = document.getElementById('classifyMeta');
  const resultsEl = document.getElementById('classifyResults');

  runBtn.disabled = true;
  applyBtn.disabled = true;
  metaEl.style.display = 'none';
  resultsEl.innerHTML = '';

  try {
    const tree = await BookmarkManager.getAll();
    const bookmarks = BookmarkManager.flatten(tree);
    const selected = bookmarks.slice(0, limit).map(b => ({ id: b.id, title: b.title, url: b.url }));

    if (selected.length === 0) {
      showToast('暂无可分类的书签', 'warning');
      return;
    }

    showToast('正在生成分类建议…', 'default', 1200);

    const resp = await callBackground({ type: 'AI_CLASSIFY', bookmarks: selected });
    if (!resp || resp.error) {
      throw new Error(resp?.error || 'AI 返回异常');
    }

    const classifications = Array.isArray(resp.classifications) ? resp.classifications : [];
    const byId = new Map(classifications.filter(r => r && r.id).map(r => [String(r.id), r]));
    const byUrl = new Map(classifications.filter(r => r && r.url).map(r => [String(r.url), r]));

    const results = [];
    let skipped = 0;
    for (const b of selected) {
      const r = byId.get(String(b.id)) || byUrl.get(String(b.url));
      const category = sanitizeCategory(r?.category || '');
      if (!category) {
        skipped++;
        continue;
      }
      results.push({
        id: b.id,
        title: b.title || '',
        url: b.url || '',
        category,
        checked: true
      });
    }

    UI_STATE.lastClassify = { results, skipped, usage: resp.usage || null };
    renderClassifyResults();

    const usage = resp.usage;
    const usageText = usage && typeof usage === 'object'
      ? `本次用量：prompt ${usage.prompt_tokens ?? '—'} / completion ${usage.completion_tokens ?? '—'} / total ${usage.total_tokens ?? usage.totalTokens ?? '—'}`
      : '本次用量：—';

    metaEl.style.display = 'block';
    metaEl.textContent = `生成建议：${results.length} 条；跳过：${skipped} 条。${usageText}`;
    applyBtn.disabled = results.length === 0;

    await loadSettings();
    renderConfigList();
    renderConfigDetail();
  } catch (error) {
    console.error('AI classify failed:', error);
    showToast(error.message || 'AI 分类失败', 'error');
  } finally {
    runBtn.disabled = false;
  }
}

function renderClassifyResults() {
  const resultsEl = document.getElementById('classifyResults');
  const applyBtn = document.getElementById('btnApplyClassify');
  const results = UI_STATE.lastClassify.results || [];

  if (results.length === 0) {
    resultsEl.innerHTML = '<div style="padding: 14px; color: var(--text-secondary);">暂无结果</div>';
    applyBtn.disabled = true;
    return;
  }

  resultsEl.innerHTML = '';

  results.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'result-row';

    const checkboxWrap = document.createElement('div');
    checkboxWrap.className = 'result-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!r.checked;
    checkbox.addEventListener('change', () => {
      r.checked = checkbox.checked;
      applyBtn.disabled = UI_STATE.lastClassify.results.filter(x => x.checked).length === 0;
    });
    checkboxWrap.appendChild(checkbox);

    const title = document.createElement('div');
    title.className = 'result-title';
    title.title = r.title || r.url;
    title.textContent = r.title || '（无标题）';

    const url = document.createElement('div');
    url.className = 'result-url';
    url.title = r.url;
    url.textContent = r.url;

    const category = document.createElement('div');
    category.className = 'result-category';
    category.textContent = r.category;

    row.appendChild(checkboxWrap);
    row.appendChild(title);
    row.appendChild(url);
    row.appendChild(category);

    resultsEl.appendChild(row);
  });
}

async function applyClassify() {
  const selected = (UI_STATE.lastClassify.results || []).filter(r => r.checked);
  if (selected.length === 0) {
    showToast('请先勾选要应用的条目', 'warning');
    return;
  }

  const parentId = document.getElementById('classifyParent').value;
  if (!parentId) {
    showToast('请选择分类文件夹创建位置', 'warning');
    return;
  }

  if (!confirm(`将移动 ${selected.length} 个书签到分类文件夹，是否继续？`)) {
    return;
  }

  const applyBtn = document.getElementById('btnApplyClassify');
  const runBtn = document.getElementById('btnRunClassify');
  applyBtn.disabled = true;
  runBtn.disabled = true;

  const folderCache = new Map();
  let moved = 0;
  let failed = 0;

  try {
    // group by category for better folder caching
    const groups = new Map();
    selected.forEach(r => {
      if (!groups.has(r.category)) groups.set(r.category, []);
      groups.get(r.category).push(r.id);
    });

    for (const [category, ids] of groups.entries()) {
      const folderId = await getOrCreateFolderUnderParent(parentId, category, folderCache);
      for (const id of ids) {
        try {
          await BookmarkManager.move(id, folderId);
          moved++;
        } catch (error) {
          failed++;
          console.error('Move failed:', id, error);
        }
      }
    }

    showToast(`已移动 ${moved} 个，失败 ${failed} 个`, failed ? 'warning' : 'success', 2600);
  } finally {
    applyBtn.disabled = false;
    runBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  setupModalDismiss(document.getElementById('modalConfig'));
  renderProviderOptions();

  await loadSettings();
  UI_STATE.selectedConfigId = UI_STATE.settings.activeAiConfigId || null;

  renderConfigList();
  renderConfigDetail();
  renderGuideIfNeeded();
  await loadGuideContent();
  await populateParentFolders();

  document.getElementById('btnReloadGuide').addEventListener('click', loadGuideContent);

  document.getElementById('btnAddConfig').addEventListener('click', () => openConfigModal(null));
  document.getElementById('btnSaveConfig').addEventListener('click', saveConfigFromModal);

  const providerSelect = document.getElementById('configProvider');
  providerSelect.addEventListener('change', (e) => fillModalFromPreset(e.target.value, 'maybe'));

  document.getElementById('toggleConfigKey').addEventListener('click', () => {
    const input = document.getElementById('configKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btnRefreshFolders').addEventListener('click', populateParentFolders);
  document.getElementById('btnRunClassify').addEventListener('click', runClassify);
  document.getElementById('btnApplyClassify').addEventListener('click', applyClassify);

  document.getElementById('btnOpenSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings/settings.html') });
  });
  document.getElementById('btnOpenMain').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/main/main.html') });
  });
});
