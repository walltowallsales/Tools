'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path'),express=require('express');
const ROUTE='/ebay/account-deletion';
function challenge(code,token,url){return crypto.createHash('sha256').update(code+token+url).digest('hex')}
function signatureValid(body,header,key){const sig=JSON.parse(Buffer.from(header,'base64').toString('utf8'));return crypto.verify('sha1',Buffer.from(JSON.stringify(body)),key,Buffer.from(sig.signature,'base64'))}
function mount(app,{dataRoot,internalKey,fetcher=fetch}){
 const dir=path.join(dataRoot,'ebay-notifications');fs.mkdirSync(dir,{recursive:true});
 const statusFile=path.join(dir,'status.json');let status={last_received:null,last_processed:null,pending:0,error:null};try{status={...status,...JSON.parse(fs.readFileSync(statusFile))}}catch{}
 const persist=()=>{fs.writeFileSync(statusFile+'.tmp',JSON.stringify(status));fs.renameSync(statusFile+'.tmp',statusFile)};
 const endpoint=process.env.EBAY_NOTIFICATION_ENDPOINT||'',verification=process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN||'';
 const ready=()=>/^https:\/\//.test(endpoint)&&endpoint.endsWith(ROUTE)&&/^[A-Za-z0-9_-]{32,80}$/.test(verification);
 let appToken='',expires=0;const keys=new Map();
 async function publicKey(kid){if(!/^[A-Za-z0-9_-]{1,200}$/.test(kid))throw Error('Invalid signature key');const old=keys.get(kid);if(old&&old.expires>Date.now())return old.key;
  if(!process.env.EBAY_CLIENT_ID||!process.env.EBAY_CLIENT_SECRET)throw Error('Production App ID and Cert ID required to verify notifications');
  if(expires<Date.now()+60000){const r=await fetcher('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.EBAY_CLIENT_ID+':'+process.env.EBAY_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'}),signal:AbortSignal.timeout(15000)});const b=await r.json();if(!r.ok||!b.access_token)throw Error('eBay application authentication failed');appToken=b.access_token;expires=Date.now()+Number(b.expires_in)*1000;}
  const r=await fetcher('https://api.ebay.com/commerce/notification/v1/public_key/'+encodeURIComponent(kid),{headers:{Authorization:'Bearer '+appToken},signal:AbortSignal.timeout(15000)});const b=await r.json();if(!r.ok||!b.key)throw Error('eBay signature key unavailable');const key='-----BEGIN PUBLIC KEY-----\n'+b.key.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'')+'\n-----END PUBLIC KEY-----';keys.set(kid,{key,expires:Date.now()+3600000});return key;
 }
 let working=false;
 async function processQueue(){if(working)return;working=true;try{for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.pending.json'))){const file=path.join(dir,name);try{const entry=JSON.parse(fs.readFileSync(file));const body=entry.body,sig=JSON.parse(Buffer.from(entry.signature,'base64').toString('utf8'));const key=await publicKey(sig.kid);if(!signatureValid(body,entry.signature,key)){fs.unlinkSync(file);status.error='Rejected an invalid notification signature';continue;}
   // Freight Audit is the only direct eBay API data store. It has no buyer data.
   // Clear the entire audit conservatively, then pause to prevent reacquisition.
   const data=body.notification.data;const seller=String(process.env.EBAY_SELLER_USERNAME||'').toLowerCase();
   // Known unrelated users have no records in this listing-only audit. If eBay
   // omits username, clear conservatively because identity cannot be excluded.
   if(!seller||!data.username||String(data.username).toLowerCase()===seller){const r=await fetcher('http://127.0.0.1:3109/internal/account-deletion',{method:'POST',headers:{'x-suite-internal-key':internalKey},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Freight audit cleanup is waiting for the module');}fs.unlinkSync(file);status.last_processed=new Date().toISOString();status.error=null;console.log('[eBay notifications] Signed account deletion processed.');
  }catch(e){status.error=e.message;break;}}
 }finally{working=false;status.pending=fs.readdirSync(dir).filter(x=>x.endsWith('.pending.json')).length;persist();}}
 app.get(ROUTE,(q,r)=>{if(!ready())return r.status(503).json({error:'Configure notification endpoint and verification token in Render.'});if(typeof q.query.challenge_code!=='string'||!q.query.challenge_code||q.query.challenge_code.length>1024)return r.status(400).json({error:'challenge_code required'});r.json({challengeResponse:challenge(q.query.challenge_code,verification,endpoint)})});
 app.post(ROUTE,express.json({limit:'64kb'}),(q,r)=>{if(!ready())return r.sendStatus(503);const body=q.body,signature=q.headers['x-ebay-signature'];if(body?.metadata?.topic!=='MARKETPLACE_ACCOUNT_DELETION'||!body?.notification?.notificationId||!body?.notification?.data||typeof signature!=='string'||signature.length>4096)return r.sendStatus(400);
  try{const sig=JSON.parse(Buffer.from(signature,'base64').toString('utf8'));if(!sig.kid||!sig.signature)return r.sendStatus(412);const id=crypto.createHash('sha256').update(String(body.notification.notificationId)).digest('hex'),file=path.join(dir,id+'.pending.json');if(fs.readdirSync(dir).filter(x=>x.endsWith('.pending.json')).length>=1000&&!fs.existsSync(file))return r.sendStatus(503);fs.writeFileSync(file+'.tmp',JSON.stringify({body,signature}));fs.renameSync(file+'.tmp',file);status.last_received=new Date().toISOString();persist();r.sendStatus(202);void processQueue()}catch{return r.sendStatus(412)}
 });
 // Caller exposes this summary only after the suite PIN check.
 app.locals.ebayNotificationStatus=()=>({...status,configured:ready(),endpoint});
 const timer=setInterval(()=>void processQueue(),60000);timer.unref();void processQueue();return {processQueue,stop:()=>clearInterval(timer)};
}
module.exports={mount,challenge,signatureValid};
