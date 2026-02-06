/**
 * Main page logic (full-page bookmark manager)
 */

function getMessage(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = getMessage(el.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = getMessage(el.dataset.i18nPlaceholder);
  });
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

function showState(stateId, opts = {}) {
  const { emptyTitle } = opts;

  const states = ['loadingState', 'emptyState', 'noResultsState', 'bookmarkTree'];
  states.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = id === stateId ? (id === 'bookmarkTree' ? 'block' : 'flex') : 'none';
  });

  if (stateId === 'emptyState' && emptyTitle) {
    const titleEl = document.querySelector('#emptyState .empty-state-title');
    if (titleEl) titleEl.textContent = emptyTitle;
  }
}

function setActiveView(view) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
}

function setViewTitle(view) {
  const viewTitle = document.getElementById('viewTitle');
  if (!viewTitle) return;

  const titleMap = {
    all: '全部书签',
    recent: '最近添加',
    invalid: '已失效'
  };
  viewTitle.textContent = titleMap[view] || titleMap.all;
}

function setBookmarkCount(count) {
  const el = document.getElementById('bookmarkCount');
  if (!el) return;
  el.textContent = count > 0 ? `${count} 个` : '';
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
  if (backdrop) {
    backdrop.addEventListener('click', () => closeModal(modalEl));
  }

  modalEl.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => closeModal(modalEl));
  });
}

function findNodeById(nodes, id) {
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    if (!node) continue;
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
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

function collectDescendantFolderIds(node, out = new Set()) {
  if (!node) return out;
  if (!node.url) out.add(node.id);
  if (Array.isArray(node.children)) {
    node.children.forEach(child => collectDescendantFolderIds(child, out));
  }
  return out;
}

class ContextMenu {
  constructor(menuEl, handlers) {
    this.menu = menuEl;
    this.handlers = handlers;
    this.currentTarget = null;
    this.init();
  }

  init() {
    this.menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        this.handleAction(action);
        this.hide();
      });
    });

    document.addEventListener('click', (e) => {
      if (!this.menu.contains(e.target)) {
        this.hide();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  show(x, y, target) {
    this.currentTarget = target;

    const isBookmark = !!target.dataset.url;
    this.menu.querySelector('[data-action="open"]').style.display = isBookmark ? 'flex' : 'none';
    this.menu.querySelector('[data-action="copy"]').style.display = isBookmark ? 'flex' : 'none';

    this.menu.style.display = 'block';

    const menuRect = this.menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (x + menuRect.width > viewportWidth) {
      x = viewportWidth - menuRect.width - 5;
    }
    if (y + menuRect.height > viewportHeight) {
      y = viewportHeight - menuRect.height - 5;
    }

    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
  }

  hide() {
    this.menu.style.display = 'none';
    this.currentTarget = null;
  }

  async handleAction(action) {
    if (!this.currentTarget) return;

    const id = this.currentTarget.dataset.id;
    const url = this.currentTarget.dataset.url;
    const title = this.currentTarget.dataset.title || '';
    const isFolder = this.currentTarget.dataset.isFolder === 'true';

    switch (action) {
      case 'open':
        if (url) chrome.tabs.create({ url });
        break;

      case 'copy':
        if (url) {
          await navigator.clipboard.writeText(url);
          showToast(getMessage('copied'), 'success');
        }
        break;

      case 'rename': {
        const newTitle = prompt(getMessage('rename'), title);
        if (newTitle && newTitle !== title) {
          await this.handlers.rename(id, newTitle);
        }
        break;
      }

      case 'move':
        await this.handlers.move(id, isFolder);
        break;

      case 'delete': {
        const confirmMsg = isFolder ? getMessage('confirmDeleteFolder') : getMessage('confirmDelete');
        if (confirm(confirmMsg)) {
          await this.handlers.remove(id);
        }
        break;
      }
    }
  }
}

const state = {
  allBookmarks: [],
  currentView: 'all',
  searchQuery: '',
  treeRenderer: null,
  contextMenu: null,
  moveSourceId: null,
  moveSourceIsFolder: false,
  moveForbiddenFolderIds: new Set(),
  moveTargetFolderId: null,
  linkCheckResults: [],
  selectedInvalidIds: new Set()
};

function getCurrentViewNodes() {
  if (!state.allBookmarks || state.allBookmarks.length === 0) return [];

  if (state.currentView === 'recent') {
    const now = Date.now();
    const threshold = now - 7 * 24 * 60 * 60 * 1000;
    const flat = BookmarkManager.flatten(state.allBookmarks);
    return flat
      .filter(b => typeof b.dateAdded === 'number' && b.dateAdded >= threshold)
      .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
      .slice(0, 200);
  }

  if (state.currentView === 'invalid') {
    const invalidFolderName = getMessage('invalidFolder') || '已失效书签';
    const invalidFolder = findFolderByTitle(state.allBookmarks, invalidFolderName);
    return invalidFolder?.children || [];
  }

  return state.allBookmarks;
}

function findFolderByTitle(nodes, title) {
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes) {
    if (!node) continue;
    if (!node.url && node.title === title) return node;
    if (node.children) {
      const found = findFolderByTitle(node.children, title);
      if (found) return found;
    }
  }
  return null;
}

function renderCurrentView() {
  const nodes = getCurrentViewNodes();

  // Empty state per view (when no search query)
  if (!state.searchQuery.trim()) {
    if (state.currentView === 'recent' && nodes.length === 0) {
      showState('emptyState', { emptyTitle: '暂无最近添加的书签' });
      setBookmarkCount(0);
      return;
    }
    if (state.currentView === 'invalid' && nodes.length === 0) {
      showState('emptyState', { emptyTitle: '暂无已失效书签' });
      setBookmarkCount(0);
      return;
    }
  }

  const toRender = state.searchQuery.trim()
    ? BookmarkManager.search(nodes, state.searchQuery)
    : nodes;

  if (state.searchQuery.trim() && toRender.length === 0) {
    showState('noResultsState');
    setBookmarkCount(0);
    return;
  }

  showState('bookmarkTree');
  state.treeRenderer.render(toRender, state.searchQuery);
  setBookmarkCount(BookmarkManager.flatten(toRender).length);
}

async function loadBookmarks() {
  showState('loadingState');

  try {
    state.allBookmarks = await BookmarkManager.getAll();

    if (!state.allBookmarks || state.allBookmarks.length === 0 ||
        (state.allBookmarks[0].children && state.allBookmarks[0].children.length === 0)) {
      showState('emptyState');
      setBookmarkCount(0);
      return;
    }

    renderCurrentView();
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
    showToast(getMessage('error'), 'error');
    showState('emptyState');
  }
}

function populateNewFolderParents() {
  const select = document.getElementById('newFolderParent');
  if (!select) return;

  const folders = collectFoldersForUi(state.allBookmarks);
  select.innerHTML = '';

  folders.forEach(f => {
    const option = document.createElement('option');
    option.value = f.id;
    option.textContent = `${'  '.repeat(f.depth)}${f.title}`;
    select.appendChild(option);
  });

  // Prefer "Other Bookmarks" (usually id = 2) when available.
  const preferred = folders.find(f => f.id === '2');
  if (preferred) select.value = preferred.id;
}

function renderMoveFolderTree() {
  const container = document.getElementById('folderTree');
  if (!container) return;

  container.innerHTML = '';
  state.moveTargetFolderId = null;

  const folders = collectFoldersForUi(state.allBookmarks);
  folders.forEach(f => {
    if (state.moveForbiddenFolderIds.has(f.id)) return;

    const item = document.createElement('div');
    item.className = 'folder-tree-item';
    item.dataset.id = f.id;

    for (let i = 0; i < f.depth; i++) {
      const indent = document.createElement('span');
      indent.className = 'indent';
      item.appendChild(indent);
    }

    const label = document.createElement('span');
    label.textContent = `📁 ${f.title}`;
    item.appendChild(label);

    item.addEventListener('click', () => {
      container.querySelectorAll('.folder-tree-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      state.moveTargetFolderId = f.id;
    });

    container.appendChild(item);
  });
}

async function startLinkCheck() {
  const modal = document.getElementById('modalLinkCheck');
  const progressWrap = document.getElementById('linkCheckProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const resultsEl = document.getElementById('linkCheckResults');
  const moveBtn = document.getElementById('confirmMoveInvalid');

  if (!modal || !progressWrap || !progressFill || !progressText || !resultsEl || !moveBtn) return;

  openModal(modal);
  progressWrap.style.display = 'block';
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  resultsEl.innerHTML = '';
  state.linkCheckResults = [];
  state.selectedInvalidIds = new Set();
  moveBtn.disabled = true;

  const bookmarks = BookmarkManager.flatten(state.allBookmarks);
  if (bookmarks.length === 0) {
    showToast(getMessage('noBookmarks'), 'warning');
    progressWrap.style.display = 'none';
    return;
  }

  try {
    showToast(getMessage('checking'), 'default', 1200);

    const results = await LinkChecker.checkLinks(bookmarks, (checked, total, result) => {
      const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${percent}%`;
      state.linkCheckResults.push(result);
    });

    progressWrap.style.display = 'none';
    renderLinkCheckResults(results);

    const invalidCount = results.filter(r => r.status === 'invalid' || r.status === 'timeout').length;
    if (invalidCount > 0) {
      showToast(getMessage('invalidLinksFound', [String(invalidCount)]), 'warning');
    } else {
      showToast(getMessage('noInvalidLinks'), 'success');
    }
  } catch (error) {
    console.error('Link check failed:', error);
    progressWrap.style.display = 'none';
    showToast(getMessage('networkError'), 'error');
  }
}

function renderLinkCheckResults(results) {
  const resultsEl = document.getElementById('linkCheckResults');
  const moveBtn = document.getElementById('confirmMoveInvalid');
  if (!resultsEl || !moveBtn) return;

  resultsEl.innerHTML = '';

  const filtered = results.filter(r => r.status !== 'valid');
  if (filtered.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state"><div class="empty-state-title">未发现失效链接</div></div>';
    moveBtn.disabled = true;
    return;
  }

  filtered.forEach(r => {
    const item = document.createElement('div');
    item.className = 'link-check-item' + (r.status === 'invalid' || r.status === 'timeout' ? ' invalid' : r.status === 'whitelisted' ? ' whitelisted' : '');

    const canMove = r.status === 'invalid' || r.status === 'timeout';
    if (canMove) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox';
      checkbox.checked = true;
      state.selectedInvalidIds.add(r.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selectedInvalidIds.add(r.id);
        else state.selectedInvalidIds.delete(r.id);
        moveBtn.disabled = state.selectedInvalidIds.size === 0;
      });
      item.appendChild(checkbox);
    } else {
      const spacer = document.createElement('span');
      spacer.style.width = '18px';
      spacer.style.display = 'inline-block';
      item.appendChild(spacer);
    }

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = r.title || r.url || '';
    item.appendChild(title);

    const status = document.createElement('span');
    status.className = 'status ' + (r.status === 'whitelisted' ? 'whitelisted' : 'invalid');
    status.textContent = r.status === 'whitelisted' ? getMessage('possiblyBlocked') : '失效';
    item.appendChild(status);

    resultsEl.appendChild(item);
  });

  moveBtn.disabled = state.selectedInvalidIds.size === 0;
}

async function moveSelectedInvalid() {
  const ids = [...state.selectedInvalidIds];
  if (ids.length === 0) return;

  try {
    await BookmarkManager.moveToInvalid(ids);
    showToast(getMessage('moveToInvalid'), 'success');
    closeModal(document.getElementById('modalLinkCheck'));
    await loadBookmarks();
    state.currentView = 'invalid';
    setActiveView(state.currentView);
    setViewTitle(state.currentView);
    state.searchQuery = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    renderCurrentView();
  } catch (error) {
    console.error('Move invalid bookmarks failed:', error);
    showToast(getMessage('error'), 'error');
  }
}

async function aiClassify() {
  try {
    showToast('AI 分类中...', 'default', 1200);
    const bookmarks = BookmarkManager.flatten(state.allBookmarks).slice(0, 60);
    if (bookmarks.length === 0) {
      showToast(getMessage('noBookmarks'), 'warning');
      return;
    }

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'AI_CLASSIFY', bookmarks }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res);
      });
    });

    if (!response || response.error) {
      showToast(response?.error || getMessage('apiError'), 'error');
      return;
    }

    console.log('AI classifications:', response);
    showToast('AI 分类建议已生成（见控制台）', 'success');
  } catch (error) {
    console.error('AI classify failed:', error);
    showToast(getMessage('apiError'), 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initI18n();

  state.contextMenu = new ContextMenu(document.getElementById('contextMenu'), {
    rename: async (id, newTitle) => {
      await BookmarkManager.rename(id, newTitle);
      await loadBookmarks();
    },
    move: async (id, isFolder) => {
      state.moveSourceId = id;
      state.moveSourceIsFolder = isFolder;

      state.moveForbiddenFolderIds = new Set();
      if (isFolder) {
        const sourceNode = findNodeById(state.allBookmarks, id);
        state.moveForbiddenFolderIds = collectDescendantFolderIds(sourceNode);
      } else {
        state.moveForbiddenFolderIds = new Set([id]);
      }

      renderMoveFolderTree();
      openModal(document.getElementById('modalMove'));
    },
    remove: async (id) => {
      await BookmarkManager.remove(id);
      await loadBookmarks();
    }
  });

  const container = document.getElementById('bookmarkTree');
  state.treeRenderer = new TreeRenderer(container, {
    storageKey: 'expandedNodesMain',
    onContextMenu: (e, node, targetEl) => {
      state.contextMenu.show(e.clientX, e.clientY, targetEl);
    }
  });

  // Modals
  setupModalDismiss(document.getElementById('modalNewFolder'));
  setupModalDismiss(document.getElementById('modalMove'));
  setupModalDismiss(document.getElementById('modalLinkCheck'));

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      state.currentView = item.dataset.view || 'all';
      setActiveView(state.currentView);
      setViewTitle(state.currentView);
      state.searchQuery = '';
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = '';
      renderCurrentView();
    });
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value;
      renderCurrentView();
    }, 200);
  });

  // Toolbar buttons
  document.getElementById('btnSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings/settings.html') });
  });

  document.getElementById('btnNewFolder').addEventListener('click', () => {
    populateNewFolderParents();
    document.getElementById('newFolderName').value = '';
    openModal(document.getElementById('modalNewFolder'));
  });

  document.getElementById('confirmNewFolder').addEventListener('click', async () => {
    const name = document.getElementById('newFolderName').value.trim();
    const parentId = document.getElementById('newFolderParent').value;
    if (!name) {
      showToast('请输入文件夹名称', 'warning');
      return;
    }
    try {
      await BookmarkManager.createFolder(parentId, name);
      closeModal(document.getElementById('modalNewFolder'));
      await loadBookmarks();
    } catch (error) {
      console.error('Create folder failed:', error);
      showToast(getMessage('error'), 'error');
    }
  });

  document.getElementById('confirmMove').addEventListener('click', async () => {
    if (!state.moveSourceId || !state.moveTargetFolderId) {
      showToast('请选择目标文件夹', 'warning');
      return;
    }
    if (state.moveForbiddenFolderIds.has(state.moveTargetFolderId)) {
      showToast('不能移动到自身或子文件夹', 'error');
      return;
    }
    try {
      await BookmarkManager.move(state.moveSourceId, state.moveTargetFolderId);
      closeModal(document.getElementById('modalMove'));
      await loadBookmarks();
    } catch (error) {
      console.error('Move failed:', error);
      showToast(getMessage('error'), 'error');
    } finally {
      state.moveSourceId = null;
      state.moveTargetFolderId = null;
      state.moveForbiddenFolderIds = new Set();
    }
  });

  document.getElementById('btnCheckLinks').addEventListener('click', startLinkCheck);
  document.getElementById('confirmMoveInvalid').addEventListener('click', moveSelectedInvalid);
  document.getElementById('btnAiClassify').addEventListener('click', aiClassify);

  // Initial state
  setActiveView(state.currentView);
  setViewTitle(state.currentView);
  await loadBookmarks();
});
