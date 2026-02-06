/**
 * 书签管理核心模块
 */

const BookmarkManager = {
  /**
   * 获取所有书签
   * @returns {Promise<Array>} 书签树
   */
  async getAll() {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.getTree((tree) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(tree);
        }
      });
    });
  },

  /**
   * 获取指定节点的子节点
   * @param {string} id 节点 ID
   * @returns {Promise<Array>} 子节点列表
   */
  async getChildren(id) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.getChildren(id, (children) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(children);
        }
      });
    });
  },

  /**
   * 获取指定节点
   * @param {string} id 节点 ID
   * @returns {Promise<Object>} 节点对象
   */
  async get(id) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.get(id, (nodes) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(nodes[0]);
        }
      });
    });
  },

  /**
   * 创建文件夹
   * @param {string} parentId 父节点 ID
   * @param {string} title 文件夹名称
   * @returns {Promise<Object>} 新创建的节点
   */
  async createFolder(parentId, title) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.create({
        parentId,
        title
      }, (node) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(node);
        }
      });
    });
  },

  /**
   * 创建书签
   * @param {string} parentId 父节点 ID
   * @param {string} title 书签标题
   * @param {string} url 书签 URL
   * @returns {Promise<Object>} 新创建的节点
   */
  async create(parentId, title, url) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.create({
        parentId,
        title,
        url
      }, (node) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(node);
        }
      });
    });
  },

  /**
   * 移动书签
   * @param {string} id 书签 ID
   * @param {string} parentId 目标父节点 ID
   * @param {number} index 目标位置索引
   * @returns {Promise<Object>} 移动后的节点
   */
  async move(id, parentId, index = undefined) {
    return new Promise((resolve, reject) => {
      const destination = { parentId };
      if (index !== undefined) {
        destination.index = index;
      }
      chrome.bookmarks.move(id, destination, (node) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(node);
        }
      });
    });
  },

  /**
   * 重命名书签或文件夹
   * @param {string} id 节点 ID
   * @param {string} title 新标题
   * @returns {Promise<Object>} 更新后的节点
   */
  async rename(id, title) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.update(id, { title }, (node) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(node);
        }
      });
    });
  },

  /**
   * 更新书签 URL
   * @param {string} id 书签 ID
   * @param {string} url 新 URL
   * @returns {Promise<Object>} 更新后的节点
   */
  async updateUrl(id, url) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.update(id, { url }, (node) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(node);
        }
      });
    });
  },

  /**
   * 删除书签或空文件夹
   * @param {string} id 节点 ID
   * @returns {Promise<void>}
   */
  async remove(id) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.remove(id, () => {
        if (chrome.runtime.lastError) {
          // 如果是非空文件夹，尝试递归删除
          chrome.bookmarks.removeTree(id, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * 删除文件夹及其所有内容
   * @param {string} id 文件夹 ID
   * @returns {Promise<void>}
   */
  async removeTree(id) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.removeTree(id, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * 搜索书签（Chrome API）
   * @param {string} query 搜索关键词
   * @returns {Promise<Array>} 匹配的书签列表
   */
  async searchApi(query) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.search(query, (results) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(results);
        }
      });
    });
  },

  /**
   * 本地搜索书签（在已加载的树中搜索）
   * @param {Array} bookmarks 书签树
   * @param {string} query 搜索关键词
   * @returns {Array} 匹配的书签列表（保持树结构）
   */
  search(bookmarks, query) {
    const lowerQuery = query.toLowerCase();

    function filterNode(node) {
      const isFolder = !node.url;
      const titleMatch = node.title && node.title.toLowerCase().includes(lowerQuery);
      const urlMatch = node.url && node.url.toLowerCase().includes(lowerQuery);

      if (isFolder && node.children) {
        const filteredChildren = node.children
          .map(child => filterNode(child))
          .filter(child => child !== null);

        if (filteredChildren.length > 0 || titleMatch) {
          return {
            ...node,
            children: filteredChildren
          };
        }
      } else if (titleMatch || urlMatch) {
        return { ...node };
      }

      return null;
    }

    return bookmarks
      .map(node => filterNode(node))
      .filter(node => node !== null);
  },

  /**
   * 获取所有书签（扁平列表，不含文件夹）
   * @param {Array} bookmarks 书签树
   * @returns {Array} 书签列表
   */
  flatten(bookmarks) {
    const result = [];

    function traverse(nodes) {
      nodes.forEach(node => {
        if (node.url) {
          result.push(node);
        }
        if (node.children) {
          traverse(node.children);
        }
      });
    }

    traverse(bookmarks);
    return result;
  },

  /**
   * 获取或创建失效书签文件夹
   * @returns {Promise<Object>} 失效书签文件夹节点
   */
  async getOrCreateInvalidFolder() {
    const INVALID_FOLDER_NAME = chrome.i18n.getMessage('invalidFolder') || '已失效书签';

    // 先搜索是否已存在
    const results = await this.searchApi(INVALID_FOLDER_NAME);
    const existingFolder = results.find(r => !r.url && r.title === INVALID_FOLDER_NAME);

    if (existingFolder) {
      return existingFolder;
    }

    // 在"其他书签"文件夹下创建
    const tree = await this.getAll();
    const otherBookmarks = tree[0].children.find(c => c.id === '2') || tree[0].children[1];

    return await this.createFolder(otherBookmarks.id, INVALID_FOLDER_NAME);
  },

  /**
   * 批量移动书签到失效文件夹
   * @param {Array<string>} bookmarkIds 书签 ID 列表
   * @returns {Promise<void>}
   */
  async moveToInvalid(bookmarkIds) {
    const invalidFolder = await this.getOrCreateInvalidFolder();

    for (const id of bookmarkIds) {
      await this.move(id, invalidFolder.id);
    }
  }
};

// 兼容非扩展环境（用于测试）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BookmarkManager;
}
