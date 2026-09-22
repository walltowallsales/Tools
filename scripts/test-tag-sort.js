'use strict';
const assert=require('assert');const express=require('express');const net=require('net');const path=require('path');const os=require('os');const fs=require('fs');const{spawn}=require('child_process');
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server))});
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});
async function main(){
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'sellerchamp-tags-'));const source=express();
 const products=[{id:'p1',sku:'TAG-2',title:'Second Shelf',tags_array:['Reserved Quantity','auction'],inventory_locations:[{location:'C10',quantity_available:2}],quantity_available:2},{id:'p2',sku:'TAG-1',title:'First Shelf',tags_array:['Reserved Quantity','Blue'],inventory_locations:[{location:'C2',quantity_available:1}],quantity_available:1}];
 source.get('/api/marketplace_accounts',(q,r)=>r.json({marketplace_accounts:[]}));
 let productRequests=0;source.get('/api/products',(q,r)=>{productRequests+=1;if(productRequests===1)return r.status(429).json({error:'rate limited'});r.json({products:Number(q.query.page||1)===1?products:[]})});
 source.get('/api/products/:id.json',(q,r)=>r.json({product:products.find(x=>x.id===q.params.id)}));
 source.get('/api/products/:id/inventory_locations',(q,r)=>r.json({inventory_locations:products.find(x=>x.id===q.params.id)?.inventory_locations||[]}));
 source.get('/api/manifests',(q,r)=>r.json({manifests:Number(q.query.page||1)===1?[{id:'m1',name:'Draft',status:'open'}]:[]}));
 source.get('/api/manifests/:id/product_listings',(q,r)=>r.json({product_listings:Number(q.query.page||1)===1?[{id:'b1',sku:'BATCH-1',title:'Batch Item',tags_array:['Reserved Quantity'],location:'B4',quantity:3}]:[]}));
 const sourceServer=await listen(source),port=await freePort(),child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..','modules','tag-sort'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,SC_REQUEST_GAP_MS:'1',SC_RETRY_BASE_MS:'5',SELLERCHAMP_TOKEN:'test',SELLERCHAMP_BASE_URL:`http://127.0.0.1:${sourceServer.address().port}`},stdio:['ignore','pipe','pipe']});
 try{const base=`http://127.0.0.1:${port}`;let status;
  for(let i=0;i<80;i++){try{const response=await fetch(`${base}/api/status`);status=await response.json();if(response.ok&&!status.building&&status.products===2&&status.batches===1)break}catch{}await new Promise(r=>setTimeout(r,50))}
  assert.equal(status.products,2);assert.equal(status.batches,1);assert.ok(status.progress.rate_limited>=1,'429 retry was not exercised');
  let response=await fetch(`${base}/api/search?tag=Reserved%20Quantity&source=all`),body=await response.json();assert.equal(body.count,3);assert.deepEqual(body.results.map(x=>x.locations[0].location),['B4','C2','C10']);
  response=await fetch(`${base}/api/search?tag=auction&source=all`);body=await response.json();assert.equal(body.count,1);assert.equal(body.results[0].sku,'TAG-2');
  response=await fetch(`${base}/api/product/p2/live`);body=await response.json();assert.equal(body.product.locations[0].location,'C2');assert.equal(body.product.quantity_available,1);
  console.log('Tag sorter test passed: Product and Batch tags, natural location order, and live Product reload.');
 }finally{child.kill('SIGTERM');await new Promise(r=>sourceServer.close(r));fs.rmSync(dataDir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
