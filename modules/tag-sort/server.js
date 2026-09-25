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
const REMOVED_TAGS=path.join(DATA_DIR,'tag-removal-overrides.json');
const TAG_OVERRIDE_DAYS=Number(process.env.TAG_OVERRIDE_DAYS||3);
fs.mkdirSync(DATA_DIR,{recursive:true});
app.use(express.json({limit:'100kb'}));
app.use(express.static(path.join(__dirname,'public')));

const REQUEST_GAP_MS=Number(process.env.SC_REQUEST_GAP_MS||2500),RETRY_BASE_MS=Number(process.env.SC_RETRY_BASE_MS||60000);let scQueue=Promise.resolve(),lastScAt=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scDirect(endpoint,options={}){
  for(let attempt=0;attempt<7;attempt++){
    const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastScAt));if(wait)await sleep(wait);lastScAt=Date.now();
    const response=await fetch(SC_BASE+endpoint,{...options,headers:{Token:TOKEN,'Content-Type':'application/json',...(options.headers||{})}});
    const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(response.status===429){const retryDelay=Math.max(Number(response.headers.get('retry-after')||0)*1000,RETRY_BASE_MS);progress.rate_limited=(progress.rate_limited||0)+1;progress.waiting_seconds=Math.ceil(retryDelay/1000);await sleep(retryDelay);continue}
    progress.waiting_seconds=0;
    if(!response.ok){const error=new Error(`SellerChamp returned ${response.status}`);error.status=response.status;error.data=data;throw error}return data;
  }
  const error=new Error('SellerChamp is still rate-limiting the refresh. Wait five minutes and try again.');error.status=429;throw error;
}
function sc(endpoint,options={}){const job=scQueue.then(()=>scDirect(endpoint,options));scQueue=job.catch(()=>{});return job}
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
function titlesOf(p){return [...new Set([p?.title,p?.product_title,p?.marketplace_title,p?.listing_title,p?.ebay_title,p?.product?.title,p?.product_listing?.title,p?.master_product?.title,...(Array.isArray(p?.variants)?p.variants.flatMap(v=>[v.title,v.product_title,v.listing_title]):[]),...(Array.isArray(p?.product_listings)?p.product_listings.map(v=>v.title||v.product_title):[])].filter(x=>typeof x==='string'&&x.trim()))]}
function locationsOf(p){const rows=(Array.isArray(p?.inventory_locations)?p.inventory_locations:[]).map(x=>({location:String(x.location||''),quantity:Number(x.quantity_available||0)}));if(!rows.length&&(p?.item_location||p?.bin_location||p?.warehouse_location))rows.push({location:String(p.item_location||p.bin_location||p.warehouse_location),quantity:Number(p.quantity_available||0)});return rows}
function load(file){try{const data=JSON.parse(fs.readFileSync(file,'utf8'));return {items:Array.isArray(data.items)?data.items:[],updated_at:data.updated_at||null}}catch{return {items:[],updated_at:null}}}
function write(file,data,suffix){const temporary=`${file}.${suffix}.tmp`;fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,file)}
function loadTagOverrides(){try{const data=JSON.parse(fs.readFileSync(REMOVED_TAGS,'utf8')),cutoff=Date.now()-TAG_OVERRIDE_DAYS*86400000;const removals={};for(const [id,entries] of Object.entries(data.removals||{})){const active=(Array.isArray(entries)?entries:[]).filter(x=>Date.parse(x.removed_at||0)>=cutoff&&x.tag);if(active.length)removals[id]=active}return removals}catch{return {}}}
function recordTagRemoval(id,tag){const removals=loadTagOverrides(),key=String(id),lower=String(tag).toLowerCase(),entries=(removals[key]||[]).filter(x=>String(x.tag).toLowerCase()!==lower);entries.push({tag:String(tag),removed_at:new Date().toISOString()});removals[key]=entries;write(REMOVED_TAGS,{removals},'removed-tag')}
function applyTagOverrides(row,removals=loadTagOverrides()){if(row?.source==='batch')return row;const blocked=removals[String(row?.id)]||[];if(!blocked.length)return row;const blockedNames=new Set(blocked.map(x=>String(x.tag).toLowerCase()));return {...row,tags:(row.tags||[]).filter(tag=>!blockedNames.has(String(tag).toLowerCase()))}}
function natural(a,b){return String(a||'ZZZZ').localeCompare(String(b||'ZZZZ'),undefined,{numeric:true,sensitivity:'base'})}
function productStatus(product){return String(product?.marketplace_status||product?.status||'unknown').toLowerCase()}
let building=false,buildError='',activeProducts=[],activeBatches=[];
let progress={phase:'idle',products:0,indexed_products:0,tagged_products:0,unique_tags:0,batches:0,rate_limited:0,waiting_seconds:0};

function currentItems(){
  const savedProducts=load(PRODUCT_INDEX).items,savedBatches=load(BATCH_INDEX).items;
  const products=building&&activeProducts.length?activeProducts:savedProducts;
  const batches=building&&progress.phase==='batches'?activeBatches:savedBatches;
  const removals=loadTagOverrides();return [...products.map(row=>applyTagOverrides(row,removals)),...batches];
}

async function liveProduct(id){
  const detail=await sc(`/api/products/${encodeURIComponent(id)}.json`),product=detail.product||detail||{};
  let inventory=[];
  try{inventory=(await sc(`/api/products/${encodeURIComponent(id)}/inventory_locations`)).inventory_locations||[]}catch{}
  const locations=inventory.map(x=>({id:String(x.id||''),location:String(x.location||''),quantity:Number(x.quantity_available||0),priority:Number(x.priority||1),delete_if_empty:x.delete_if_empty!==false}));
  return {id:product.id||id,sku:product.sku||'',title:product.title||'',image:imageOf(product),tags:tagsOf(product),locations,quantity_available:locations.length?locations.reduce((sum,x)=>sum+x.quantity,0):Number(product.quantity_available||0),reserve_quantity:Number(product.reserve_quantity||0),reserve_quantity_location:String(product.reserve_quantity_location||''),reserve_live_loaded:true,status:productStatus(product),source:'product'};
}
function saveLiveProduct(live){
  live=applyTagOverrides(live);const index=load(PRODUCT_INDEX),id=String(live.id||'');let changed=false;
  index.items=index.items.map(row=>{if(String(row.id)!==id)return row;changed=true;return {...row,...live,sku:row.sku||live.sku,upc:row.upc||'',source:'product'}});
  if(changed)write(PRODUCT_INDEX,{updated_at:new Date().toISOString(),items:index.items},'live');
  for(let i=0;i<activeProducts.length;i++)if(String(activeProducts[i].id)===id)activeProducts[i]={...activeProducts[i],...live,sku:activeProducts[i].sku||live.sku,source:'product'};
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
        const base=applyTagOverrides({id:p.id||'',sku:String(p.sku||p.custom_catalogue_sku||p.catalogue_sku||''),upc:String(p.upc||p.barcode||''),title:String(titlesOf(p)[0]||''),search_titles:titlesOf(p),image:imageOf(p),quantity_available:Number(p.quantity_available||0),reserve_quantity:Number(p.reserve_quantity||0),reserve_quantity_location:String(p.reserve_quantity_location||''),reserve_live_loaded:false,tags:productTags,locations:productLocations,status:String(p.marketplace_status||p.status||''),source:'product'});
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
          for(const row of listings){const tags=tagsOf(row);const key=`${manifest.id}|${row.id||row.sku}`;if(batchSeen.has(key))continue;batchSeen.add(key);batches.push({id:row.id||'',product_id:row.product_id||'',manifest_id:manifest.id,manifest_name:manifest.name||'',sku:String(row.sku||row.custom_catalogue_sku||row.catalogue_sku||''),upc:String(row.upc||row.barcode||''),title:String(titlesOf(row)[0]||''),search_titles:titlesOf(row),image:imageOf(row),quantity_available:Number(row.quantity_available??row.quantity??0),tags,locations:[{location:String(row.location||row.item_location||''),quantity:Number(row.quantity_available??row.quantity??0)}],status:String(manifest.status||''),source:'batch',url:`https://app.sellerchamp.com/manifests/${encodeURIComponent(manifest.id)}?product_listing%5Bquery%5D=${encodeURIComponent(row.sku||'')}`});progress.batches=batches.length}
          if(listings.length<100)break;
        }
        // Publish completed manifests so searches work while a long rebuild continues.
        if(!fs.existsSync(BATCH_INDEX)||!JSON.parse(fs.readFileSync(BATCH_INDEX,'utf8')).includes_listing_titles)
          write(BATCH_INDEX,{updated_at:new Date().toISOString(),includes_untagged:true,includes_listing_titles:false,items:batches},'partial');
      }
      if(manifests.length<100)break;
    }
    write(BATCH_INDEX,{updated_at:new Date().toISOString(),includes_untagged:true,includes_listing_titles:true,items:batches},'tags');progress.phase='complete';
  }catch(error){buildError=error.message||'Refresh failed.';progress.phase='error';throw error}finally{building=false}
}

app.get('/api/status',async(req,res)=>{try{if(!building)await sc('/api/marketplace_accounts');const p=load(PRODUCT_INDEX),b=load(BATCH_INDEX);res.json({ok:true,version:'1.10.0',building,error:buildError,progress,products:p.items.length,batches:b.items.length,updated_at:[p.updated_at,b.updated_at].filter(Boolean).sort().at(-1)||null})}catch(e){res.status(e.status||500).json({error:'Could not connect to SellerChamp.',details:e.data||e.message})}});
app.get('/api/index-status',(req,res)=>res.json({building,error:buildError,progress}));
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
app.get('/api/product/:id/live',async(req,res)=>{try{const product=await liveProduct(req.params.id);saveLiveProduct(product);res.json({product})}catch(e){res.status(e.status||500).json({error:'Could not reload this product.',details:e.data||e.message})}});
app.get('/api/product/:id/reserve',async(req,res)=>{try{const detail=await sc(`/api/products/${encodeURIComponent(req.params.id)}.json`),product=detail.product||detail||{};res.json({ok:true,reserve_quantity:Number(product.reserve_quantity||0),reserve_quantity_location:String(product.reserve_quantity_location||'')})}catch(e){res.status(e.status||500).json({error:'Could not load the current reserve quantity.',details:e.data||e.message})}});
app.post('/api/product/:id/quantity',async(req,res)=>{try{
  const quantity=Number(req.body?.quantity),locationId=String(req.body?.location_id||''),locationName=String(req.body?.location||'');
  if(!Number.isInteger(quantity)||quantity<0)return res.status(400).json({error:'Enter a whole-number quantity of 0 or greater.'});
  const before=(await sc(`/api/products/${encodeURIComponent(req.params.id)}/inventory_locations`)).inventory_locations||[];
  const row=before.find(x=>locationId&&String(x.id)===locationId)||before.find(x=>String(x.location||'').toLowerCase()===locationName.toLowerCase());
  if(!row)return res.status(404).json({error:'That SellerChamp inventory location no longer exists. Reload the item and try again.'});
  await sc(`/api/products/${encodeURIComponent(req.params.id)}/inventory_locations/${encodeURIComponent(row.id)}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:row.location,quantity_available:quantity,delete_if_empty:row.delete_if_empty!==false,priority:Number(row.priority||1)}})});
  const product=await liveProduct(req.params.id),verified=product.locations.find(x=>String(x.id)===String(row.id));
  if(!verified||Number(verified.quantity)!==quantity)return res.status(409).json({error:'SellerChamp did not confirm the quantity update. No success was reported.'});
  saveLiveProduct(product);res.json({ok:true,verified:true,message:`Verified: ${verified.location||'location'} now has quantity ${quantity}.`,product});
}catch(e){res.status(e.status||500).json({error:'SellerChamp quantity update failed.',details:e.data||e.message})}});
app.post('/api/product/:id/location',async(req,res)=>{try{
  const locationId=String(req.body?.location_id||''),oldLocation=String(req.body?.old_location||''),newLocation=String(req.body?.new_location||'').trim();
  if(!newLocation)return res.status(400).json({error:'Enter a new location.'});
  const before=(await sc(`/api/products/${encodeURIComponent(req.params.id)}/inventory_locations`)).inventory_locations||[];
  const row=before.find(x=>locationId&&String(x.id)===locationId)||before.find(x=>String(x.location||'').toLowerCase()===oldLocation.toLowerCase());
  if(!row)return res.status(404).json({error:'That SellerChamp inventory location no longer exists. Reload the item and try again.'});
  if(String(row.location||'').trim().toLowerCase()===newLocation.toLowerCase())return res.status(400).json({error:'The new location is the same as the current location.'});
  await sc(`/api/products/${encodeURIComponent(req.params.id)}/inventory_locations/${encodeURIComponent(row.id)}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:newLocation,quantity_available:Number(row.quantity_available||0),delete_if_empty:row.delete_if_empty!==false,priority:Number(row.priority||1)}})});
  const product=await liveProduct(req.params.id),verified=product.locations.find(x=>String(x.id)===String(row.id));
  if(!verified||String(verified.location||'').trim().toLowerCase()!==newLocation.toLowerCase())return res.status(409).json({error:'SellerChamp did not confirm the location update. No success was reported.'});
  saveLiveProduct(product);res.json({ok:true,verified:true,message:`Verified: location changed from ${row.location||'NO LOCATION'} to ${verified.location}.`,product});
}catch(e){res.status(e.status||500).json({error:'SellerChamp location update failed.',details:e.data||e.message})}});
app.post('/api/product/:id/reserve',async(req,res)=>{try{
  const quantity=Number(req.body?.quantity);
  if(!Number.isInteger(quantity)||quantity<0)return res.status(400).json({error:'Enter a whole-number reserve quantity of 0 or greater.'});
  const detail=await sc(`/api/products/${encodeURIComponent(req.params.id)}.json`),before=detail.product||detail||{};
  let location=String(before.reserve_quantity_location||req.body?.location||'').trim();
  if(!location){const inventory=(await sc(`/api/products/${encodeURIComponent(req.params.id)}/inventory_locations`)).inventory_locations||[];location=String(inventory[0]?.location||'').trim()}
  await sc(`/api/products/${encodeURIComponent(req.params.id)}`,{method:'PUT',body:JSON.stringify({product:{reserve_quantity:quantity,reserve_quantity_location:location}})});
  let product=null;
  for(let attempt=0;attempt<6;attempt++){await sleep(attempt===0?1200:2000);product=await liveProduct(req.params.id);if(Number(product.reserve_quantity)===quantity){saveLiveProduct(product);return res.json({ok:true,verified:true,message:`Verified: reserve quantity is now ${quantity}.`,product})}}
  return res.status(409).json({error:`SellerChamp did not confirm reserve quantity ${quantity}. No verified success was reported.`});
}catch(e){res.status(e.status||500).json({error:'SellerChamp reserve quantity update failed.',details:e.data||e.message})}});
app.post('/api/product/:id/remove-tag',async(req,res)=>{try{
  const tag=String(req.body?.tag||'').trim();if(!tag)return res.status(400).json({error:'Choose a tag to remove.'});
  const detail=await sc(`/api/products/${encodeURIComponent(req.params.id)}.json`),before=detail.product||detail||{},beforeTags=tagsOf(before);
  if(!beforeTags.some(x=>x.toLowerCase()===tag.toLowerCase()))return res.status(404).json({error:`This Product no longer has the “${tag}” tag.`});
  const remaining=beforeTags.filter(x=>x.toLowerCase()!==tag.toLowerCase());
  await sc(`/api/products/${encodeURIComponent(req.params.id)}`,{method:'PUT',body:JSON.stringify({product:{tags_array:remaining}})});
  recordTagRemoval(req.params.id,tag);
  let product=null;
  for(let attempt=0;attempt<5;attempt++){if(attempt)await sleep(1500);product=await liveProduct(req.params.id);if(!product.tags.some(x=>x.toLowerCase()===tag.toLowerCase())){product.tags=product.tags.filter(x=>x.toLowerCase()!==tag.toLowerCase());saveLiveProduct(product);return res.json({ok:true,verified:true,message:`Verified: removed the “${tag}” tag.`,product})}}
  product.tags=product.tags.filter(x=>x.toLowerCase()!==tag.toLowerCase());saveLiveProduct(product);res.status(202).json({ok:true,accepted:true,verified:false,message:`SellerChamp accepted the tag change. This item is hidden for 3 days while SellerChamp finishes updating.`,product});
}catch(e){res.status(e.status||500).json({error:'SellerChamp tag removal failed.',details:e.data||e.message})}});
app.post('/api/product/:id/end-listing',async(req,res)=>{try{
  await sc(`/api/products/${encodeURIComponent(req.params.id)}?delete_product=false&end_listing_on_marketplace=true&delete_listing_on_marketplace=false&delete_linked_products=false`,{method:'DELETE'});
  let product=null;
  for(let attempt=0;attempt<5;attempt++){await sleep(attempt===0?1800:2500);product=await liveProduct(req.params.id);if(['inactive','ended','ended_listing','not_listed','removed'].includes(product.status)){saveLiveProduct(product);return res.json({ok:true,verified:true,message:`Verified: listing status is ${product.status.toUpperCase()}.`,product})}}
  return res.status(409).json({error:`SellerChamp accepted the request, but still reports ${String(product?.status||'unknown').toUpperCase()}. No verified success was reported.`});
}catch(e){res.status(e.status||500).json({error:'SellerChamp could not end this listing.',details:e.data||e.message})}});
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>{console.log(`SellerChamp Tag Location Sorter running on ${PORT}`);const p=load(PRODUCT_INDEX),b=load(BATCH_INDEX);let completeBatchIndex=false;try{const saved=JSON.parse(fs.readFileSync(BATCH_INDEX,'utf8'));completeBatchIndex=saved.includes_untagged===true&&saved.includes_listing_titles===true}catch{}if(!p.items.length||!b.items.length||!completeBatchIndex)buildIndexes().catch(error=>console.error('Initial tag index refresh failed:',error.message))});
setInterval(()=>{if(!building)buildIndexes().catch(error=>console.error('Scheduled tag index refresh failed:',error.message))},24*60*60*1000).unref();
