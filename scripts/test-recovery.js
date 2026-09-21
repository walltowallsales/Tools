'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createRecoveryRouter = require('../recovery');

process.env.RECOVERY_ALLOW_LOCAL = '1';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-recovery-test-'));

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const source = express();
  source.use(express.json());
  const pickBatches = [
    { id:'pick-archived', name:'Old archived', createdAt:'2026-09-01T10:00:00Z', status:'archived', currentIndex:1 },
    { id:'pick-deleted', name:'Old deleted', createdAt:'2026-08-01T10:00:00Z', status:'deleted', currentIndex:0 }
  ];
  source.get('/api/batches', (req,res) => req.get('x-app-pin') === '2468' ? res.json({batches:pickBatches}) : res.status(401).json({error:'PIN required'}));
  source.get('/api/batches/:id', (req,res) => {
    if (req.get('x-app-pin') !== '2468') return res.status(401).json({error:'PIN required'});
    const batch = pickBatches.find(item => item.id === req.params.id);
    res.json({ batch, orderNumbers:['12-34567-89012'], lines:[{id:`line-${batch.id}`,sku:'SKU1',quantityToPick:1,picked:true,orders:[{orderId:'order-1',orderNumber:'12-34567-89012',quantity:1}]}] });
  });
  source.post('/api/pin', (req,res) => {
    if (req.body.pin !== '1357') return res.json({ok:false});
    res.setHeader('Set-Cookie','old_returns_auth=good; Path=/; HttpOnly');
    res.json({ok:true});
  });
  const requireCookie = (req,res,next) => req.get('cookie') === 'old_returns_auth=good' ? next() : res.status(401).json({error:'PIN required'});
  source.get('/api/returns', requireCookie, (req,res) => res.json({returns:[
    {id:'return-process',order_number:'11-11111-11111',sku:'SKU-R1',status:'awaiting_processing',photos:['/uploads/return-photo.jpg'],history:[{action:'received'}]},
    {id:'return-archive',order_number:'22-22222-22222',sku:'SKU-R2',status:'archived',photos:[],history:[{action:'archived'}]}
  ]}));
  source.get('/uploads/return-photo.jpg', requireCookie, (req,res) => res.type('jpg').send(Buffer.from('fake-image-data')));

  const sourceServer = await listen(source);
  const sourceUrl = `http://127.0.0.1:${sourceServer.address().port}`;
  const target = express();
  target.use(express.json());
  target.use('/recovery', createRecoveryRouter({dataRoot:temp}));
  const targetServer = await listen(target);
  const targetUrl = `http://127.0.0.1:${targetServer.address().port}`;

  try {
    let response = await fetch(`${targetUrl}/recovery/api/pick`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceUrl,pin:'2468'})});
    let result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.imported, 2);
    let pick = JSON.parse(fs.readFileSync(path.join(temp,'pick','pick-batches.json'),'utf8'));
    assert.equal(pick.batches.length, 2);
    assert.deepEqual(pick.batches[0].orderIds, ['order-1']);

    response = await fetch(`${targetUrl}/recovery/api/pick`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceUrl,pin:'2468'})});
    result = await response.json();
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 2);

    response = await fetch(`${targetUrl}/recovery/api/returns`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceUrl,pin:'1357'})});
    result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.imported, 2);
    assert.equal(result.photos, 1);
    let returns = JSON.parse(fs.readFileSync(path.join(temp,'returns','returns.json'),'utf8'));
    assert.equal(returns.length, 2);
    assert.equal(returns.find(row => row.id === 'return-process').photos[0], '/uploads/return-photo.jpg');
    assert.ok(fs.existsSync(path.join(temp,'returns','uploads','return-photo.jpg')));

    response = await fetch(`${targetUrl}/recovery/api/returns`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceUrl,pin:'1357'})});
    result = await response.json();
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 2);
    console.log('Recovery integration test passed: Pick, Returns, photos, and duplicate protection.');
  } finally {
    await new Promise(resolve => targetServer.close(resolve));
    await new Promise(resolve => sourceServer.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

main().catch(error => { console.error(error); process.exitCode=1; });
