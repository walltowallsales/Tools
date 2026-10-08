'use strict';
// Verify against raw SellerChamp reads, never the local tag-removal cache.
async function transferTags({read,write,tagsOf,sleep,current,target}){
 const has=(tags,tag)=>tags.some(x=>x.toLowerCase()===tag.toLowerCase());
 async function verify(predicate){for(let i=0;i<5;i++){if(i)await sleep(1500);const product=await read();if(predicate(tagsOf(product)))return product}return null}
 let before=await read(),tags=tagsOf(before);
 if(!has(tags,target))await write([...tags,target]);
 let added=await verify(tags=>has(tags,target));
 if(!added)throw Error('The new tag was not verified. The current tag has not been removed; the item stays in the list.');
 // Read again so unrelated tags added while verification ran are preserved.
 before=await read();tags=tagsOf(before);
 if(!has(tags,target))throw Error('The new tag is no longer present. The current tag has not been removed.');
 if(has(tags,current))await write(tags.filter(x=>x.toLowerCase()!==current.toLowerCase()));
 const done=await verify(tags=>has(tags,target)&&!has(tags,current));
 if(!done)throw Error('The new tag was added, but both changes could not be verified. The item stays in this list; Reload Live before retrying.');
 return done;
}
module.exports={transferTags};
