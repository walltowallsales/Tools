'use strict';

const assert = require('assert');
const express = require('express');
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
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
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'sellerchamp-move-index-'));
  const products = [
    { id:'p1', sku:'ABC12345', upc:'012345678905', title:'Blue Industrial Widget', quantity_available:4, primary_image_url:'https://example.test/blue.jpg' },
    { id:'p2', sku:'ZZZ90000', upc:'998877665544', title:'Red Control Module', quantity_available:2 },
    { id:'p3', sku:'PARENT100', upc:'', title:'Green Variant Assembly', quantity_available:1, variants:[{sku:'VARIANT777',upc:'777788889999'}] }
  ];
  // Simulates an older item that is not present on the first general catalogue
  // page but is returned when SellerChamp receives a targeted SKU filter.
  const olderProduct = { id:'p-old', sku:'2510-42859', upc:'', title:'Watlow U3-29-242-1 Immersion Heating 14Kw', quantity_available:1 };
  const source = express();
  source.use(express.json());
  source.get('/api/marketplace_accounts', (req,res) => res.json({marketplace_accounts:[]}));
  source.get('/api/products.json', (req,res) => {
    const page=Number(req.query.page||1);
    if (req.query.sku === '42859' || req.query.sku === '2510-42859') {
      return res.json({products:[olderProduct]});
    }
    // Return the full page even for filters. This verifies that exact lookup
    // rejects SellerChamp's first unrelated row instead of selecting it.
    res.json({products:page===1?products:[]});
  });
  source.get('/api/products/:id.json', (req,res) => {
    const product=[...products,olderProduct].find(row=>row.id===req.params.id);
    product?res.json({product}):res.status(404).json({error:'not found'});
  });
  source.get('/api/products/:id/inventory_locations', (req,res) => res.json({inventory_locations:[{id:`loc-${req.params.id}`,location:'A0101',quantity_available:4,priority:1}]}));
  source.get('/api/master_products', (req,res) => res.status(404).json({error:'not enabled'}));
  source.get('/api/manifests', (req,res) => res.status(404).json({error:'none'}));
  const sourceServer=await listen(source);
  const appPort=await freePort();
  const child=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..','modules','location'),
    env:{...process.env,PORT:String(appPort),DATA_DIR:dataDir,SELLERCHAMP_TOKEN:'test-token',SELLERCHAMP_BASE_URL:`http://127.0.0.1:${sourceServer.address().port}`},
    stdio:['ignore','pipe','pipe']
  });

  try {
    const base=`http://127.0.0.1:${appPort}`;
    await waitFor(`${base}/api/status`);
    let response=await fetch(`${base}/api/lookup?code=ABC12345`);
    let body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.product.sku,'ABC12345');

    for(let attempt=0;attempt<40;attempt+=1){
      response=await fetch(`${base}/api/status`);body=await response.json();
      if(body.search_index?.count>=3&&!body.search_index?.building)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(body.search_index?.count>=3,'local search index was not built');

    response=await fetch(`${base}/api/lookup?code=ABC`);
    assert.equal(response.status,404,'partial input must not select an unrelated first product');

    for (const test of [
      {q:'BC123',sku:'ABC12345',label:'SKU match'},
      {q:'5678',sku:'ABC12345',label:'UPC match'},
      {q:'industrial wid',sku:'ABC12345',label:'Title match'},
      {q:'IANT77',sku:'VARIANT777',label:'SKU match'},
      {q:'888899',sku:'PARENT100',label:'UPC match'},
      {q:'42859',sku:'2510-42859',label:'SKU match'}
    ]) {
      response=await fetch(`${base}/api/item-search?q=${encodeURIComponent(test.q)}`);
      body=await response.json();
      assert.equal(response.status,200);
      const match=body.results.find(row=>row.sku===test.sku);
      assert.ok(match,`missing ${test.q} match`);
      assert.equal(match.match_label,test.label);
    }
    response=await fetch(`${base}/api/item-search?q=BC123`);body=await response.json();
    assert.equal(body.source,'local-index','partial search should use the local index');

    response=await fetch(`${base}/api/lookup?code=2510-42859&productId=p-old`);body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.product.sku,'2510-42859');
    assert.equal(body.product.locations[0].location,'A0101','selected index result must reload live locations');
    console.log('Move search test passed: local index, live fallback, and live selected-product details.');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => sourceServer.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
