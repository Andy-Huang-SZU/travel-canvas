import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {canonical,reviewCoverage} from '../core/plan.mjs';
import {sha256,inspectImage,readImage,atomicJson,readBoundFile} from './image-files.mjs';
import {generateWithProvider,validateProviderConfig,ProviderError} from './providers.mjs';
const safeJobId=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;
export function requestDigest(job){
  const {contentDigest,projectSnapshotDigest,...body}=job;
  return sha256(canonical(body));
}
export function validateRequest(job){
  if(!job || job.schemaVersion!=='1.0' || !safeJobId.test(job.jobId||''))throw new Error('请求缺少有效任务编号或版本');
  if(!/^[a-f0-9]{64}$/.test(job.contentDigest||'')||requestDigest(job)!==job.contentDigest)throw new Error('请求摘要不一致，请重新编译原项目');
  if(!Array.isArray(job.requestedSize)||job.requestedSize.length!==2||job.requestedSize.some(x=>!Number.isInteger(x)||x<256||x>8192))throw new Error('请求尺寸无效');
  if(!Array.isArray(job.coverageTargets)||!job.coverageTargets.length||!Array.isArray(job.copy)||!job.copy.length||typeof job.prompt!=='string'||!job.prompt.trim())throw new Error('请求缺少内容或覆盖目标');
  if(!['generate-page','generate-art'].includes(job.action))throw new Error('请求动作不受支持');
  return job;
}
export function validatePlan(plan){
  if(!plan || plan.schemaVersion!=='1.0'||!Array.isArray(plan.jobs)||!plan.jobs.length)throw new Error('没有可执行的请求');
  const ids=new Set();
  for(const job of plan.jobs){validateRequest(job);if(ids.has(job.jobId))throw new Error('同一计划中的任务编号重复');ids.add(job.jobId);}
  return plan;
}
const now=()=>new Date().toISOString();
const runPath=directory=>path.join(directory,'run.json');
export async function loadRun(directory){
  try{return JSON.parse(await fs.readFile(runPath(directory),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function ensureRun(plan,directory){
  validatePlan(plan);await fs.mkdir(directory,{recursive:true});
  let run=await loadRun(directory);
  const digests=plan.jobs.map(j=>({jobId:j.jobId,contentDigest:j.contentDigest}));
  if(run){
    if(run.planDigest!==sha256(canonical(digests)))throw new Error('运行目录属于不同内容修订，请另选目录；旧文件不覆盖');
  }else{
    run={schemaVersion:'1.0',projectId:plan.projectId,revision:plan.revision,planDigest:sha256(canonical(digests)),createdAt:now(),updatedAt:now(),status:'planned',requestCount:0,jobs:Object.fromEntries(plan.jobs.map(j=>[j.jobId,{jobId:j.jobId,contentDigest:j.contentDigest,status:'planned',attempts:[],selectedAttempt:null}]))};
    await atomicJson(runPath(directory),run);
    await atomicJson(path.join(directory,'plan.json'),plan);
  }
  return run;
}
async function saveRun(directory,run){run.updatedAt=now();await atomicJson(runPath(directory),run);}
async function acquire(directory){
  await fs.mkdir(directory,{recursive:true});
  const filename=path.join(directory,'run.lock');
  let handle;try{handle=await fs.open(filename,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('此运行目录已被锁定；先检查原执行进程，不能凭超时重复生成');throw error;}
  await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:now()})+'\n');await handle.close();
  return ()=>fs.rm(filename,{force:true});
}
async function withRun(plan,directory,action){
  const release=await acquire(directory);
  try{return await action(await ensureRun(plan,directory));}finally{await release();}
}
async function storeImage(job,data,directory,record,attempt,provider){
  const image=inspectImage(data);
  const relative=path.join('originals',job.jobId,'attempt-'+String(attempt.number).padStart(3,'0')+image.extension);
  await fs.mkdir(path.dirname(path.join(directory,relative)),{recursive:true});
  await fs.writeFile(path.join(directory,relative),data,{flag:'wx'});
  const mismatch=job.requireExactSize && image.observedSize.some((x,i)=>x!==job.requestedSize[i]);
  Object.assign(attempt,{status:mismatch?'rejected-size':'generated',completedAt:now(),artifactKind:job.action==='generate-art'?'art':'page',file:relative.replaceAll(path.sep,'/'),observedSize:image.observedSize,requestedSize:job.requestedSize,bytes:image.bytes,sha256:image.sha256,mime:image.mime,provider,coverageEvidence:null,userAcceptance:'not-recorded'});
  record.status=attempt.status;record.selectedAttempt=null;
  return attempt;
}
function providerFingerprint(id,config){
  // Secrets are read from env later and never included in the fingerprint or run record.
  return sha256(canonical({id,driver:config.driver,baseUrl:config.baseUrl??null,model:config.model??null,quality:config.quality??null,outputFormat:config.outputFormat??null,imageSize:config.imageSize??null,imageConfigStyle:config.imageConfigStyle??null,referenceMode:config.referenceMode??null}));
}
export async function renderPlan(plan,config,{providerId=config.default,directory,assetRoot=process.cwd(),env=process.env,fetchImpl=globalThis.fetch,signal,maxRequests,rateLimitRetries=0,delayImpl=delay}={}){
  validatePlan(plan);
  if(!directory)throw new Error('render需要专用运行目录');
  const provider=config.providers?.[providerId];if(!provider)throw new Error('所选provider未配置');
  validateProviderConfig(provider);
  if(!Number.isInteger(rateLimitRetries)||rateLimitRetries<0||rateLimitRetries>3)throw new Error('限流重试范围为0至3');
  if(maxRequests!==undefined&&(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>1000))throw new Error('请求上限应为1至1000');
  return withRun(plan,directory,async run=>{
    const fingerprint=providerFingerprint(providerId,provider);
    if(run.providerFingerprint && run.providerFingerprint!==fingerprint)throw new Error('此运行目录已绑定其他服务或模型，请创建新运行目录，不自动换服务');
    run.providerFingerprint=fingerprint;run.provider={id:providerId,driver:provider.driver,model:provider.model??null};
    const ceiling=maxRequests??plan.jobs.length;
    run.requestCeiling=ceiling;run.status='running';await saveRun(directory,run);
    for(const job of plan.jobs){
      const record=run.jobs[job.jobId];
      if(['generated','reviewed','rejected-size'].includes(record.status))continue;
      if(['submitting','unknown-outcome'].includes(record.status)){
        run.status='attention';await saveRun(directory,run);
        throw new Error('有状态不明的原提交，先查原服务任务或收回图片，不自动重新提交');
      }
      if(signal?.aborted){run.status='cancelled';break;}
      if(['agent-native','manual'].includes(provider.driver)){
        record.status='awaiting-result';
        record.execution=provider.driver==='agent-native'?'native':'manual';
        continue;
      }
      let retries=0;
      while(true){
        if(run.requestCount>=ceiling){run.status='request-limit';await saveRun(directory,run);return run;}
        const attempt={number:record.attempts.length+1,status:'preparing',startedAt:now(),provider:run.provider};
        record.attempts.push(attempt);record.status='preparing';
        await saveRun(directory,run);
        try{
          const generated=await generateWithProvider(job,provider,{assetRoot,env,fetchImpl,signal,onSubmit:async()=>{
            attempt.status='submitting';record.status='submitting';run.requestCount++;
            await saveRun(directory,run);
          }});
          await storeImage(job,generated.data,directory,record,attempt,{...run.provider,requestId:generated.requestId,usage:generated.usage});
          await saveRun(directory,run);break;
        }catch(error){
          const category=error instanceof ProviderError?error.category:'local';
          attempt.status=error.unknownOutcome?'unknown-outcome':'failed';attempt.completedAt=now();
          attempt.error={category,message:error instanceof ProviderError?error.message:'本地文件处理失败，已有记录保留',httpStatus:error.status??null,requestId:error.requestId??null};
          record.status=attempt.status;await saveRun(directory,run);
          if(category==='rate-limit' && retries<rateLimitRetries && run.requestCount<ceiling){
            retries++;await delayImpl(Math.min(30000,error.retryAfterMs??1000),undefined,{signal});continue;
          }
          if(error.unknownOutcome || ['configuration','authentication','quota','cancelled','local'].includes(category)){run.status='attention';await saveRun(directory,run);return run;}
          break;
        }
      }
    }
    if(run.status==='running')run.status=Object.values(run.jobs).every(j=>j.status==='awaiting-result')?'awaiting-result':Object.values(run.jobs).some(j=>['failed','unknown-outcome','rejected-size'].includes(j.status))?'partial':'generated-needs-review';
    await saveRun(directory,run);return run;
  });
}
export async function collectResult(plan,{jobId,contentDigest,imagePath,directory,executionPrompt,provider={id:'agent-native',driver:'agent-native',model:null}}){
  validatePlan(plan);const job=plan.jobs.find(j=>j.jobId===jobId);
  if(!job || job.contentDigest!==contentDigest)throw new Error('返回图片没有绑定正确任务和内容摘要');
  const image=await readImage(imagePath);
  return withRun(plan,directory,async run=>{
    const record=run.jobs[jobId],existing=record.attempts.find(a=>a.sha256===image.sha256 && a.artifactKind===(job.action==='generate-art'?'art':'page'));
    if(existing){try{const stored=await readBoundFile(directory,existing.file);if(stored.sha256===image.sha256)return {status:'already-collected',attempt:existing,run};}catch{}}
    const attempt={number:record.attempts.length+1,status:'collecting',startedAt:now()};
    record.attempts.push(attempt);
    await storeImage(job,image.data,directory,record,attempt,{id:provider.id??'agent-native',driver:provider.driver??'agent-native',model:provider.model??null,usage:null});
    if(typeof executionPrompt==='string'){
      const relative=path.join('originals',job.jobId,'attempt-'+String(attempt.number).padStart(3,'0')+'.prompt.txt');
      await fs.writeFile(path.join(directory,relative),executionPrompt+'\n',{flag:'wx'});
      attempt.executionPrompt=relative.replaceAll(path.sep,'/');attempt.executionPromptDigest=sha256(executionPrompt);
    }
    run.status='generated-needs-review';await saveRun(directory,run);
    return {status:attempt.status,attempt,run};
  });
}
export async function recordReview(plan,{jobId,attemptNumber,evidence,directory}){
  validatePlan(plan);const job=plan.jobs.find(j=>j.jobId===jobId);if(!job)throw new Error('没有这个任务');
  return withRun(plan,directory,async run=>{
    const record=run.jobs[jobId],attempt=attemptNumber?record.attempts.find(a=>a.number===attemptNumber):record.attempts.filter(a=>a.file).at(-1);
    if(!attempt?.file)throw new Error('这个任务没有可核对的生成文件');
    const image=await readBoundFile(directory,attempt.file);
    if(image.sha256!==attempt.sha256 || evidence.artifactSha256!==image.sha256)throw new Error('核对记录没有绑定当前实际图片');
    const verdict=reviewCoverage(job,{jobId,contentDigest:job.contentDigest,artifactKind:attempt.artifactKind,observedSize:image.observedSize,coverageEvidence:evidence});
    attempt.coverageEvidence={...evidence};attempt.reviewedAt=now();attempt.reviewStatus=verdict.status;
    if(verdict.status==='reviewed'){attempt.status='reviewed';record.status='reviewed';record.selectedAttempt=attempt.number;}
    else{record.status=verdict.status==='rejected'?'needs-repair':'needs-review';record.selectedAttempt=null;}
    run.status=Object.values(run.jobs).every(j=>j.status==='reviewed')?'reviewed':'needs-review';
    await saveRun(directory,run);return {verdict,run};
  });
}
export async function selectFinals(plan,directory,{allowDrafts=false}={}){
  validatePlan(plan);const run=await loadRun(directory);if(!run)throw new Error('没有运行记录');
  const expected=sha256(canonical(plan.jobs.map(j=>({jobId:j.jobId,contentDigest:j.contentDigest}))));
  if(run.planDigest!==expected)throw new Error('运行记录属于其他修订');
  const files=[],missing=[];
  for(const job of plan.jobs){
    const record=run.jobs[job.jobId];
    const attempt=record.selectedAttempt?record.attempts.find(a=>a.number===record.selectedAttempt):allowDrafts?record.attempts.filter(a=>a.file && a.artifactKind==='page').at(-1):null;
    if(!attempt || attempt.artifactKind!=='page' || !allowDrafts && attempt.reviewStatus!=='reviewed'){missing.push(job.jobId);continue;}
    const image=await readBoundFile(directory,attempt.file);
    if(image.sha256!==attempt.sha256)throw new Error('原图在核对后被修改，不能打包');
    if(job.requireExactSize && image.observedSize.some((x,i)=>x!==job.requestedSize[i]))throw new Error('实际尺寸未达到要求，不能作为最终图打包');
    files.push({job,attempt,image});
  }
  if(missing.length)throw new Error('这些任务还没有可打包的最终页：'+missing.join(', '));
  return {run,files,status:allowDrafts && files.some(f=>f.attempt.reviewStatus!=='reviewed')?'draft-package':'reviewed-package'};
}
