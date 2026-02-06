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
  const { settings } = await chrome.storage.sync.get(['settings']);

  if (!settings?.apiEndpoint || !settings?.apiKey) {
    throw new Error('API not configured');
  }

  // 准备请求数据
  const bookmarkData = bookmarks.map(b => ({
    title: b.title,
    url: b.url
  }));

  const prompt = `你是一个书签分类助手。请根据以下书签的标题和URL，为每个书签建议一个合适的分类文件夹名称。

书签列表：
${JSON.stringify(bookmarkData, null, 2)}

请以 JSON 格式返回结果，格式如下：
{
  "classifications": [
    { "url": "书签URL", "category": "建议的分类名称" }
  ]
}

分类名称应该简洁明了，如：开发工具、学习资源、新闻媒体、社交娱乐、购物网站等。`;

  try {
    const response = await fetch(settings.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-3.5-turbo',
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
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.content || '';

    // 解析 JSON 响应
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('Invalid API response format');
  } catch (error) {
    console.error('AI classification error:', error);
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
