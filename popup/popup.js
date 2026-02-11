/**
 * Popup 主逻辑
 */

// 国际化函数
function getMessage(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

// 初始化国际化
function initI18n() {
  // 处理 data-i18n 属性
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = getMessage(el.dataset.i18n);
  });

  // 处理 data-i18n-placeholder 属性
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = getMessage(el.dataset.i18nPlaceholder);
  });

  // 处理 data-tooltip-i18n 属性
  document.querySelectorAll('[data-tooltip-i18n]').forEach(el => {
    el.dataset.tooltip = getMessage(el.dataset.tooltipI18n);
  });
}

// Toast 提示
function showToast(message, type = 'default', duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (type !== 'default' ? ` ${type}` : '');
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

// 显示/隐藏状态
function showState(stateId) {
  const states = ['loadingState', 'emptyState', 'noResultsState', 'bookmarkTree'];
  states.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = id === stateId ? (id === 'bookmarkTree' ? 'block' : 'flex') : 'none';
    }
  });
}

// 右键菜单
class ContextMenu {
  constructor() {
    this.menu = document.getElementById('contextMenu');
    this.currentTarget = null;
    this.init();
  }

  init() {
    // 点击菜单项
    this.menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const action = item.dataset.action;
        this.handleAction(action);
        this.hide();
      });
    });

    // 点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
      if (!this.menu.contains(e.target)) {
        this.hide();
      }
    });

    // ESC 关闭菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  show(x, y, target) {
    this.currentTarget = target;
    const isFolder = target.dataset.isFolder === 'true';
    const isBookmark = !!target.dataset.url;

    // 根据类型显示/隐藏菜单项
    this.menu.querySelector('[data-action="open"]').style.display = isBookmark ? 'flex' : 'none';
    this.menu.querySelector('[data-action="copy"]').style.display = isBookmark ? 'flex' : 'none';

    // 定位菜单
    this.menu.style.display = 'block';

    // 确保菜单不超出视口
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
    const title = this.currentTarget.dataset.title;

    switch (action) {
      case 'open':
        if (url) {
          chrome.tabs.create({ url });
        }
        break;

      case 'copy':
        if (url) {
          await navigator.clipboard.writeText(url);
          showToast(getMessage('copied'), 'success');
        }
        break;

      case 'rename':
        const newTitle = prompt(getMessage('rename'), title);
        if (newTitle && newTitle !== title) {
          await BookmarkManager.rename(id, newTitle);
          loadBookmarks();
        }
        break;

      case 'move':
        // TODO: 实现移动功能的 UI
        showToast('移动功能开发中', 'warning');
        break;

      case 'delete':
        const isFolder = this.currentTarget.dataset.isFolder === 'true';
        const confirmMsg = isFolder ? getMessage('confirmDeleteFolder') : getMessage('confirmDelete');
        if (confirm(confirmMsg)) {
          await BookmarkManager.remove(id);
          loadBookmarks();
        }
        break;
    }
  }
}

// 全局变量
let treeRenderer;
let contextMenu;
let allBookmarks = [];

// 加载书签
async function loadBookmarks() {
  showState('loadingState');

  try {
    allBookmarks = await BookmarkManager.getAll();

    if (!allBookmarks || allBookmarks.length === 0 ||
        (allBookmarks[0].children && allBookmarks[0].children.length === 0)) {
      showState('emptyState');
      return;
    }

    showState('bookmarkTree');
    treeRenderer.render(allBookmarks);
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
    showToast(getMessage('error'), 'error');
  }
}

// 搜索书签
function searchBookmarks(query) {
  if (!query.trim()) {
    showState('bookmarkTree');
    treeRenderer.render(allBookmarks);
    return;
  }

  const results = BookmarkManager.search(allBookmarks, query);

  if (results.length === 0) {
    showState('noResultsState');
  } else {
    showState('bookmarkTree');
    treeRenderer.render(results, query);
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化国际化
  initI18n();

  // 初始化组件
  const container = document.getElementById('bookmarkTree');
  contextMenu = new ContextMenu();
  treeRenderer = new TreeRenderer(container, {
    storageKey: 'expandedNodes',
    onContextMenu: (e, node, targetEl) => {
      contextMenu.show(e.clientX, e.clientY, targetEl);
    }
  });

  // 加载书签
  await loadBookmarks();

  // 搜索功能
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchBookmarks(e.target.value);
    }, 300);
  });

  // 检测失效链接按钮
  document.getElementById('btnCheckLinks').addEventListener('click', () => {
    showToast('失效链接检测功能开发中', 'warning');
  });

  // AI 分类按钮
  document.getElementById('btnAiClassify').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/ai/ai.html') });
  });

  // 设置按钮
  document.getElementById('btnSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings/settings.html') });
  });

  // 打开完整页面按钮
  document.getElementById('btnOpenMain').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/main/main.html') });
  });
});
