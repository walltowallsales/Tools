const express=require('express');
const path=require('path');
const crypto=require('crypto');
const app=express(); const PORT=process.env.PORT||3000; const SC_BASE='https://app.sellerchamp.com';
app.use(express.json({limit:'1mb'})); app.use(express.static(path.join(__dirname,'public')));
const AUTH_COOKIE='sc_auction_auth', AUTH_MAX_AGE=30*24*60*60;
function cookies(req){const o={};String(req.headers.cookie||'').split(';').forEach(p=>{const i=p.indexOf('=');if(i>0)o[decodeURIComponent(p.slice(0,i).trim())]=decodeURIComponent(p.slice(i+1).trim())});return o}
function secret(){return process.env.APP_PIN||''}
function makeToken(){const exp=Math.floor(Date.now()/1000)+AUTH_MAX_AGE,s=crypto.createHmac('sha256',secret()).update(String(exp)).digest('hex');return `${exp}.${s}`}
function valid(req){if(!process.env.APP_PIN)return true;const [e,s]=(cookies(req)[AUTH_COOKIE]||'').split('.');if(!e||!s||Number(e)<Date.now()/1000)return false;const x=crypto.createHmac('sha256',secret()).update(e).digest('hex');try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(x))}catch{return false}}
function needPin(req,res,next){return valid(req)?next():res.status(401).json({error:'PIN required.',pin_required:true})}
function token(){if(!process.env.SELLERCHAMP_API_TOKEN)throw Error('SELLERCHAMP_API_TOKEN is not configured.');return process.env.SELLERCHAMP_API_TOKEN}
let scQueue=Promise.resolve(), lastScAt=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function scDirect(ep,opt={}){
  for(let attempt=0;attempt<6;attempt++){
    const wait=Math.max(0,700-(Date.now()-lastScAt)); if(wait)await sleep(wait); lastScAt=Date.now();
    const r=await fetch(SC_BASE+ep,{...opt,headers:{Token:token(),'Content-Type':'application/json',...(opt.headers||{})}});
    const t=await r.text();let b={};try{b=t?JSON.parse(t):{}}catch{b={raw:t}}
    if(r.status===429){await sleep(Math.min(12000,2000*Math.pow(1.7,attempt)));continue}
    if(!r.ok)throw Error(b?.error||b?.message||`SellerChamp returned ${r.status}`);return b;
  }
  throw Error('SellerChamp is still rate-limiting requests. Please wait about 30 seconds and tap Refresh again.');
}
function sc(ep,opt={}){const job=scQueue.then(()=>scDirect(ep,opt));scQueue=job.catch(()=>{});return job}

const CHANGE_LOG_URL = 'https://script.google.com/macros/s/AKfycbw2UHYXOzZajklEXvHf-o5Ht1f6P6e4ifmzWVsRdbyUnVisv-23SUxRrlVr6QMgJk5ZpA/exec';
async function logChange(entry){
  try{
    const response=await fetch(CHANGE_LOG_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(entry),redirect:'follow'});
    const text=await response.text();let data={};try{data=JSON.parse(text)}catch{}
    if(!response.ok||data.success===false)return {logged:false,warning:data.error||`HTTP ${response.status}`};
    return {logged:true};
  }catch(e){return {logged:false,warning:e.message||'Google Sheets logging failed'};}
}
async function safeLog(entry){try{return await logChange(entry)}catch(e){return {logged:false,warning:e.message||'Google Sheets logging failed'}}}
const first=(o,...ks)=>{for(const k of ks)if(o&&o[k]!=null&&o[k]!=='')return o[k];return null};
function tagsOf(p){let v=first(p,'tags_array','tags','tag_list','product_tags');if(Array.isArray(v))return v.map(x=>typeof x==='string'?x:(x.name||x.tag||'')).filter(Boolean);if(typeof v==='string')return v.split(',').map(x=>x.trim()).filter(Boolean);return []}
function imageOf(p){
  const direct=['image_url','main_image_url','thumbnail_url','primary_image_url','image','thumbnail','main_image','primary_image','picture_url','photo_url'];
  for(const k of direct){const v=p&&p[k];if(typeof v==='string'&&/^https?:\/\//i.test(v))return v;if(v&&typeof v==='object'){const u=v.url||v.image_url||v.src||v.original_url||v.medium_url||v.large_url;if(u)return u}}
  for(const k of ['image_urls','images','photos','pictures','product_images']){const a=p&&p[k];if(Array.isArray(a)&&a.length){for(const x of a){if(typeof x==='string'&&x)return x;if(x&&typeof x==='object'){const u=x.url||x.image_url||x.src||x.original_url||x.medium_url||x.large_url||x.thumbnail_url;if(u)return u}}}if(typeof a==='string'&&a.trim())return a.split(',')[0].trim()}
  return ''
}
function statusOf(p){return String(first(p,'marketplace_status','status')||'unknown').toLowerCase()}
async function fullProduct(id){const j=await sc(`/api/products/${id}`);return j.product||j}
async function invOf(id){try{return (await sc(`/api/products/${id}/inventory_locations`)).inventory_locations||[]}catch{return []}}
function normInv(a){return a.map(x=>({id:x.id,location:x.location||'',quantity:Number(x.quantity_available||0),priority:x.priority||1,delete_if_empty:x.delete_if_empty!==false})).sort((a,b)=>(a.location||'').localeCompare(b.location||'',undefined,{numeric:true,sensitivity:'base'}))}
function priceOf(p){
  // Use price data already returned by SellerChamp's product list so showing the
  // selling price does not add another API request per item.
  const direct=first(p,'selling_price','sale_price','marketplace_price','listing_price','ebay_price','price');
  if(direct!=null&&direct!==''){
    const n=Number(typeof direct==='object'?(direct.amount??direct.value):direct);
    if(Number.isFinite(n))return n;
  }
  for(const k of ['marketplace_listing','marketplace','listing','ebay_listing']){
    const o=p&&p[k]; if(o&&typeof o==='object'){
      const v=first(o,'selling_price','sale_price','marketplace_price','listing_price','price','amount');
      const n=Number(typeof v==='object'?(v.amount??v.value):v); if(Number.isFinite(n))return n;
    }
  }
  for(const k of ['marketplace_listings','marketplaces','listings']){
    const a=p&&p[k]; if(Array.isArray(a)) for(const o of a){
      const name=String(first(o,'marketplace_name','name','marketplace')||'').toLowerCase();
      if(name&&name!=='ebay')continue;
      const v=first(o,'selling_price','sale_price','marketplace_price','listing_price','price','amount');
      const n=Number(typeof v==='object'?(v.amount??v.value):v); if(Number.isFinite(n))return n;
    }
  }
  return null;
}
function summary(p,inv){const locations=normInv(inv),tags=tagsOf(p),auctionTags=tags.filter(t=>['auction','auction some'].includes(t.toLowerCase()));return {id:p.id,sku:p.sku||'',title:p.title||'',image:imageOf(p),price:priceOf(p),tags,auction_tags:auctionTags,status:statusOf(p),locations,location:locations.map(x=>x.location).filter(Boolean).join(', ')||first(p,'item_location','bin_location','warehouse_location')||'',quantity:locations.length?locations.reduce((n,x)=>n+x.quantity,0):Number(first(p,'quantity_available','quantity','quantity_on_hand')||0)}}
async function setLocationQty(id,loc,qty){const inv=await invOf(id);const row=inv.find(x=>String(x.location||'').toLowerCase()===String(loc||'').toLowerCase());if(!row)throw Error(`Inventory location ${loc||'(blank)'} was not found.`);await sc(`/api/products/${id}/inventory_locations/${row.id}`,{method:'PUT',body:JSON.stringify({inventory_location:{location:row.location,quantity_available:qty,delete_if_empty:row.delete_if_empty!==false,priority:row.priority||1}})})}
async function updateTags(id,tags){
  // SellerChamp exposes product tags as `tags_array` on the full product record.
  // Preserve every unrelated tag and write the complete replacement array back.
  await sc(`/api/products/${id}`,{method:'PUT',body:JSON.stringify({product:{tags_array:tags}})});
  const p=await fullProduct(id),actual=tagsOf(p).map(x=>String(x).trim().toLowerCase());
  const wanted=tags.map(x=>String(x).trim().toLowerCase());
  const missing=wanted.filter(t=>!actual.includes(t));
  const auctionLeft=actual.filter(t=>t==='auction'||t==='auction some');
  if(missing.length||auctionLeft.length)throw Error(`SellerChamp did not confirm the tag update. Current tags: ${tagsOf(p).join(', ')||'NONE'}. Quantity changes were kept so this item remains visible for follow-up.`);
  return p
}
async function endListing(id){
  // Official SellerChamp API: DELETE /api/products/:id with delete_product=false
  // and end_listing_on_marketplace=true ends the marketplace listing while
  // preserving the SellerChamp product itself. Do NOT delete the marketplace
  // listing record or linked products.
  await sc(`/api/products/${id}?delete_product=false&end_listing_on_marketplace=true&delete_listing_on_marketplace=false&delete_linked_products=false`,{method:'DELETE'});

  // Marketplace status can take a moment to synchronize. Poll a few times rather
  // than assuming the first product read has already reflected the eBay change.
  let p=null,s='unknown';
  for(let i=0;i<5;i++){
    await sleep(i===0?1800:2500);
    p=await fullProduct(id); s=statusOf(p);
    if(['inactive','ended','ended_listing','not_listed','removed'].includes(s))return p;
  }
  throw Error(`SellerChamp accepted the end-listing request, but still reports listing status ${String(s).toUpperCase()}. The auction tag was left in place so this item remains visible for follow-up.`);
}
app.get('/api/config',(req,res)=>res.json({pinRequired:!!process.env.APP_PIN,authenticated:valid(req),loginDays:30}));
app.post('/api/pin',(req,res)=>{const ok=!process.env.APP_PIN||String(req.body.pin||'')===process.env.APP_PIN;if(ok&&process.env.APP_PIN)res.setHeader('Set-Cookie',`${AUTH_COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}; Secure`);res.json({ok})});
app.use('/api',needPin);
app.get('/api/status',async(req,res)=>{try{const data=await sc('/api/marketplace_accounts');res.json({ok:true,version:'1.13.0',pinRequired:!!process.env.APP_PIN,accounts:(data.marketplace_accounts||[]).map(a=>({id:a.id,name:a.name,marketplace:a.marketplace}))})}catch(e){res.status(e.status||500).json({error:'Could not connect to SellerChamp.',details:e.message})}});
app.get('/api/diagnostic/sku/:sku',async(req,res)=>{
  try{
    const sku=String(req.params.sku||'').trim();
    if(!sku)return res.status(400).json({error:'SKU required.'});
    const list=await sc(`/api/products?sku=${encodeURIComponent(sku)}&page=1&page_size=50`);
    const row=(list.products||[]).find(x=>String(x.sku||'').toLowerCase()===sku.toLowerCase())||(list.products||[])[0];
    if(!row)return res.status(404).json({error:`SKU ${sku} was not found.`});
    let full=null, fullError='';
    try{full=await fullProduct(row.id)}catch(e){fullError=e.message}
    const candidate=full||row;
    const tagLike={};
    for(const [k,v] of Object.entries(candidate||{})) if(/tag/i.test(k)) tagLike[k]=v;
    const listTagLike={};
    for(const [k,v] of Object.entries(row||{})) if(/tag/i.test(k)) listTagLike[k]=v;
    res.json({
      sku,
      id:row.id,
      list_keys:Object.keys(row||{}).sort(),
      full_keys:Object.keys(full||{}).sort(),
      list_tag_fields:listTagLike,
      full_tag_fields:tagLike,
      parsed_tags_from_list:tagsOf(row),
      parsed_tags_from_full:tagsOf(full||{}),
      full_lookup_error:fullError,
      list_product:row,
      full_product:full
    });
  }catch(e){res.status(500).json({error:e.message})}
});

let auctionCache={products:null,updatedAt:null};
function cacheRemove(id){if(auctionCache.products)auctionCache.products=auctionCache.products.filter(p=>String(p.id)!==String(id));auctionCache.updatedAt=new Date().toISOString()}
function cacheUpsert(prod){if(!auctionCache.products||!prod)return;const i=auctionCache.products.findIndex(p=>String(p.id)===String(prod.id));if(i>=0)auctionCache.products[i]=prod;else auctionCache.products.push(prod);auctionCache.products.sort((a,b)=>(a.location||'ZZZZ').localeCompare(b.location||'ZZZZ',undefined,{numeric:true,sensitivity:'base'})||(a.title||'').localeCompare(b.title||''));auctionCache.updatedAt=new Date().toISOString()}

app.get('/api/auction-products',async(req,res)=>{
  try{
    if(req.query.refresh!=='1'&&auctionCache.products)return res.json({products:auctionCache.products,count:auctionCache.products.length,cached:true,updatedAt:auctionCache.updatedAt});
    // SellerChamp exposes tags in `tags_array`. Scan the paginated product LIST only;
    // do not fetch every product individually. This is fast and avoids API rate limits.
    const found=[]; const seen=new Set();
    for(let page=1;page<=500;page++){
      const j=await sc(`/api/products?page=${page}&page_size=100`);
      const batch=j.products||[];
      for(const p of batch){
        const ts=tagsOf(p).map(x=>String(x).trim().toLowerCase());
        if((ts.includes('auction')||ts.includes('auction some'))&&!seen.has(p.id)){
          seen.add(p.id);
          // Inventory locations are only requested for the small number of matching items.
          let detail=p;
          // Full product records often contain the image even when the list record does not.
          if(!imageOf(detail)){try{detail=await fullProduct(p.id)}catch{}}
          found.push(summary(detail,await invOf(p.id)));
        }
      }
      if(batch.length<100) break;
    }
    found.sort((a,b)=>(a.location||'ZZZZ').localeCompare(b.location||'ZZZZ',undefined,{numeric:true,sensitivity:'base'})||(a.title||'').localeCompare(b.title||''));
    auctionCache={products:found,updatedAt:new Date().toISOString()};
    res.json({products:found,count:found.length,cached:false,updatedAt:auctionCache.updatedAt});
  }catch(e){res.status(e.status||500).json({error:e.message})}
});

app.post('/api/products/:id/quantity',async(req,res)=>{try{
  const qty=Number(req.body.quantity),loc=String(req.body.location||'');
  if(!Number.isInteger(qty)||qty<0)return res.status(400).json({error:'Enter a whole-number quantity of 0 or more.'});
  const beforeP=await fullProduct(req.params.id),beforeInv=normInv(await invOf(req.params.id));
  const beforeRow=beforeInv.find(x=>String(x.location||'').toLowerCase()===loc.toLowerCase());
  const oldQty=beforeRow?beforeRow.quantity:null;
  await setLocationQty(req.params.id,loc,qty);
  let p=await fullProduct(req.params.id),inv=await invOf(req.params.id),s=summary(p,inv);
  if(s.quantity===0){
    await endListing(req.params.id);
    let tags=tagsOf(await fullProduct(req.params.id)).filter(t=>!['auction','auction some'].includes(t.toLowerCase()));
    if(!tags.some(t=>t.toLowerCase()==='sent to auction'))tags.push('Sent to Auction');
    await updateTags(req.params.id,tags);cacheRemove(req.params.id);
    const log=await safeLog({app:'Auction Inventory',action:'Quantity Updated / Sent to Auction',sku:beforeP.sku||'',title:beforeP.title||'',oldLocation:loc,newLocation:loc,quantity:qty,details:`Quantity changed from ${oldQty??''} to ${qty}; total quantity reached zero; listing ended; auction tag removed; Sent to Auction added`});
    return res.json({ok:true,removed:true,quantity:0,log});
  }
  cacheUpsert(s);
  const log=await safeLog({app:'Auction Inventory',action:'Quantity Updated',sku:beforeP.sku||'',title:beforeP.title||'',oldLocation:loc,newLocation:loc,quantity:qty,details:`Quantity changed from ${oldQty??''} to ${qty}`});
  res.json({ok:true,product:s,log});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/api/products/:id/send-some',async(req,res)=>{try{
  const amount=Number(req.body.amount),loc=String(req.body.location||'');
  if(!Number.isInteger(amount)||amount<=0)return res.status(400).json({error:'Enter a whole number greater than zero.'});
  const p=await fullProduct(req.params.id),tags=tagsOf(p).map(x=>x.toLowerCase());
  if(!tags.includes('auction some'))return res.status(400).json({error:'Send Some is only available for products tagged auction some.'});
  const inv=normInv(await invOf(req.params.id)),row=inv.find(x=>String(x.location).toLowerCase()===loc.toLowerCase());
  if(!row)return res.status(400).json({error:'Choose an inventory location.'});
  if(amount>row.quantity)return res.status(400).json({error:`Only ${row.quantity} available at ${row.location}.`});
  await setLocationQty(req.params.id,row.location,row.quantity-amount);
  const after=summary(await fullProduct(req.params.id),await invOf(req.params.id));
  if(after.quantity===0){
    await endListing(req.params.id);
    let nt=tagsOf(await fullProduct(req.params.id)).filter(t=>t.toLowerCase()!=='auction some'&&t.toLowerCase()!=='auction');
    if(!nt.some(t=>t.toLowerCase()==='sent to auction'))nt.push('Sent to Auction');
    await updateTags(req.params.id,nt);cacheRemove(req.params.id);
    const log=await safeLog({app:'Auction Inventory',action:'Send Some / Sent to Auction',sku:p.sku||'',title:p.title||'',oldLocation:row.location,newLocation:'Auction',quantity:amount,details:`Sent ${amount}; location quantity ${row.quantity} to ${row.quantity-amount}; total reached zero; listing ended; Sent to Auction added`});
    return res.json({ok:true,removed:true,quantity:0,sent:amount,log});
  }
  cacheUpsert(after);
  const log=await safeLog({app:'Auction Inventory',action:'Send Some',sku:p.sku||'',title:p.title||'',oldLocation:row.location,newLocation:'Auction',quantity:amount,details:`Sent ${amount}; location quantity ${row.quantity} to ${row.quantity-amount}`});
  res.json({ok:true,product:after,sent:amount,log});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/api/products/:id/send-all',async(req,res)=>{try{
  const p=await fullProduct(req.params.id),inv=normInv(await invOf(req.params.id));
  const total=inv.reduce((n,x)=>n+x.quantity,0),locations=inv.filter(x=>x.quantity>0).map(x=>`${x.location||'NO LOCATION'} (${x.quantity})`).join(', ');
  for(const row of inv)if(row.quantity>0)await setLocationQty(req.params.id,row.location,0);
  await endListing(req.params.id);
  let nt=tagsOf(await fullProduct(req.params.id)).filter(t=>!['auction','auction some'].includes(t.toLowerCase()));
  if(!nt.some(t=>t.toLowerCase()==='sent to auction'))nt.push('Sent to Auction');
  await updateTags(req.params.id,nt);cacheRemove(req.params.id);
  const log=await safeLog({app:'Auction Inventory',action:'Send to Auction',sku:p.sku||'',title:p.title||'',oldLocation:locations,newLocation:'Auction',quantity:total,details:'All remaining quantity set to zero; marketplace listing ended; auction tag removed; Sent to Auction added'});
  res.json({ok:true,removed:true,log});
}catch(e){res.status(500).json({error:e.message})}});
app.listen(PORT,()=>console.log(`SellerChamp Auction Inventory running on ${PORT}`));
