// 后台 Service Worker
// 负责自动从浏览器获取 ita.abc 的 cookie，供内容脚本使用

const COOKIE_DOMAIN = 'ita.abc';

// 拼接 Cookie 字符串
const joinCookies = (cookies) => {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
};

// 监听内容脚本的 cookie 请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 扩展页打开请求：content 脚本不能直接 window.open 扩展页（受 web_accessible_resources
  // origin 白名单限制，白名单外页面会提示「已被屏蔽」），统一由后台 tabs.create 打开
  if (message && message.type === 'OPEN_PAGE' && message.page) {
    const url = chrome.runtime.getURL(message.page) + (message.query || '');
    chrome.tabs.create({ url }, () => void chrome.runtime.lastError);
    sendResponse({ ok: true });
    return false;
  }
  if (message && message.type === 'GET_COOKIES') {
    chrome.cookies.getAll({ domain: COOKIE_DOMAIN }, (cookies) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, cookie: joinCookies(cookies) });
    });
    // 返回 true 表示异步响应
    return true;
  }
  return false;
});