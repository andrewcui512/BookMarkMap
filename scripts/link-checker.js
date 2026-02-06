/**
 * 链接检测模块
 */

const LinkChecker = {
  // 默认防火墙白名单（常见被墙域名）
  DEFAULT_WHITELIST: [
    'google.com',
    'google.co',
    'googleapis.com',
    'gstatic.com',
    'youtube.com',
    'youtu.be',
    'twitter.com',
    'x.com',
    'facebook.com',
    'fb.com',
    'instagram.com',
    'whatsapp.com',
    'telegram.org',
    't.me',
    'reddit.com',
    'discord.com',
    'twitch.tv',
    'pinterest.com',
    'tumblr.com',
    'medium.com',
    'blogger.com',
    'wordpress.com',
    'github.com',
    'githubusercontent.com',
    'stackoverflow.com',
    'wikipedia.org',
    'wikimedia.org',
    'archive.org',
    'dropbox.com',
    'mega.nz',
    'netflix.com',
    'spotify.com',
    'soundcloud.com',
    'vimeo.com',
    'dailymotion.com',
    'bbc.com',
    'nytimes.com',
    'wsj.com',
    'reuters.com',
    'cnn.com'
  ],

  /**
   * 获取防火墙白名单
   * @returns {Promise<string[]>}
   */
  async getWhitelist() {
    try {
      const result = await chrome.storage.sync.get(['settings']);
      const userWhitelist = result.settings?.firewallWhitelist || [];
      // 合并默认白名单和用户白名单
      return [...new Set([...this.DEFAULT_WHITELIST, ...userWhitelist])];
    } catch {
      return this.DEFAULT_WHITELIST;
    }
  },

  /**
   * 检查域名是否在白名单中
   * @param {string} url 要检查的 URL
   * @param {string[]} whitelist 白名单
   * @returns {boolean}
   */
  isWhitelisted(url, whitelist) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

      return whitelist.some(domain => {
        const d = domain.toLowerCase().replace(/^www\./, '');
        return hostname === d || hostname.endsWith('.' + d);
      });
    } catch {
      return false;
    }
  },

  /**
   * 检测单个链接
   * @param {string} url 要检测的 URL
   * @param {string[]} whitelist 白名单（可选）
   * @returns {Promise<Object>} 检测结果
   */
  async checkLink(url, whitelist = null) {
    if (!whitelist) {
      whitelist = await this.getWhitelist();
    }

    // 检查白名单
    if (this.isWhitelisted(url, whitelist)) {
      return {
        url,
        status: 'whitelisted',
        statusCode: null,
        message: '可能被防火墙阻止'
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

      // 使用 HEAD 请求，更快
      const response = await fetch(url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // no-cors 模式下 response.type 为 'opaque'，无法获取状态码
      // 但如果请求成功完成，说明服务器可达
      return {
        url,
        status: 'valid',
        statusCode: response.status || 0,
        message: 'OK'
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return {
          url,
          status: 'timeout',
          statusCode: null,
          message: '请求超时'
        };
      }

      // 尝试使用 GET 请求（某些服务器不支持 HEAD）
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-cache',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        return {
          url,
          status: 'valid',
          statusCode: response.status || 0,
          message: 'OK'
        };
      } catch (retryError) {
        return {
          url,
          status: 'invalid',
          statusCode: null,
          message: retryError.message || '无法访问'
        };
      }
    }
  },

  /**
   * 批量检测链接
   * @param {Array<{id: string, url: string, title: string}>} bookmarks 书签列表
   * @param {Function} onProgress 进度回调 (checked, total, result)
   * @returns {Promise<Object[]>} 检测结果列表
   */
  async checkLinks(bookmarks, onProgress = null) {
    const whitelist = await this.getWhitelist();
    const results = [];
    const concurrency = 5; // 并发数

    for (let i = 0; i < bookmarks.length; i += concurrency) {
      const batch = bookmarks.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (bookmark) => {
          const result = await this.checkLink(bookmark.url, whitelist);
          return {
            id: bookmark.id,
            title: bookmark.title,
            ...result
          };
        })
      );

      results.push(...batchResults);

      // 进度回调
      if (onProgress) {
        batchResults.forEach(result => {
          onProgress(results.length, bookmarks.length, result);
        });
      }

      // 短暂延迟，避免请求过于频繁
      if (i + concurrency < bookmarks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  },

  /**
   * 获取检测统计
   * @param {Object[]} results 检测结果
   * @returns {Object} 统计信息
   */
  getStats(results) {
    const stats = {
      total: results.length,
      valid: 0,
      invalid: 0,
      whitelisted: 0,
      timeout: 0
    };

    results.forEach(r => {
      if (stats.hasOwnProperty(r.status)) {
        stats[r.status]++;
      }
    });

    return stats;
  },

  /**
   * 筛选失效链接
   * @param {Object[]} results 检测结果
   * @returns {Object[]} 失效链接列表
   */
  getInvalidLinks(results) {
    return results.filter(r => r.status === 'invalid' || r.status === 'timeout');
  },

  /**
   * 筛选白名单链接
   * @param {Object[]} results 检测结果
   * @returns {Object[]} 白名单链接列表
   */
  getWhitelistedLinks(results) {
    return results.filter(r => r.status === 'whitelisted');
  }
};

// 兼容非扩展环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LinkChecker;
}
