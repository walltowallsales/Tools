'use strict';

const assert = require('assert');
const express = require('express');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Location Mover test server did not start.');
}

async function main() {
  const products = [
    { id:'p1', sku:'ABC12345', upc:'012345678905', title:'Blue Industrial Widget', quantity_available:4, primary_image_url:'https://example.test/blue.jpg' },
    { id:'p2', sku:'ZZZ90000', upc:'998877665544', title:'Red Control Module', quantity_available:2 },
    { id:'p3', sku:'PARENT100', upc:'', title:'Green Variant Assembly', quantity_available:1, variants:[{sku:'VARIANT777',upc:'777788889999'}] }
  ];
  const source = express();
  source.use(express.json());
  source.get('/api/marketplace_accounts', (req,res) => res.json({marketplace_accounts:[]}));
  source.get('/api/products.json', (req,res) => {
    const page=Number(req.query.page||1);
    // Return the full page even for filters. This verifies that exact lookup
    // rejects SellerChamp's first unrelated row instead of selecting it.
    res.json({products:page===1?products:[]});
  });
  source.get('/api/products/:id.json', (req,res) => {
    const product=products.find(row=>row.id===req.params.id);
    product?res.json({product}):res.status(404).json({error:'not found'});
  });
  source.get('/api/products/:id/inventory_locations', (req,res) => res.json({inventory_locations:[{id:`loc-${req.params.id}`,location:'A0101',quantity_available:4,priority:1}]}));
  source.get('/api/master_products', (req,res) => res.status(404).json({error:'not enabled'}));
  source.get('/api/manifests', (req,res) => res.status(404).json({error:'none'}));
  const sourceServer=await listen(source);
  const appPort=await freePort();
  const child=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..','modules','location'),
    env:{...process.env,PORT:String(appPort),SELLERCHAMP_TOKEN:'test-token',SELLERCHAMP_BASE_URL:`http://127.0.0.1:${sourceServer.address().port}`},
    stdio:['ignore','pipe','pipe']
  });

  try {
    const base=`http://127.0.0.1:${appPort}`;
    await waitFor(`${base}/api/status`);
    let response=await fetch(`${base}/api/lookup?code=ABC12345`);
    let body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.product.sku,'ABC12345');

    response=await fetch(`${base}/api/lookup?code=ABC`);
    assert.equal(response.status,404,'partial input must not select an unrelated first product');

    for (const test of [
      {q:'BC123',sku:'ABC12345',label:'SKU match'},
      {q:'5678',sku:'ABC12345',label:'UPC match'},
      {q:'industrial wid',sku:'ABC12345',label:'Title match'},
      {q:'IANT77',sku:'VARIANT777',label:'SKU match'},
      {q:'888899',sku:'PARENT100',label:'UPC match'}
    ]) {
      response=await fetch(`${base}/api/item-search?q=${encodeURIComponent(test.q)}`);
      body=await response.json();
      assert.equal(response.status,200);
      const match=body.results.find(row=>row.sku===test.sku);
      assert.ok(match,`missing ${test.q} match`);
      assert.equal(match.match_label,test.label);
    }
    console.log('Move search test passed: exact lookup plus partial SKU, UPC, title, and variant matching.');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => sourceServer.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
