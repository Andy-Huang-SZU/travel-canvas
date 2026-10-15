import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {planProject,canonical,PROFILES,validateProject} from '../core/plan.mjs';
import {crc32,sha256,inspectImage,decodeImageBase64} from '../skills/travel-illustrator/scripts/runtime/image-files.mjs';
import {generateWithProvider,validateEndpoint,validateProviderConfig} from '../skills/travel-illustrator/scripts/runtime/providers.mjs';
import {requestDigest,renderPlan,collectResult,recordReview,selectFinals,loadRun} from '../skills/travel-illustrator/scripts/runtime/runner.mjs';
import {makeZip,packageRun} from '../skills/travel-illustrator/scripts/runtime/archive.mjs';
const base=JSON.parse(await fs.readFile(new URL('../skills/travel-illustrator/assets/examples/weekend.json',import.meta.url),'utf8'));
// Synthetic image bytes exercise transport and container integrity, not model quality.
function png(width=16,height=24){
  const chunk=(type,body)=>{const head=Buffer.alloc(8),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);head.write(type,4);tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type),body])));return Buffer.concat([head,body,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const row=Buffer.alloc(width*3+1,125);row[0]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),chunk('IEND',Buffer.alloc(0))]);
}
const image=png();
function plan(input=base){
  const p=planProject(structuredClone(input),PROFILES.api);
  for(const job of p.jobs){job.contentDigest=requestDigest(job);job.projectSnapshotDigest=sha256(canonical(input));}
  return p;
}
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'travel-canvas-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function service(t,handler){
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);await handler(req,res,Buffer.concat(chunks));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return 'http://127.0.0.1:'+server.address().port;
}
const provider=(url,extra={})=>({driver:'openai-images',baseUrl:url,model:'mock-image-model',apiKeyEnv:'TEST_IMAGE_KEY',allowHttpLocalhost:true,...extra});
const config=c=>({default:'test',providers:{test:c}});
const env={TEST_IMAGE_KEY:'local-test-only'};
const ok=(res,data=image)=>{res.writeHead(200,{'content-type':'application/json','x-request-id':'mock-request'});res.end(JSON.stringify({data:[{b64_json:data.toString('base64')}],usage:{input_tokens:12,output_tokens:34,total_tokens:46}}));};
test('PNG实际尺寸与CRC读取，损坏块不能收图',()=>{
  assert.deepEqual(inspectImage(image).observedSize,[16,24]);const bad=Buffer.from(image);bad[20]^=1;assert.throws(()=>inspectImage(bad),/PNG校验/);
});
test('非图片、无效Base64与隐藏凭证配置拒绝',()=>{
  assert.throws(()=>inspectImage(Buffer.from('secret-not-an-image')),/未识别/);
  assert.throws(()=>decodeImageBase64('!!!'),/Base64/);
  assert.throws(()=>validateProviderConfig(provider('https://api.example/v1',{apiKey:'not-a-real-key'})),/密钥值/);
});
test('provider地址不夹带密钥，不允许远程明文HTTP',()=>{
  assert.throws(()=>validateEndpoint('https://user:password@api.example/v1'),/凭证/);
  assert.throws(()=>validateEndpoint('https://api.example/v1?key=x'),/查询/);
  assert.throws(()=>validateEndpoint('http://api.example/v1',{allowHttpLocalhost:true}),/HTTPS/);
});
test('修订号不能改变输出目录结构',()=>{const p=structuredClone(base);p.revision='../../escape';assert.throws(()=>validateProject(p),/安全修订号/);});
test('OpenAI路径真实发送JSON与所选鉴权，读取实际图片',async t=>{
  let received;
  const url=await service(t,(req,res,body)=>{received={url:req.url,auth:req.headers.authorization,body:JSON.parse(body)};ok(res);});
  const job=plan().jobs[0],r=await generateWithProvider(job,provider(url),{env});
  assert.equal(received.url,'/images/generations');assert.equal(received.auth,'Bearer local-test-only');
  assert.equal(received.body.prompt,job.prompt);assert.equal(received.body.size,'1024x1536');assert.equal(received.body.n,1);
  assert.deepEqual(inspectImage(r.data).observedSize,[16,24]);assert.equal(r.usage.cost,null);
});
test('Gemini路径使用独立请求结构并读取inlineData',async t=>{
  let received;
  const url=await service(t,(req,res,body)=>{received={url:req.url,key:req.headers['x-goog-api-key'],body:JSON.parse(body)};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}],usageMetadata:{promptTokenCount:5,candidatesTokenCount:6,totalTokenCount:11}}));});
  const r=await generateWithProvider(plan().jobs[0],provider(url,{driver:'gemini-image',imageSize:'1K'}),{env});
  assert.equal(received.url,'/models/mock-image-model:generateContent');assert.equal(received.key,'local-test-only');
  assert.equal(received.body.generationConfig.responseFormat.image.aspectRatio,'2:3');assert.equal(received.body.generationConfig.responseFormat.image.imageSize,'1K');assert.equal(r.usage.totalTokens,11);
});
test('参考图进入multipart编辑请求，不作为文字路径泄漏',async t=>{
  const dir=await directory(t);await fs.writeFile(path.join(dir,'ref.png'),image);
  let received;
  const url=await service(t,(req,res,body)=>{received={url:req.url,contentType:req.headers['content-type'],body:body.toString('latin1')};ok(res);});
  const p=structuredClone(base);p.assets=[{id:'reference',uri:'ref.png',role:'style-reference',rights:'user-owned'}];
  await generateWithProvider(plan(p).jobs[0],provider(url),{env,assetRoot:dir});
  assert.equal(received.url,'/images/edits');assert.match(received.contentType,/multipart\/form-data/);assert.match(received.body,/name="image\[\]"/);assert.ok(!received.body.includes(dir));
});
test('兼容服务没有参考图能力时不静默省略',async t=>{
  const dir=await directory(t);await fs.writeFile(path.join(dir,'ref.png'),image);
  const p=structuredClone(base);p.assets=[{id:'reference',uri:'ref.png',role:'style-reference',rights:'user-owned'}];
  let called=false;await assert.rejects(()=>generateWithProvider(plan(p).jobs[0],provider('https://api.example/v1',{driver:'openai-compatible'}),{env,assetRoot:dir,fetchImpl:()=>{called=true;}}),/未声明支持/);assert.equal(called,false);
});
test('缺少密钥时零HTTP提交，也不会吞成成功',async t=>{
  const dir=await directory(t);let called=0;
  const r=await renderPlan(plan(),config(provider('https://api.example/v1')),{directory:dir,env:{},fetchImpl:()=>{called++;}});
  assert.equal(called,0);assert.equal(r.requestCount,0);assert.equal(r.status,'attention');
});
test('额度错误不自动重试，错误日志不包含服务回显的密钥',async t=>{
  const dir=await directory(t);let calls=0;
  const url=await service(t,(req,res)=>{calls++;res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'insufficient_quota',message:'echo local-test-only'}}));});
  const r=await renderPlan(plan(),config(provider(url)),{directory:dir,env,maxRequests:4,rateLimitRetries:3});
  assert.equal(calls,1);assert.equal(r.status,'attention');assert.ok(!JSON.stringify(r).includes('local-test-only'));
});
test('明确限流在总请求上限内退避重试',async t=>{
  const dir=await directory(t);let calls=0,waited;
  const url=await service(t,(req,res)=>{calls++;if(calls===1){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'rate_limit_exceeded'}}));}else ok(res);});
  const r=await renderPlan(plan(),config(provider(url)),{directory:dir,env,maxRequests:2,rateLimitRetries:1,delayImpl:async ms=>{waited=ms;}});
  assert.equal(calls,2);assert.equal(waited,1000);assert.equal(r.requestCount,2);assert.equal(r.jobs[plan().jobs[0].jobId].status,'generated');
});
test('内容拒绝不会原样重试',async t=>{
  const dir=await directory(t);let calls=0;
  const url=await service(t,(req,res)=>{calls++;res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'moderation_blocked'}}));});
  const r=await renderPlan(plan(),config(provider(url)),{directory:dir,env,maxRequests:4,rateLimitRetries:3});
  assert.equal(calls,1);assert.equal(r.jobs[plan().jobs[0].jobId].attempts[0].error.category,'content');
});
test('超时保留未知状态，恢复时不重复提交',async t=>{
  const dir=await directory(t);let calls=0;
  const url=await service(t,(req,res)=>{calls++;setTimeout(()=>{if(!res.destroyed)ok(res);},100);});
  const p=plan(),c=config(provider(url,{timeoutMs:25}));
  const r=await renderPlan(p,c,{directory:dir,env});assert.equal(r.status,'attention');assert.equal(calls,1);
  await assert.rejects(()=>renderPlan(p,c,{directory:dir,env}),/状态不明/);assert.equal(calls,1);
});
test('服务500非JSON响应仍是未知结果，不当成可重复提交失败',async t=>{
  const dir=await directory(t),url=await service(t,(req,res)=>{res.writeHead(500,{'content-type':'text/plain'});res.end('oops');});
  const r=await renderPlan(plan(),config(provider(url)),{directory:dir,env});assert.equal(r.jobs[plan().jobs[0].jobId].status,'unknown-outcome');
});
test('Gemini安全拦截与文字结果都不能冒充成图',async()=>{
  const job=plan().jobs[0],c=provider('https://api.example/v1',{driver:'gemini-image'});
  await assert.rejects(()=>generateWithProvider(job,c,{env,fetchImpl:async()=>new Response(JSON.stringify({candidates:[{finishReason:'SAFETY'}]}))}),e=>e.category==='content');
  await assert.rejects(()=>generateWithProvider(job,c,{env,fetchImpl:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'no image'}]}}]}))}),/没有返回图片/);
});
test('严格尺寸检查以真实返回像素为准',async t=>{
  const dir=await directory(t),p=plan();p.jobs[0].requireExactSize=true;p.jobs[0].contentDigest=requestDigest(p.jobs[0]);
  const url=await service(t,(req,res)=>ok(res));
  const r=await renderPlan(p,config(provider(url)),{directory:dir,env});assert.equal(r.jobs[p.jobs[0].jobId].status,'rejected-size');await assert.rejects(()=>selectFinals(p,dir,{allowDrafts:true}),/实际尺寸/);
});
test('成功图片在恢复时不重复生成',async t=>{
  const dir=await directory(t);let calls=0;
  const url=await service(t,(req,res)=>{calls++;ok(res);});
  const p=plan(),c=config(provider(url));await renderPlan(p,c,{directory:dir,env});await renderPlan(p,c,{directory:dir,env});assert.equal(calls,1);
});
test('手动与原生路径标为等待结果，零请求计数',async t=>{
  for(const driver of ['manual','agent-native']){
    const dir=await directory(t);const r=await renderPlan(plan(),config({driver}),{directory:dir});
    assert.equal(r.status,'awaiting-result');assert.equal(r.requestCount,0);
  }
});
test('收图保留原文件，绑定修订且同图幂等',async t=>{
  const dir=await directory(t),source=path.join(dir,'source.png');await fs.writeFile(source,image);
  const p=plan(),j=p.jobs[0];
  await assert.rejects(()=>collectResult(p,{jobId:j.jobId,contentDigest:'b'.repeat(64),imagePath:source,directory:path.join(dir,'run')}),/正确任务/);
  const a=await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:path.join(dir,'run')});
  const b=await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:path.join(dir,'run')});
  assert.equal(a.status,'generated');assert.equal(b.status,'already-collected');assert.ok(await fs.stat(source));
});
test('被改动的旧收图不阻断从原始文件重新收回',async t=>{
  const dir=await directory(t),source=path.join(dir,'source.png');await fs.writeFile(source,image);
  const p=plan(),j=p.jobs[0],runDir=path.join(dir,'run');
  const first=await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:runDir});
  await fs.writeFile(path.join(runDir,first.attempt.file),png(20,30));
  const repaired=await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:runDir});
  assert.equal(repaired.attempt.number,2);assert.equal(repaired.attempt.sha256,sha256(image));
});
test('实际执行提示词随输出包保存，改动后拒绝交付',async t=>{
  const dir=await directory(t),source=path.join(dir,'source.png');await fs.writeFile(source,image);
  const p=plan(),j=p.jobs[0],runDir=path.join(dir,'run'),executionPrompt='Actual host wrapper\n'+j.prompt;
  const collected=await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,executionPrompt,directory:runDir});
  await recordReview(p,{jobId:j.jobId,evidence:{method:'agent-visual',reviewer:'test',artifactSha256:sha256(image),matchedIds:j.coverageTargets.map(t=>t.id),checkedSemantics:true,checkedNoInventedCopy:true},directory:runDir});
  const packed=await packageRun(p,runDir,path.join(dir,'result.zip'));assert.equal(packed.status,'reviewed-package');
  await fs.writeFile(path.join(runDir,collected.attempt.executionPrompt),'changed\n');await assert.rejects(()=>packageRun(p,runDir,path.join(dir,'other.zip')),/实际提示词/);
});
test('覆盖核对绑定实际文件摘要，agent核对不冒充用户接受',async t=>{
  const dir=await directory(t),source=path.join(dir,'source.png');await fs.writeFile(source,image);
  const p=plan(),j=p.jobs[0],runDir=path.join(dir,'run');await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:runDir});
  const evidence={method:'agent-visual',reviewer:'test-agent',artifactSha256:sha256(image),matchedIds:j.coverageTargets.map(t=>t.id),checkedSemantics:true,checkedNoInventedCopy:true};
  await assert.rejects(()=>recordReview(p,{jobId:j.jobId,evidence:{...evidence,artifactSha256:'b'.repeat(64)},directory:runDir}),/实际图片/);
  const r=await recordReview(p,{jobId:j.jobId,evidence,directory:runDir});assert.equal(r.verdict.status,'reviewed');assert.equal(r.verdict.userAcceptance,'not-recorded');
});
test('未核对页默认不可打包，明确草稿包保持草稿身份',async t=>{
  const dir=await directory(t),source=path.join(dir,'source.png');await fs.writeFile(source,image);const p=plan(),j=p.jobs[0],runDir=path.join(dir,'run');
  await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:runDir});
  await assert.rejects(()=>packageRun(p,runDir,path.join(dir,'final.zip')),/最终页/);
  const r=await packageRun(p,runDir,path.join(dir,'draft.zip'),{allowDrafts:true});assert.equal(r.status,'draft-package');
});
test('核对后被改动的图片不能作为最终图打包',async t=>{
  const dir=await directory(t),source=path.join(dir,'source.png');await fs.writeFile(source,image);const p=plan(),j=p.jobs[0],runDir=path.join(dir,'run');
  const collected=await collectResult(p,{jobId:j.jobId,contentDigest:j.contentDigest,imagePath:source,directory:runDir});
  await recordReview(p,{jobId:j.jobId,evidence:{method:'human',reviewer:'test',artifactSha256:sha256(image),matchedIds:j.coverageTargets.map(t=>t.id),checkedSemantics:true,checkedNoInventedCopy:true},directory:runDir});
  await fs.writeFile(path.join(runDir,collected.attempt.file),png(20,30));await assert.rejects(()=>packageRun(p,runDir,path.join(dir,'final.zip')),/核对后被修改/);
});
test('ZIP写入保持CRC并拒绝路径穿越文件名',()=>{
  const zip=makeZip([{name:'manifest.json',data:'{"ok":true}'}]);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.throws(()=>makeZip([{name:'../escape',data:'x'}]),/安全相对路径/);
});
test('同一输出目录不接受不同内容修订或服务',async t=>{
  const dir=await directory(t),p=plan();await renderPlan(p,config({driver:'manual'}),{directory:dir});
  const other=structuredClone(p);other.jobs[0].copy[0].label='changed';other.jobs[0].contentDigest=requestDigest(other.jobs[0]);
  await assert.rejects(()=>renderPlan(other,config({driver:'manual'}),{directory:dir}),/不同内容修订/);
  await assert.rejects(()=>renderPlan(p,{default:'other',providers:{other:{driver:'agent-native'}}},{directory:dir}),/其他服务或模型/);
});
