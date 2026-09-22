'use strict';
const express=require('express');
const path=require('path');
const fs=require('fs');
const app=express();
const PORT=process.env.PORT||3000;
const TOKEN=process.env.SELLERCHAMP_TOKEN||process.env.SELLERCHAMP_API_TOKEN||'';
const SC_BASE=(process.env.SELLERCHAMP_BASE_URL||'https://app.sellerchamp.com').replace(/\/$/,'');
const DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(__dirname,'data'));
const PRODUCT_INDEX=path.join(DATA_DIR,'move-product-search-index.json');
const BATCH_INDEX=path.join(DATA_DIR,'tag-batch-search-index.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
app.use(express.json({limit:'100kb'}));
app.use(express.static(path.join(__dirname,'public')));

const REQUEST_GAP_MS=Number(process.env.SC_REQUEST_GAP_MS||750),RETRY_BASE_MS=Number(process.env.SC_RETRY_BASE_MS||2000);let scQueue=Promise.resolve(),lastScAt=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scDirect(endpoint){
  for(let attempt=0;attempt<7;attempt++){
    const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastScAt));if(wait)await sleep(wait);lastScAt=Date.now();
    const response=await fetch(SC_BASE+endpoint,{headers:{Token:TOKEN,'Content-Type':'application/json'}});
    const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(response.status===429){const retryDelay=Math.min(30000,RETRY_BASE_MS*Math.pow(1.7,attempt));progress.rate_limited=(progress.rate_limited||0)+1;progress.waiting_seconds=Math.ceil(retryDelay/1000);await sleep(retryDelay);continue}
    progress.waiting_seconds=0;
    if(!response.ok){const error=new Error(`SellerChamp returned ${response.status}`);error.status=response.status;error.data=data;throw error}return data;
  }
  const error=new Error('SellerChamp is still rate-limiting the refresh. Wait five minutes and try again.');error.status=429;throw error;
}
function sc(endpoint){const job=scQueue.then(()=>scDirect(endpoint));scQueue=job.catch(()=>{});return job}
function tagsOf(row){
  const candidates=[row,row?.product,row?.master_product,row?.product_listing,row?.catalogue_product].filter(Boolean);
  const found=[];
  for(const candidate of candidates){
    const raw=candidate.tags_array??candidate.tags??candidate.tag_list??candidate.product_tags??candidate.tag_names??candidate.tags_string??[];
    for(const value of (Array.isArray(raw)?raw:String(raw).split(','))){const tag=typeof value==='string'?value.trim():String(value?.name||value?.tag||value?.label||'').trim();if(tag&&!found.some(x=>x.toLowerCase()===tag.toLowerCase()))found.push(tag)}
  }
  return found;
}
function imageOf(p){return p?.primary_image||p?.primary_image_url||p?.image_url||p?.image||p?.product_images?.[0]?.large_image_url||p?.product_images?.[0]?.image_url||''}
function locationsOf(p){const rows=(Array.isArray(p?.inventory_locations)?p.inventory_locations:[]).map(x=>({location:String(x.location||''),quantity:Number(x.quantity_available||0)}));if(!rows.length&&(p?.item_location||p?.bin_location||p?.warehouse_location))rows.push({location:String(p.item_location||p.bin_location||p.warehouse_location),quantity:Number(p.quantity_available||0)});return rows}
function load(file){try{const data=JSON.parse(fs.readFileSync(file,'utf8'));return {items:Array.isArray(data.items)?data.items:[],updated_at:data.updated_at||null}}catch{return {items:[],updated_at:null}}}
function write(file,data,suffix){const temporary=`${file}.${suffix}.tmp`;fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,file)}
function natural(a,b){return String(a||'ZZZZ').localeCompare(String(b||'ZZZZ'),undefined,{numeric:true,sensitivity:'base'})}
let building=false,buildError='',activeProducts=[],activeBatches=[];
let progress={phase:'idle',products:0,indexed_products:0,tagged_products:0,unique_tags:0,batches:0,rate_limited:0,waiting_seconds:0};

function currentItems(){
  const savedProducts=load(PRODUCT_INDEX).items,savedBatches=load(BATCH_INDEX).items;
  const products=building&&activeProducts.length?activeProducts:savedProducts;
  const batches=building&&progress.phase==='batches'?activeBatches:savedBatches;
  return [...products,...batches];
}

async function buildIndexes(){
  if(building)return;building=true;buildError='';activeProducts=[];activeBatches=[];
  try{
    progress={phase:'products',products:0,indexed_products:0,tagged_products:0,unique_tags:0,batches:0,rate_limited:0,waiting_seconds:0};
    const products=activeProducts,seen=new Set(),uniqueTags=new Set();
    for(let page=1;page<=5000;page++){
      const data=await sc(`/api/products?page=${page}&page_size=100`),rows=Array.isArray(data.products)?data.products:[];
      for(const p of rows){
        const variants=Array.isArray(p.variants)?p.variants:[];
        const productTags=tagsOf(p);let productLocations=locationsOf(p);
        if(productTags.length){progress.tagged_products+=1;for(const tag of productTags)uniqueTags.add(tag.toLowerCase())}
        if(productTags.length&&!productLocations.length&&p.id){try{const inventory=await sc(`/api/products/${encodeURIComponent(p.id)}/inventory_locations`);productLocations=(inventory.inventory_locations||[]).map(x=>({location:String(x.location||''),quantity:Number(x.quantity_available||0)}))}catch{}}
        const base={id:p.id||'',sku:String(p.sku||p.custom_catalogue_sku||p.catalogue_sku||''),upc:String(p.upc||p.barcode||''),title:String(p.title||p.product_title||''),image:imageOf(p),quantity_available:Number(p.quantity_available||0),tags:productTags,locations:productLocations,status:String(p.marketplace_status||p.status||''),source:'product'};
        for(const row of [base,...variants.map(v=>({...base,sku:String(v.sku||base.sku),upc:String(v.upc||v.barcode||base.upc)}))]){const key=`${row.id}|${row.sku}|${row.upc}`;if(!seen.has(key)){seen.add(key);products.push(row)}}
      }
      progress.products+=rows.length;progress.indexed_products=products.length;progress.unique_tags=uniqueTags.size;if(!rows.length||rows.length<100)break;
    }
    const now=new Date().toISOString();write(PRODUCT_INDEX,{updated_at:now,items:products},'tags');

    progress.phase='batches';const batches=activeBatches,batchSeen=new Set();
    for(let page=1;page<=500;page++){
      const data=await sc(`/api/manifests?page=${page}&page_size=100`);let manifests=data.manifests||[];if(!Array.isArray(manifests))manifests=manifests?[manifests]:[];
      for(const manifest of manifests){
        if(!manifest?.id)continue;
        for(let listingPage=1;listingPage<=100;listingPage++){
          const listingData=await sc(`/api/manifests/${encodeURIComponent(manifest.id)}/product_listings?page=${listingPage}&page_size=100`);let listings=listingData.product_listings||[];if(!Array.isArray(listings))listings=listings?[listings]:[];
          for(const row of listings){const tags=tagsOf(row);if(!tags.length)continue;const key=`${manifest.id}|${row.id||row.sku}`;if(batchSeen.has(key))continue;batchSeen.add(key);batches.push({id:row.id||'',product_id:row.product_id||'',manifest_id:manifest.id,manifest_name:manifest.name||'',sku:String(row.sku||row.custom_catalogue_sku||row.catalogue_sku||''),upc:String(row.upc||row.barcode||''),title:String(row.title||''),image:imageOf(row),quantity_available:Number(row.quantity_available??row.quantity??0),tags,locations:[{location:String(row.location||row.item_location||''),quantity:Number(row.quantity_available??row.quantity??0)}],status:String(manifest.status||''),source:'batch',url:`https://app.sellerchamp.com/manifests/${encodeURIComponent(manifest.id)}?product_listing%5Bquery%5D=${encodeURIComponent(row.sku||'')}`});progress.batches=batches.length}
          if(listings.length<100)break;
        }
      }
      if(manifests.length<100)break;
    }
    write(BATCH_INDEX,{updated_at:now,items:batches},'tags');progress.phase='complete';
  }catch(error){buildError=error.message||'Refresh failed.';progress.phase='error';throw error}finally{building=false}
}

app.get('/api/status',async(req,res)=>{try{if(!building)await sc('/api/marketplace_accounts');const p=load(PRODUCT_INDEX),b=load(BATCH_INDEX);res.json({ok:true,version:'1.4.0',building,error:buildError,progress,products:p.items.length,batches:b.items.length,updated_at:[p.updated_at,b.updated_at].filter(Boolean).sort().at(-1)||null})}catch(e){res.status(e.status||500).json({error:'Could not connect to SellerChamp.',details:e.data||e.message})}});
app.get('/api/tags',(req,res)=>{
  const all=currentItems(),byTag=new Map();
  for(const row of all){
    for(const raw of row.tags||[]){
      const tag=String(raw||'').trim();if(!tag)continue;const key=tag.toLowerCase();
      if(!byTag.has(key))byTag.set(key,{tag,product_count:0,batch_count:0,total_count:0});
      const entry=byTag.get(key);if(row.source==='batch')entry.batch_count+=1;else entry.product_count+=1;entry.total_count+=1;
    }
  }
  const tag_options=[...byTag.values()].sort((a,b)=>natural(a.tag,b.tag));
  res.json({tags:tag_options.map(x=>x.tag),tag_options});
});
app.get('/api/search',(req,res)=>{const tag=String(req.query.tag||'').trim().toLowerCase(),source=String(req.query.source||'all');if(!tag)return res.status(400).json({error:'Enter a tag to search.'});let rows=currentItems().filter(x=>(x.tags||[]).some(t=>String(t).toLowerCase()===tag));if(source!=='all')rows=rows.filter(x=>x.source===source);rows.sort((a,b)=>natural(a.locations?.[0]?.location,b.locations?.[0]?.location)||natural(a.sku,b.sku));res.json({results:rows,count:rows.length,building})});
app.post('/api/refresh',(req,res)=>{if(!building)buildIndexes().catch(error=>console.error('Tag index refresh failed:',error.message));res.status(202).json({ok:true,building:true,message:building?'Refresh already running.':'Refresh started.'})});
app.get('/api/product/:id/live',async(req,res)=>{try{const detail=await sc(`/api/products/${encodeURIComponent(req.params.id)}.json`),product=detail.product||detail||{};let inventory=[];try{inventory=(await sc(`/api/products/${encodeURIComponent(req.params.id)}/inventory_locations`)).inventory_locations||[]}catch{}res.json({product:{id:product.id,sku:product.sku||'',title:product.title||'',image:imageOf(product),tags:tagsOf(product),locations:inventory.map(x=>({location:x.location||'',quantity:Number(x.quantity_available||0)})),quantity_available:Number(product.quantity_available||0),status:String(product.marketplace_status||product.status||'')}})}catch(e){res.status(e.status||500).json({error:'Could not reload this product.',details:e.data||e.message})}});
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>{console.log(`SellerChamp Tag Location Sorter running on ${PORT}`);const p=load(PRODUCT_INDEX),b=load(BATCH_INDEX);if(!p.items.length||!b.items.length)buildIndexes().catch(error=>console.error('Initial tag index refresh failed:',error.message))});
setInterval(()=>{if(!building)buildIndexes().catch(error=>console.error('Scheduled tag index refresh failed:',error.message))},24*60*60*1000).unref();
