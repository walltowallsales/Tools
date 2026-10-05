'use strict';
const express=require('express'),path=require('path');const app=express();
const base=process.env.TAG_SORT_INTERNAL_URL||'http://127.0.0.1:3106';
app.use(express.json({limit:'100kb'}));app.use(express.static(path.join(__dirname,'public')));
app.use('/api',async(req,res)=>{try{
 const allowed=req.method==='GET'&&(/^\/floor(?:\/product\/[^/]+\/live|\/batch\/[^/]+\/[^/]+\/live)?$/.test(req.path)||req.path==='/index-status')||req.method==='POST'&&(req.path==='/refresh'||/^\/product\/[^/]+\/location$/.test(req.path));
 if(!allowed)return res.status(404).json({error:'Unknown action.'});
 const response=await fetch(base+'/api'+req.url,{method:req.method,headers:{'Content-Type':'application/json'},body:req.method==='POST'?JSON.stringify(req.body):undefined});
 res.status(response.status).type('json').send(await response.text());
}catch(e){res.status(503).json({error:'The shared inventory service is unavailable. Try again shortly.'})}});
app.listen(process.env.PORT||3108,()=>console.log('FLOOR relocation module ready'));
