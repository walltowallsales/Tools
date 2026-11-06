'use strict';
// Journal before each external write. Repeating an action verifies its saved target; it never adds twice.
module.exports=function({readDb,writeDb,getProductAndInventory,freshProduct,sc,archiveRecord,sleep,now}){
 const locks=new Set();
 function save(id,mutate){const db=readDb(),r=db.find(x=>x.id===id);if(!r)throw Error('Return not found');r.history=r.history||[];mutate(r);r.updated_at=now();writeDb(db);return r;}
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
 return async function process(id,mode,input={}){
  if(locks.has(id))throw Error('This return is already being processed. Wait for the result.');locks.add(id);let productLock,hasProductLock=false;
  try{
   let r=readDb().find(x=>x.id===id);if(!r)throw Error('Return not found');
   if(r.status==='archived'){if(r.verified_completion?.mode===mode)return r.verified_completion;throw Error('This return is already archived.');}
   const {product,inv}=await getProductAndInventory(r);productLock='product:'+product.id;
   if(locks.has(productLock))throw Error('Another return is updating this product. Try again shortly.');locks.add(productLock);hasProductLock=true;
   let op=r.processing_operation;
   if(op&&op.mode!==mode)throw Error('This return already has a saved inventory action. Recheck that action before choosing a different one.');
   if(!op){
    if(mode==='reserve'&&r.inventory_result&&!r.reserve_result)throw Error('A normal inventory addition is already saved. Recheck Add to Inventory; do not add the same return again.');
    if(mode==='normal'&&r.reserve_result)throw Error('A reserve addition is already saved. Recheck Add + Reserve; do not add the same return again.');
    const legacy=mode==='normal'?r.inventory_result:r.reserve_result;
    if(legacy){const expected=mode==='normal'?legacy.expected_quantity:legacy.expected_on_hand;
     if(number(expected)===null)throw Error('This older return needs quantity review in SellerChamp before it can be completed. No inventory was added.');
     op={mode,product_id:product.id,location:legacy.location,quantity_added:legacy.qty??legacy.quantity_added,before_quantity:legacy.before_quantity??legacy.before_on_hand,expected_quantity:expected,before_reserve:legacy.before_reserve,expected_reserve:legacy.expected_reserve,inventory_attempted:true,reserve_attempted:mode==='reserve'};
    }else{
     const loc=String(input.location||r.location||'').trim(),qty=Number(input.qty??r.returned_qty);
     if(!loc||!Number.isInteger(qty)||qty<1)throw Error('Enter a location and a whole-number return quantity greater than zero.');
     const matches=inv.filter(x=>String(x.location||'').trim().toLowerCase()===loc.toLowerCase());if(matches.length>1)throw Error('Multiple inventory rows have this location. Review them in SellerChamp.');
     const before=matches.length?number(matches[0].quantity_available):0,reserve=number(product.reserve_quantity);
     if(before===null||(mode==='reserve'&&reserve===null))throw Error(before===null?'SellerChamp did not return a usable stock count at '+loc+'. No update was made.':'SellerChamp Product detail did not return the current reserve count. No update was made.');
     op={mode,product_id:product.id,location:loc,location_id:matches[0]?.id,quantity_added:qty,before_quantity:before,expected_quantity:before+qty,before_reserve:reserve,expected_reserve:mode==='reserve'?reserve+qty:null,reserve_location:String(input.reserve_location||loc)};
    }
    r=save(id,x=>{x.processing_operation=op;x.status='verification_pending';x.history.push({at:now(),action:'inventory_action_started',details:`${mode}: target ${op.expected_quantity} at ${op.location}`});});
   }
   if(String(op.product_id)!==String(product.id))throw Error('The product identity changed. Review this return in SellerChamp.');
   if(!op.inventory_attempted){op.inventory_attempted=true;save(id,x=>x.processing_operation=op);
    const attrs={location:op.location,quantity_available:op.expected_quantity,delete_if_empty:true,priority:1};
    await sc(`/api/products/${product.id}/inventory_locations${op.location_id?'/'+op.location_id:''}`,{method:op.location_id?'PUT':'POST',body:JSON.stringify({inventory_location:attrs})});
   }
   if(mode==='reserve'&&!op.reserve_attempted){const currentInv=await sc(`/api/products/${product.id}/inventory_locations`),locationRows=(currentInv.inventory_locations||[]).filter(x=>String(x.location||'').trim().toLowerCase()===op.location.toLowerCase());if(locationRows.length!==1||number(locationRows[0].quantity_available)!==op.expected_quantity)throw Error('Inventory update is not yet verified. Return remains open. Recheck Saved Update before reserving.');const latest=await freshProduct(product.id),current=number(latest.reserve_quantity);
    if(current!==op.before_reserve&&current!==op.expected_reserve)throw Error('Reserve changed while processing. Check SellerChamp before continuing.');
    op.reserve_attempted=true;save(id,x=>x.processing_operation=op);
    if(current!==op.expected_reserve)await sc(`/api/products/${product.id}`,{method:'PUT',body:JSON.stringify({product:{reserve_quantity:op.expected_reserve,reserve_quantity_location:op.reserve_location}})});
   }
   let quantity=null,reserve=null,status='unknown',verified=false;
   for(const delay of [0,1500,3000]){if(delay)await sleep(delay);const data=await sc(`/api/products/${product.id}/inventory_locations`),rows=data.inventory_locations;
    const matches=Array.isArray(rows)?rows.filter(x=>String(x.location||'').trim().toLowerCase()===op.location.toLowerCase()):[];
    quantity=matches.length===1?number(matches[0].quantity_available):null;
    const p=await freshProduct(product.id);reserve=number(p.reserve_quantity);status=String(p.marketplace_status||'unknown');
    verified=quantity===op.expected_quantity&&(mode!=='reserve'||reserve===op.expected_reserve);if(verified)break;
   }
   if(!verified){save(id,x=>{x.history.push({at:now(),action:'verification_pending',details:`Expected stock ${op.expected_quantity}, read ${quantity}; expected reserve ${op.expected_reserve}, read ${reserve}`});});throw Error(`Update not yet verified. Expected stock ${op.expected_quantity}; SellerChamp reports ${quantity??'unavailable'}${mode==='reserve'?`; expected reserve ${op.expected_reserve}, reports ${reserve??'unavailable'}`:''}. Return remains open. Use Recheck Saved Update; do not add it again manually.`);}
   const result={ok:true,verified:true,archived:true,mode,sku:r.sku,title:r.title,location:op.location,before_quantity:op.before_quantity,quantity_added:op.quantity_added,quantity_available:quantity,before_reserve:op.before_reserve,reserve_quantity:reserve,marketplace_status:status,verified_at:now()};
   save(id,x=>{x.verified_completion=result;archiveRecord(x,mode==='reserve'?'inventory_reserved_verified':'inventory_returned_verified',`Verified stock ${quantity} at ${op.location}${mode==='reserve'?`; reserve ${reserve}`:''}. Listing status ${status}.`);});return result;
  }finally{locks.delete(id);if(hasProductLock)locks.delete(productLock);}
 };
};
