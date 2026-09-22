'use strict';

const express = require('express');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 10000);
const DATA_ROOT = path.resolve(process.env.DATA_ROOT || process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(DATA_ROOT, { recursive: true });

const modules = [
  { slug: 'move', title: 'Item - Move or Update Qty', folder: 'location', port: 3101, version: 'v2.37' },
  { slug: 'inventory', title: 'Item - Inventory Verify', folder: 'inventory', port: 3102, version: 'v1.5' },
  { slug: 'auction', title: 'Item - Local Auction', folder: 'auction', port: 3103, version: 'v1.13' },
  { slug: 'tags', title: 'Item - Sort Tags by Location', folder: 'tag-sort', port: 3106, version: 'v1.3' },
  { slug: 'shipping', title: 'Shipping - Pick List', folder: 'pick', port: 3104, version: 'v27', data: 'pick' },
  { slug: 'returns', title: 'Orders - Returns', folder: 'returns', port: 3105, version: 'v2.48', data: 'returns' }
];

const sharedToken = process.env.SELLERCHAMP_TOKEN || process.env.SELLERCHAMP_API_TOKEN || '';
const children = [];
const SUITE_PIN = process.env.APP_PIN || '';
const AUTH_COOKIE = 'sellerchamp_tools_auth';
const AUTH_AGE = 30 * 24 * 60 * 60;

function startModule(mod) {
  const env = {
    ...process.env,
    PORT: String(mod.port),
    SELLERCHAMP_TOKEN: sharedToken,
    SELLERCHAMP_API_TOKEN: sharedToken,
    // Pick List v27 keeps its original server-side PIN guard. The gateway
    // supplies the already-verified suite PIN when proxying its API calls.
    APP_PIN: mod.slug === 'shipping' ? SUITE_PIN : '',
    SHARED_INDEX_OWNER: mod.slug === 'move' ? 'tags' : (process.env.SHARED_INDEX_OWNER || ''),
    TAG_SORT_INTERNAL_URL: 'http://127.0.0.1:3106',
    DATA_DIR: mod.data ? path.join(DATA_ROOT, mod.data) : process.env.DATA_DIR || DATA_ROOT
  };
  if (mod.slug === 'returns' && process.env.PUBLIC_BASE_URL) {
    env.RETURN_APP_BASE_URL = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/returns`;
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, 'modules', mod.folder), env, stdio: ['ignore', 'inherit', 'inherit']
  });
  child.on('exit', (code, signal) => {
    console.error(`[suite] ${mod.slug} stopped (${signal || code}); shutting down so Render can restart safely.`);
    process.exit(code || 1);
  });
  children.push(child);
}

modules.forEach(startModule);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

function cookies(req) {
  const result = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) result[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return result;
}
function makeAuth() {
  const expires = Math.floor(Date.now() / 1000) + AUTH_AGE;
  const signature = crypto.createHmac('sha256', SUITE_PIN).update(String(expires)).digest('hex');
  return `${expires}.${signature}`;
}
function authorized(req) {
  if (!SUITE_PIN) return true;
  const [expires, signature] = String(cookies(req)[AUTH_COOKIE] || '').split('.');
  if (!expires || !signature || Number(expires) < Date.now() / 1000) return false;
  const expected = crypto.createHmac('sha256', SUITE_PIN).update(expires).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
}
function loginPage(error = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>SellerChamp Tools Login</title><style>*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:#14263e;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center;padding:20px}.card{width:min(100%,420px);background:#fff;border:1px solid #d7e0ec;border-radius:18px;padding:24px;box-shadow:0 8px 28px #19395d1c}h1{margin:0 0 6px}p{color:#60738a}input,button{width:100%;min-height:52px;border-radius:11px;font-size:18px}input{border:1px solid #b9c7d8;padding:0 14px;margin:10px 0}button{border:0;background:#1768c4;color:#fff;font-weight:800}.error{color:#b42318;font-weight:700}</style></head><body><form class="card" method="post" action="/login"><h1>SellerChamp Tools</h1><p>Enter your app PIN. This browser will stay signed in for 30 days.</p>${error ? `<div class="error">${error}</div>` : ''}<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus required><button>Unlock</button></form></body></html>`;
}
app.get('/login', (req, res) => authorized(req) ? res.redirect('/') : res.type('html').send(loginPage()));
app.post('/login', (req, res) => {
  if (!SUITE_PIN || String(req.body.pin || '') === SUITE_PIN) {
    if (SUITE_PIN) res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(makeAuth())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_AGE}; Secure`);
    return res.redirect('/');
  }
  res.status(401).type('html').send(loginPage('Incorrect PIN.'));
});
app.get('/health', (req, res) => res.json({ ok: true, suite: '1.11.0', modules: modules.map(m => m.slug) }));
app.use((req, res, next) => {
  if (authorized(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(401).json({ error: 'PIN required' });
  res.redirect('/login');
});
const proxy = httpProxy.createProxyServer({ xfwd: true });
proxy.on('error', (error, req, res) => {
  if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'That module is starting. Please try again in a moment.', details: error.message }));
});

function proxyTo(mod, req, res) {
  proxy.web(req, res, { target: `http://127.0.0.1:${mod.port}` });
}

for (const mod of modules) {
  app.use(`/${mod.slug}`, (req, res) => {
    if (mod.slug === 'shipping' && SUITE_PIN) req.headers['x-app-pin'] = SUITE_PIN;
    proxyTo(mod, req, res);
  });
}

// Older module front ends use root-relative API, upload, and asset URLs.
// The browser's Referer keeps those calls tied to the correct isolated module.
app.use(['/api', '/uploads', '/app.js', '/styles.css'], (req, res, next) => {
  const referer = String(req.headers.referer || '');
  const mod = modules.find(m => new RegExp(`/${m.slug}(?:/|$)`).test(referer));
  if (!mod) return next();
  if (mod.slug === 'shipping' && SUITE_PIN) req.headers['x-app-pin'] = SUITE_PIN;
  req.url = req.originalUrl;
  proxyTo(mod, req, res);
});

app.get('/', (req, res) => {
  const cards = modules.map(m => `<a class="card" href="/${m.slug}/"><span>${m.title}</span><small>${m.version}</small></a>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#10233f"><title>SellerChamp Tools</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#12233b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#10233f;color:#fff;padding:max(26px,env(safe-area-inset-top)) 20px 24px}header div{max-width:760px;margin:auto}h1{margin:0;font-size:clamp(30px,8vw,44px)}p{margin:7px 0 0;opacity:.78}.shell{max-width:760px;margin:0 auto;padding:20px}.grid{display:grid;gap:14px}.card{display:flex;align-items:center;justify-content:space-between;min-height:84px;padding:18px 20px;border:1px solid #d7e0ec;border-radius:16px;background:#fff;color:#12233b;text-decoration:none;box-shadow:0 3px 12px #19395d12;font-size:19px;font-weight:800}.card:active{transform:scale(.99);background:#edf5ff}.card small{color:#60738a;font-size:12px;font-weight:700}.status{margin-top:20px;text-align:center;color:#617086;font-size:13px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#22a35a;margin-right:6px}</style></head><body><header><div><h1>SellerChamp Tools</h1><p>Stuff2Sell warehouse suite · Suite v1.11</p></div></header><main class="shell"><div class="grid">${cards}</div><div class="status"><span class="dot"></span>One deployment · six isolated modules</div></main></body></html>`);
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`[suite] gateway listening on ${PORT}`));
function stop() { server.close(); children.forEach(c => c.kill('SIGTERM')); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
