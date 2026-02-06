/**
 * Tree renderer shared by popup / main pages.
 *
 * Renders Chrome bookmarks tree nodes into a container element.
 */
class TreeRenderer {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   storageKey?: string,
   *   onContextMenu?: (event: MouseEvent, node: any, targetEl: HTMLElement) => void,
   *   getNodeClass?: (node: any) => (string | string[] | null | undefined),
   *   onAfterNodeCreate?: (node: any, els: { wrapper: HTMLElement, content: HTMLElement }) => void
   * }=} options
   */
  constructor(container, options = {}) {
    this.container = container;
    this.storageKey = options.storageKey || 'expandedNodes';
    this.onContextMenu = options.onContextMenu || null;
    this.getNodeClass = options.getNodeClass || null;
    this.onAfterNodeCreate = options.onAfterNodeCreate || null;

    this.expandedNodes = new Set();
    this.loadExpandedState();
  }

  loadExpandedState() {
    try {
      chrome.storage.local.get([this.storageKey], (result) => {
        const stored = result?.[this.storageKey];
        if (Array.isArray(stored)) {
          this.expandedNodes = new Set(stored);
        }
      });
    } catch {
      // Ignore (non-extension environments)
    }
  }

  saveExpandedState() {
    try {
      chrome.storage.local.set({ [this.storageKey]: [...this.expandedNodes] });
    } catch {
      // Ignore (non-extension environments)
    }
  }

  render(bookmarks, searchQuery = '') {
    this.container.innerHTML = '';
    this.renderNodes(bookmarks, this.container, searchQuery);
  }

  renderNodes(nodes, parent, searchQuery) {
    if (!Array.isArray(nodes)) return;

    nodes.forEach(node => {
      // Skip Chrome root node; render its children directly.
      if (node?.id === '0') {
        if (node.children) {
          this.renderNodes(node.children, parent, searchQuery);
        }
        return;
      }

      const nodeEl = this.createNodeElement(node, searchQuery);
      parent.appendChild(nodeEl);
    });
  }

  createNodeElement(node, searchQuery) {
    const isFolder = !node.url;
    const isExpanded = this.expandedNodes.has(node.id);
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;

    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = 'tree-node';

    const content = document.createElement('div');
    content.className = 'tree-node-content';

    // Allow extra node styling (e.g., invalid/firewalled)
    if (this.getNodeClass) {
      const extra = this.getNodeClass(node);
      const classNames = Array.isArray(extra) ? extra : (extra ? [extra] : []);
      classNames.filter(Boolean).forEach(cls => content.classList.add(cls));
    }

    content.dataset.id = node.id;
    content.dataset.title = node.title || '';
    content.dataset.isFolder = String(isFolder);
    if (node.url) content.dataset.url = node.url;

    // Toggle icon
    const toggle = document.createElement('div');
    toggle.className = `tree-node-toggle ${isExpanded ? 'expanded' : ''} ${!isFolder || !hasChildren ? 'hidden' : ''}`;
    toggle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleNode(node.id, nodeWrapper);
    });

    // Node icon
    const icon = document.createElement('div');
    icon.className = `tree-node-icon ${isFolder ? 'folder' : ''}`;
    if (isFolder) {
      icon.textContent = isExpanded ? '📂' : '📁';
    } else {
      const favicon = document.createElement('img');
      favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(node.url)}&size=16`;
      favicon.onerror = () => {
        icon.textContent = '🔖';
        favicon.remove();
      };
      icon.appendChild(favicon);
    }

    // Title
    const title = document.createElement('div');
    title.className = 'tree-node-title';
    const displayTitle = node.title || (isFolder ? '未命名文件夹' : '无标题');
    if (searchQuery) {
      title.innerHTML = this.highlightText(displayTitle, searchQuery);
    } else {
      title.textContent = displayTitle;
    }

    if (isFolder && hasChildren) {
      const count = document.createElement('span');
      count.className = 'tree-node-count';
      count.textContent = `(${node.children.length})`;
      title.appendChild(count);
    }

    content.appendChild(toggle);
    content.appendChild(icon);
    content.appendChild(title);

    // Click
    content.addEventListener('click', () => {
      if (isFolder) {
        this.toggleNode(node.id, nodeWrapper);
      } else if (node.url) {
        try {
          chrome.tabs.create({ url: node.url });
        } catch {
          window.open(node.url, '_blank', 'noopener,noreferrer');
        }
      }
    });

    // Context menu
    content.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.onContextMenu) {
        this.onContextMenu(e, node, content);
      }
    });

    nodeWrapper.appendChild(content);

    // Children
    if (isFolder && hasChildren) {
      const children = document.createElement('div');
      children.className = `tree-node-children ${isExpanded ? '' : 'collapsed'}`;
      this.renderNodes(node.children, children, searchQuery);
      nodeWrapper.appendChild(children);
    }

    if (this.onAfterNodeCreate) {
      this.onAfterNodeCreate(node, { wrapper: nodeWrapper, content });
    }

    return nodeWrapper;
  }

  toggleNode(nodeId, nodeWrapper) {
    const isExpanded = this.expandedNodes.has(nodeId);
    const children = nodeWrapper.querySelector('.tree-node-children');
    const toggle = nodeWrapper.querySelector('.tree-node-toggle');
    const icon = nodeWrapper.querySelector('.tree-node-icon.folder');

    if (isExpanded) {
      this.expandedNodes.delete(nodeId);
      if (children) children.classList.add('collapsed');
      if (toggle) toggle.classList.remove('expanded');
      if (icon) icon.textContent = '📁';
    } else {
      this.expandedNodes.add(nodeId);
      if (children) children.classList.remove('collapsed');
      if (toggle) toggle.classList.add('expanded');
      if (icon) icon.textContent = '📂';
    }

    this.saveExpandedState();
  }

  highlightText(text, query) {
    if (!query) return text;
    const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safe})`, 'gi');
    return String(text).replace(regex, '<span class="highlight">$1</span>');
  }
}

