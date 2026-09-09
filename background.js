// 后台 Service Worker
// 负责自动从浏览器获取 ita.abc 的 cookie，供内容脚本使用

const COOKIE_DOMAIN = 'ita.abc';

// 拼接 Cookie 字符串
const joinCookies = (cookies) => {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
};

// 监听内容脚本的 cookie 请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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