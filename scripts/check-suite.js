'use strict';
const fs = require('fs');
const path = require('path');
const expected = ['location', 'inventory', 'auction', 'pick', 'returns'];
for (const name of expected) {
  for (const file of ['server.js', 'public/index.html', 'public/app.js', 'public/styles.css']) {
    const target = path.join(__dirname, '..', 'modules', name, file);
    if (!fs.existsSync(target)) throw new Error(`Missing ${target}`);
  }
}
const gateway = fs.readFileSync(path.join(__dirname, '..', 'gateway.js'), 'utf8');
for (const slug of ['move', 'inventory', 'auction', 'shipping', 'returns']) {
  if (!gateway.includes(`slug: '${slug}'`)) throw new Error(`Missing gateway route ${slug}`);
}
console.log('Suite structure OK: 5 modules and gateway are present.');
