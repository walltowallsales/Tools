'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function page() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#10233f"><title>Recover Existing Data</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#12233b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#10233f;color:#fff;padding:max(24px,env(safe-area-inset-top)) 20px 22px}header div,main{max-width:760px;margin:auto}h1{margin:0;font-size:clamp(28px,7vw,40px)}header p{margin:7px 0 0;opacity:.8}.back{display:inline-block;color:#dceaff;margin-bottom:14px;text-decoration:none;font-weight:750}main{padding:20px}.notice,.card{background:#fff;border:1px solid #d7e0ec;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 3px 12px #19395d12}.notice{background:#fff9db;border-color:#ead37b}.card h2{margin:0 0 8px}.card p{color:#5d6f85;line-height:1.45}label{display:block;font-weight:800;margin:14px 0 6px}input{display:block;width:100%;min-height:50px;border:1px solid #aebdd0;border-radius:10px;padding:0 13px;font-size:17px}button{width:100%;min-height:52px;border:0;border-radius:11px;background:#1768c4;color:#fff;font-size:17px;font-weight:850;margin-top:16px}button:disabled{opacity:.55}.result{margin-top:13px;white-space:pre-line;font-weight:750;line-height:1.45}.ok{color:#137442}.bad{color:#b42318}.small{font-size:13px;color:#6c7e93}</style></head><body><header><div><a class="back" href="/">← SellerChamp Tools</a><h1>Recover Existing Data</h1><p>Suite v1.3 · one-time migration from your original apps</p></div></header><main><div class="notice"><b>Keep the original services running.</b><br>Recover Pick first, verify it, and then recover Returns. Existing combined-app records are preserved and duplicates are skipped.</div>
  <form class="card" id="pickForm"><h2>1. Recover Pick Batches</h2><p>Copies active, archived, and recently deleted batches from the original Pick app.</p><label>Original Pick app URL</label><input name="sourceUrl" type="url" inputmode="url" autocapitalize="none" placeholder="https://your-old-pick-app.onrender.com" required><label>Original Pick app PIN</label><input name="pin" type="password" inputmode="numeric" autocomplete="off" required><button>Recover Pick Batches</button><div class="result" aria-live="polite"></div></form>
  <form class="card" id="returnsForm"><h2>2. Recover Returns</h2><p>Copies Process Returns, archived records, processing history, and stored photos from the original Returns app.</p><label>Original Returns app URL</label><input name="sourceUrl" type="url" inputmode="url" autocapitalize="none" placeholder="https://your-old-returns-app.onrender.com" required><label>Original Returns app PIN</label><input name="pin" type="password" inputmode="numeric" autocomplete="off" required><button>Recover Returns and Photos</button><div class="result" aria-live="polite"></div></form>
  <p class="small">The URLs and PINs are used only for this transfer and are not saved.</p></main><script>
  async function recover(form,kind){const button=form.querySelector('button'),result=form.querySelector('.result');button.disabled=true;result.className='result';result.textContent='Checking the original app and copying data…';try{const body=Object.fromEntries(new FormData(form));const response=await fetch('/recovery/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Recovery failed.');result.className='result ok';result.textContent=data.message}catch(error){result.className='result bad';result.textContent=error.message}finally{button.disabled=false}}
  document.getElementById('pickForm').addEventListener('submit',event=>{event.preventDefault();recover(event.currentTarget,'pick')});document.getElementById('returnsForm').addEventListener('submit',event=>{event.preventDefault();recover(event.currentTarget,'returns')});
  </script></body></html>`;
}

function normalizeSourceUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter the complete original Render URL.'); }
  const localAllowed = process.env.RECOVERY_ALLOW_LOCAL === '1' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localAllowed && url.protocol !== 'https:') || (!localAllowed && !url.hostname.endsWith('.onrender.com'))) {
    throw new Error('The original app URL must be an https://…onrender.com address.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

async function fetchWithTimeout(url, options = {}, label = 'original app') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`The ${label} took too long to respond.`);
    throw new Error(`Could not reach the ${label}. Check its URL and confirm it is still running.`);
  } finally { clearTimeout(timer); }
}

async function fetchJson(url, options, label) {
  const response = await fetchWithTimeout(url, options, label);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    if (response.status === 401) throw new Error(`The ${label} PIN was not accepted.`);
    throw new Error(body.error || `${label} returned error ${response.status}.`);
  }
  return { response, body };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.recovery-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
  fs.renameSync(temporary, file);
}

function backup(file) {
  if (!fs.existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, `${file}.before-recovery-${stamp}.bak`);
}

function unique(values) {
  return [...new Set((values || []).map(value => String(value || '')).filter(Boolean))];
}

module.exports = function createRecoveryRouter({ dataRoot }) {
  const router = express.Router();
  router.get('/', (req, res) => res.type('html').send(page()));

  router.post('/api/pick', async (req, res) => {
    try {
      const base = normalizeSourceUrl(req.body?.sourceUrl);
      const pin = String(req.body?.pin || '');
      const headers = pin ? { 'x-app-pin': pin, Accept: 'application/json' } : { Accept: 'application/json' };
      const list = await fetchJson(new URL('/api/batches', base), { headers }, 'original Pick app');
      const summaries = Array.isArray(list.body.batches) ? list.body.batches : null;
      if (!summaries) throw new Error('The original Pick app returned an unexpected response.');

      const recovered = [];
      for (const summary of summaries) {
        const detailResult = await fetchJson(new URL(`/api/batches/${encodeURIComponent(summary.id)}`, base), { headers }, 'original Pick app');
        const detail = detailResult.body || {};
        const lines = Array.isArray(detail.lines) ? detail.lines : [];
        const orderNumbers = unique(detail.orderNumbers || lines.flatMap(line => (line.orders || []).map(order => order.orderNumber)));
        const orderIds = unique(lines.flatMap(line => (line.orders || []).map(order => order.orderId)));
        recovered.push({
          id: String(summary.id), name: String(summary.name || 'Recovered Pick Batch'),
          createdAt: summary.createdAt || new Date().toISOString(), status: summary.status || 'not_started',
          currentIndex: Number(summary.currentIndex || 0), orderIds, orderNumbers, lines,
          ...(summary.status === 'deleted' ? { statusBeforeDelete: 'not_started' } : {}),
          recoveredAt: new Date().toISOString(), recoveredFrom: base.origin
        });
      }

      const file = path.join(dataRoot, 'pick', 'pick-batches.json');
      const current = readJson(file, { batches: [] });
      if (!Array.isArray(current.batches)) current.batches = [];
      const existingIds = new Set(current.batches.map(batch => String(batch.id)));
      const additions = recovered.filter(batch => !existingIds.has(batch.id));
      if (additions.length) {
        backup(file);
        current.batches.push(...additions);
        current.batches.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        writeJson(file, current);
      }
      const archived = additions.filter(batch => batch.status === 'archived').length;
      const deleted = additions.filter(batch => batch.status === 'deleted').length;
      res.json({ ok: true, imported: additions.length, skipped: recovered.length - additions.length, message: `Pick recovery complete.\nImported: ${additions.length} (${archived} archived, ${deleted} recently deleted)\nAlready present and skipped: ${recovered.length - additions.length}\nCombined Pick total: ${current.batches.length}` });
    } catch (error) { res.status(400).json({ error: error.message || 'Pick recovery failed.' }); }
  });

  router.post('/api/returns', async (req, res) => {
    const tempDir = path.join(dataRoot, `returns-recovery-${crypto.randomBytes(6).toString('hex')}`);
    try {
      const base = normalizeSourceUrl(req.body?.sourceUrl);
      const pin = String(req.body?.pin || '');
      const login = await fetchJson(new URL('/api/pin', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ pin }) }, 'original Returns app');
      if (login.body.ok !== true) throw new Error('The original Returns app PIN was not accepted.');
      const cookie = String(login.response.headers.get('set-cookie') || '').split(';')[0];
      const headers = cookie ? { Cookie: cookie, Accept: 'application/json' } : { Accept: 'application/json' };
      const oldData = await fetchJson(new URL('/api/returns?all=1', base), { headers }, 'original Returns app');
      const sourceRows = Array.isArray(oldData.body.returns) ? oldData.body.returns : null;
      if (!sourceRows) throw new Error('The original Returns app returned an unexpected response.');

      const file = path.join(dataRoot, 'returns', 'returns.json');
      const uploadDir = path.join(dataRoot, 'returns', 'uploads');
      const current = readJson(file, []);
      if (!Array.isArray(current)) throw new Error('The combined Returns data file could not be read safely.');
      const existingIds = new Set(current.map(row => String(row.id || '')));
      const existingOrders = new Set(current.map(row => String(row.order_number || '').replace(/\D/g, '')).filter(Boolean));
      const additions = sourceRows.filter(row => {
        const order = String(row.order_number || '').replace(/\D/g, '');
        return !existingIds.has(String(row.id || '')) && (!order || !existingOrders.has(order));
      }).map(row => JSON.parse(JSON.stringify(row)));

      fs.mkdirSync(tempDir, { recursive: true });
      const photoMoves = [];
      let copiedPhotos = 0;
      for (const row of additions) {
        const keptPhotos = [];
        for (const photo of (Array.isArray(row.photos) ? row.photos : [])) {
          const sourcePhoto = new URL(String(photo), base);
          if (sourcePhoto.origin !== base.origin) throw new Error(`A photo for return ${row.order_number || row.id} points outside the original app.`);
          let filename = path.basename(sourcePhoto.pathname);
          if (!filename) continue;
          let destination = path.join(uploadDir, filename);
          if (fs.existsSync(destination)) {
            keptPhotos.push(`/uploads/${filename}`);
            continue;
          }
          if (photoMoves.some(item => item.destination === destination)) {
            filename = `recovered-${String(row.id || crypto.randomUUID()).slice(0, 12)}-${filename}`;
            destination = path.join(uploadDir, filename);
          }
          const response = await fetchWithTimeout(sourcePhoto, { headers: cookie ? { Cookie: cookie } : {} }, 'original Returns photo');
          if (!response.ok) throw new Error(`Could not copy a photo for return ${row.order_number || row.id} (error ${response.status}).`);
          const contentLength = Number(response.headers.get('content-length') || 0);
          if (contentLength > 15 * 1024 * 1024) throw new Error(`A photo for return ${row.order_number || row.id} is larger than 15 MB.`);
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 15 * 1024 * 1024) throw new Error(`A photo for return ${row.order_number || row.id} is larger than 15 MB.`);
          const temporary = path.join(tempDir, `${copiedPhotos}-${filename}`);
          fs.writeFileSync(temporary, buffer);
          photoMoves.push({ temporary, destination });
          keptPhotos.push(`/uploads/${filename}`);
          copiedPhotos += 1;
        }
        row.photos = keptPhotos;
        row.recovered_at = new Date().toISOString();
        row.recovered_from = base.origin;
      }

      if (additions.length) {
        fs.mkdirSync(uploadDir, { recursive: true });
        backup(file);
        for (const move of photoMoves) fs.renameSync(move.temporary, move.destination);
        current.push(...additions);
        writeJson(file, current);
      }
      const processCount = additions.filter(row => !['completed', 'archived'].includes(row.status)).length;
      const archivedCount = additions.filter(row => row.status === 'archived').length;
      res.json({ ok: true, imported: additions.length, skipped: sourceRows.length - additions.length, photos: copiedPhotos, message: `Returns recovery complete.\nImported: ${additions.length} (${processCount} in Process Returns, ${archivedCount} archived)\nPhotos copied: ${copiedPhotos}\nAlready present and skipped: ${sourceRows.length - additions.length}\nCombined Returns total: ${current.length}` });
    } catch (error) { res.status(400).json({ error: error.message || 'Returns recovery failed.' }); }
    finally { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  });

  return router;
};
