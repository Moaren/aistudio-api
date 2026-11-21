// ponytail: 地址和密码写死在这里，代理不在本机 8080 时改这两行即可
const ENDPOINT = 'http://localhost:8080/api/accounts/sync-cookies';
const WEB_PASSWORD = ''; // 控制台设了 AISTUDIO_WEB_PASSWORD 就填同一个值

// 只推送登录态所在的两个域，避免 mail/play 等子域的同名 Cookie 混入
const DOMAINS = new Set(['.google.com', 'accounts.google.com']);
// 这些 Cookie 一变就同步（PSIDTS/SIDCC 是 Google 定期滚动的短效凭据）
const TRIGGERS = new Set([
  'SID', '__Secure-1PSID', '__Secure-3PSID',
  '__Secure-1PSIDTS', '__Secure-3PSIDTS',
  'SIDCC', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
]);

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function sync(reason) {
  const all = await chrome.cookies.getAll({ domain: 'google.com' });
  const cookies = all
    .filter((c) => DOMAINS.has(c.domain))
    .map(({ name, value, domain, path, httpOnly, secure }) => ({ name, value, domain, path, httpOnly, secure }));
  if (!cookies.some((c) => c.name === 'SAPISID')) {
    setBadge('OUT', '#777777'); // 浏览器没登录 Google，没东西可推
    return;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (WEB_PASSWORD) headers['x-api-key'] = WEB_PASSWORD;
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cookies: JSON.stringify(cookies) }),
    });
    const body = r.ok ? await r.json() : await r.text();
    setBadge(r.ok ? 'OK' : String(r.status), r.ok ? '#2e7d32' : '#c62828');
    console.log(`[cookie-sync] ${reason}: HTTP ${r.status}`, r.ok ? body : String(body).slice(0, 200));
  } catch (e) {
    setBadge('OFF', '#c62828');
    console.warn(`[cookie-sync] ${reason}: 代理不可达`, e.message);
  }
}

let debounce;
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed || !DOMAINS.has(cookie.domain) || !TRIGGERS.has(cookie.name)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => sync(`${cookie.name} changed`), 3000);
});

// 心跳：没变化也每 5 分钟推一次，让代理知道浏览器还在喂 Cookie，从而不去自己 RotateCookies
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(() => sync('heartbeat'));
chrome.runtime.onInstalled.addListener(() => sync('installed'));
chrome.runtime.onStartup.addListener(() => sync('startup'));
chrome.action.onClicked.addListener(() => sync('manual'));
