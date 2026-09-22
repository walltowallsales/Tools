'use strict';
const assert=require('assert');
const express=require('express');
const net=require('net');
const path=require('path');
const os=require('os');
const fs=require('fs');
const{spawn}=require('child_process');
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server))});
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  const source=express(),now=new Date().toISOString();
  const product={id:'p1',sku:'PICK-1',title:'Gateway Test Item',quantity_available:3,inventory_locations:[{id:'loc1',location:'A1',quantity_available:3,priority:1}]};
  source.use(express.json());
  source.get('/api/marketplace_accounts',(q,r)=>r.json({marketplace_accounts:[]}));
  source.get('/api/orders',(q,r)=>r.json({orders:Number(q.query.page||1)===1?[{id:'o1',order_number:'ORDER-1',created_at:now,paid:true,fulfilled_by:'seller',items:[{product_id:'p1',sku:'PICK-1',title:'Gateway Test Item',quantity:1}]}]:[]}));
  source.get('/api/products/:id',(q,r)=>r.json({product}));
  source.get('/api/products',(q,r)=>r.json({products:Number(q.query.page||1)===1?[product]:[]}));
  source.get('/api/manifests',(q,r)=>r.json({manifests:[]}));
  const sourceServer=await listen(source),port=await freePort(),dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'sellerchamp-gateway-'));
  const child=spawn(process.execPath,['gateway.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_ROOT:dataRoot,SELLERCHAMP_TOKEN:'test',SELLERCHAMP_BASE_URL:`http://127.0.0.1:${sourceServer.address().port}`,APP_PIN:'',SC_REQUEST_GAP_MS:'1',SC_RETRY_BASE_MS:'5'},stdio:['ignore','pipe','pipe']});
  try{
    const base=`http://127.0.0.1:${port}`;
    let ready=false;
    for(let i=0;i<120;i++){try{const r=await fetch(`${base}/shipping/api/health`);if(r.ok){ready=true;break}}catch{}await delay(50)}
    assert.ok(ready,'Pick module did not start');
    const response=await fetch(`${base}/shipping/api/batches`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
    const body=await response.json();
    assert.equal(response.status,201,body.error||'snapshot request failed');
    assert.equal(body.batch.orderCount,1);
    assert.equal(body.lines.length,1);
    console.log('Gateway POST-body test passed: Pick snapshot request reached the module and completed.');
  }finally{
    child.kill('SIGTERM');
    await delay(300);
    await new Promise(resolve=>sourceServer.close(resolve));
    fs.rmSync(dataRoot,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
