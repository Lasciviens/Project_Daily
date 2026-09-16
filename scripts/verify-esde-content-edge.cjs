// Runs the actual handler with isolated DB/storage and credentials, no network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')
const source = fs.readFileSync('supabase/functions/esde-content-sync/index.ts','utf8').replace(/^import .*createClient.*$/m,'')
let handler, writes=0, stored, rpc, selectedOwner
const owner='00000000-0000-0000-0000-000000000001', variant='00000000-0000-0000-0000-000000000002'
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only',HEVY_USER_ID:owner,ESDE_SYNC_SECRET:'device-secret'}
const db={
  from() { const chain={select(){return chain},eq(k,v){if(k==='user_id')selectedOwner=v;return chain},order(){return chain},
    range:async()=>({data:[],error:null}),maybeSingle:async()=>({data:{id:variant,esde_system:'nes',esde_path:'./sub/Game.nes'},error:null})};return chain },
  storage:{from:()=>({upload:async(path,bytes,options)=>{writes++;stored={path,bytes,options};return {error:null}}})},
  rpc:async(name,args)=>{writes++;rpc={name,args};return {data:{saved:true,removed:0},error:null}},
}
new Function('Deno','createClient',stripTypeScriptTypes(source))({env:{get:k=>env[k]},serve:f=>handler=f},()=>db)
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
async function post(body,secret='device-secret') {return handler(new Request('https://test.invalid',{method:'POST',headers:{'x-esde-secret':secret},body:JSON.stringify(body)}))}
async function asset(bytes,patch={}) {
 const meta={variant_id:variant,key:'nes/fanart/sub/Game.png',category:'fanart',sha256:sha(bytes),size:bytes.length,...patch}
 return handler(new Request('https://test.invalid?action=asset',{method:'POST',headers:{'x-esde-secret':'device-secret','x-esde-asset':Buffer.from(JSON.stringify(meta)).toString('base64')},body:bytes}))
}
;(async()=>{
 assert.equal((await post({action:'inventory'},'wrong')).status,401)
 assert.equal((await post({action:'inventory',page:-1})).status,400)
 assert.equal((await post({action:'source',variant_id:'bad'})).status,400)
 assert.equal((await asset(Buffer.from('%PDF-1.7 document'))).status,400)
 assert.equal((await asset(Buffer.from('0000ftypisom VIDEO'))).status,400)
 assert.equal(writes,0)
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(30)])
 assert.equal((await asset(png,{category:'videos',key:'nes/videos/sub/Game.png'})).status,400)
 assert.equal((await asset(png,{key:'nes/fanart/../../other.png'})).status,400)
 assert.equal((await asset(png,{sha256:'a'.repeat(64)})).status,400)
 assert.equal(writes,0)
 assert.equal((await asset(png)).status,200)
 assert.equal(selectedOwner,owner)
 assert.deepEqual(Buffer.from(stored.bytes),png)
 assert.equal(stored.options.contentType,'image/png')
 assert.equal(stored.path,`${owner}/esde/${variant}/${sha(png)}.png`)
 assert.equal(rpc.args.p_value.asset.sha256,sha(png))
 const raw=JSON.stringify({game:'<game id="a"><unknown/><favorite>true</favorite></game>',context:{system:'nes'}})
 assert.equal((await post({action:'source',variant_id:variant,source_json:raw,sha256:sha(raw),user_id:'ignored-attacker-owner'})).status,200)
 assert.equal(rpc.args.p_user_id,owner)
 assert.equal(rpc.args.p_value.document.game,JSON.parse(raw).game)
 assert.equal((await post({action:'source',variant_id:variant,source_json:raw,sha256:'b'.repeat(64)})).status,400)
 console.log('Content Edge: auth, owner scope, PDF/video rejection, paths, hashes and original-byte upload verified')
})().catch(error=>{console.error(error);process.exitCode=1})
