'use strict';
const fs = require('fs');
const path = require('path');
const expected = ['location', 'inventory', 'auction', 'tag-sort', 'pick', 'returns'];
for (const name of expected) {
  for (const file of ['server.js', 'public/index.html', 'public/app.js', 'public/styles.css']) {
    const target = path.join(__dirname, '..', 'modules', name, file);
    if (!fs.existsSync(target)) throw new Error(`Missing ${target}`);
  }
}
const gateway = fs.readFileSync(path.join(__dirname, '..', 'gateway.js'), 'utf8');
for (const slug of ['move', 'inventory', 'auction', 'tags', 'shipping', 'returns']) {
  if (!gateway.includes(`slug: '${slug}'`)) throw new Error(`Missing gateway route ${slug}`);
}
if (!gateway.includes("suite: '1.17.0'")) throw new Error('Suite version is not 1.17.0');
if (gateway.includes("app.use(express.json")) throw new Error('Gateway must not consume proxied JSON request bodies');
for (const name of expected) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'modules', name, 'public', 'index.html'), 'utf8');
  if (!html.includes('class="suite-back" href="/"')) throw new Error(`Missing SellerChamp Tools return link in ${name}`);
}
if (gateway.includes('Recover Existing Data') || gateway.includes("require('./recovery')")) throw new Error('Recovery feature is still linked');
console.log('Suite structure OK: 6 modules, dashboard, and all return links are present.');
