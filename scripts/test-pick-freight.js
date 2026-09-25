'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawn}=require('child_process');

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pick-freight-'));
const port=39041;
const batchId='batch-test',lineId='line-test';
fs.writeFileSync(path.join(dataDir,'pick-batches.json'),JSON.stringify({batches:[{
  id:batchId,name:'Test Batch',createdAt:new Date().toISOString(),status:'in_progress',currentIndex:0,
  orderIds:['order-1'],orderNumbers:['100-200'],lines:[{
    id:lineId,sku:'2403-40573',title:'Freight Test Item',condition:'Used',image:'',location:'C0113',
    quantityToPick:1,quantityOnHand:1,picked:false,orders:[{orderId:'order-1',orderNumber:'100-200',quantity:1}]
  }]
}],freightItems:[]},null,2));

const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..','modules','pick'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,APP_PIN:''},stdio:['ignore','pipe','pipe']});
const base=`http://127.0.0.1:${port}`;
async function request(url,opts={}){const r=await fetch(base+url,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});const j=await r.json();if(!r.ok)throw new Error(`${r.status} ${JSON.stringify(j)}`);return j}
async function wait(){for(let i=0;i<50;i++){try{return await request('/api/health')}catch(_){await new Promise(r=>setTimeout(r,50))}}throw new Error('Pick test server did not start')}
(async()=>{
  try{
    await wait();
    const marked=await request(`/api/batches/${batchId}/lines/${lineId}/freight`,{method:'POST',body:JSON.stringify({stage:'not_packed',notes:'Call carrier'})});
    if(!marked.line.freightId||marked.batch.freightStops!==1)throw new Error('Freight marker was not saved');
    let queue=await request('/api/freight');
    if(queue.outstandingCount!==1||queue.freight[0].notes!=='Call carrier')throw new Error('Outstanding freight queue is incorrect');
    await request(`/api/freight/${marked.freight.id}`,{method:'PATCH',body:JSON.stringify({action:'return_to_pick'})});
    queue=await request('/api/freight');
    if(queue.outstandingCount!==0)throw new Error('Return to pick did not clear outstanding freight');
    const batch=await request(`/api/batches/${batchId}`);
    if(batch.lines[0].freightId||batch.lines[0].picked)throw new Error('Returned freight line was not restored to picking');
    const markedAgain=await request(`/api/batches/${batchId}/lines/${lineId}/freight`,{method:'POST',body:JSON.stringify({stage:'packed'})});
    await request(`/api/freight/${markedAgain.freight.id}`,{method:'PATCH',body:JSON.stringify({action:'complete'})});
    queue=await request('/api/freight');
    if(queue.outstandingCount!==0||!queue.freight.some(f=>f.id===markedAgain.freight.id&&f.status==='completed'))throw new Error('Freight completion was not saved');
    console.log('Pick freight workflow OK: defer, queue, return, and complete are persistent.');
  }finally{child.kill('SIGTERM');fs.rmSync(dataDir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
