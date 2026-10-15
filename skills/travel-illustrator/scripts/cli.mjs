import fs from 'node:fs/promises';
import path from 'node:path';
import {validateProject,planProject,canonical,PROFILES} from './core/plan.mjs';
import {sha256,atomicJson} from './runtime/image-files.mjs';
import {configuredProfile} from './runtime/providers.mjs';
import {renderPlan,collectResult,recordReview,loadRun} from './runtime/runner.mjs';
import {packageRun} from './runtime/archive.mjs';
const [command,input,...args]=process.argv.slice(2);
const allowed=new Set(['--execution','--out','--config','--provider','--asset-root','--max-requests','--rate-limit-retries','--job','--digest','--image','--executed-prompt','--evidence','--attempt','--archive','--allow-drafts']);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const flag=name=>args.includes(name);
const readJson=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
const help='用法：validate <project.json>；plan <project.json>；render <plan.json> --config <providers.json>；collect <plan.json> --job <id> --digest <digest> --image <file>；review <plan.json> --job <id> --evidence <json>；pack <plan.json> --archive <zip>；status <run-directory>。执行命令均可带 --out <run-directory>。';
try{
  for(let i=0;i<args.length;i++){
    if(!allowed.has(args[i]))throw new Error('未知命令选项；'+help);
    if(args[i]!=='--allow-drafts' && (!args[i+1]||args[i+1].startsWith('--')))throw new Error('命令选项缺少值；'+help);
    if(args[i]!=='--allow-drafts')i++;
  }
  if(!input||!['validate','plan','render','collect','review','pack','status'].includes(command))throw new Error(help);
  if(command==='status'){
    const run=await loadRun(path.resolve(input));if(!run)throw new Error('没有运行记录');
    console.log(JSON.stringify({projectId:run.projectId,status:run.status,requestCount:run.requestCount,jobs:Object.values(run.jobs).map(j=>({jobId:j.jobId,status:j.status,attempts:j.attempts.length,selectedAttempt:j.selectedAttempt}))},null,2));
  }else if(command==='validate'||command==='plan'){
    const project=await readJson(input);validateProject(project);
    if(command==='validate')console.log('输入结构与语义检查通过；尚未证明旅行事实真实。');
    else{
      let profile=PROFILES[option('--execution','manual')];
      if(flag('--config')){
        const config=await readJson(option('--config')),id=option('--provider',config.default);
        if(!config.providers?.[id])throw new Error('provider没有配置');
        profile=configuredProfile(id,config.providers[id]);
      }
      if(!profile)throw new Error('未知执行路径');
      const plan=planProject(project,profile),out=path.resolve(option('--out','./runs/'+project.id+'-r'+project.revision));
      const snapshotDigest=sha256(canonical(project));
      for(const job of plan.jobs){job.contentDigest=sha256(canonical(job));job.projectSnapshotDigest=snapshotDigest;}
      await fs.mkdir(out,{recursive:true});
      if((await fs.readdir(out)).length)throw new Error('计划输出目录已有内容，请另选目录，避免覆盖旧修订');
      await atomicJson(path.join(out,'plan.json'),plan);
      await atomicJson(path.join(out,'local-context.json'),{assetRoot:path.dirname(path.resolve(input))});
      for(const job of plan.jobs){
        await fs.writeFile(path.join(out,job.jobId+'.request.json'),JSON.stringify(job,null,2)+'\n',{flag:'wx'});
        await fs.writeFile(path.join(out,job.jobId+'.prompt.txt'),job.prompt+'\n',{flag:'wx'});
      }
      console.log(JSON.stringify({status:plan.status,jobs:plan.jobCount,targets:plan.targetCount,execution:profile.execution,out,warnings:plan.warnings},null,2));
    }
  }else{
    const plan=await readJson(input),out=path.resolve(option('--out',path.join(path.dirname(path.resolve(input)),'execution')));
    let result;
    if(command==='render'){
      const configPath=option('--config');if(!configPath)throw new Error('render需要 --config；原生和手动路径也使用明确配置');
      const config=await readJson(configPath);
      let assetRoot=option('--asset-root');
      if(!assetRoot){try{assetRoot=(await readJson(path.join(path.dirname(path.resolve(input)),'local-context.json'))).assetRoot;}catch{assetRoot=path.dirname(path.resolve(input));}}
      const controller=new AbortController(),cancel=()=>controller.abort();
      process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      try{
        result=await renderPlan(plan,config,{providerId:option('--provider',config.default),directory:out,assetRoot:path.resolve(assetRoot),signal:controller.signal,maxRequests:flag('--max-requests')?Number(option('--max-requests')):undefined,rateLimitRetries:Number(option('--rate-limit-retries',0))});
      }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
      result={status:result.status,requestCount:result.requestCount,jobs:Object.values(result.jobs).map(j=>({jobId:j.jobId,status:j.status}))};
    }else if(command==='collect'){
      const collected=await collectResult(plan,{jobId:option('--job'),contentDigest:option('--digest'),imagePath:option('--image'),executionPrompt:flag('--executed-prompt')?await fs.readFile(option('--executed-prompt'),'utf8'):undefined,directory:out});
      result={status:collected.status,jobId:option('--job'),file:collected.attempt.file,observedSize:collected.attempt.observedSize,sha256:collected.attempt.sha256};
    }else if(command==='review'){
      const evidencePath=option('--evidence');if(!evidencePath)throw new Error('review需要图片绑定的核对记录');
      const reviewed=await recordReview(plan,{jobId:option('--job'),attemptNumber:flag('--attempt')?Number(option('--attempt')):undefined,evidence:await readJson(evidencePath),directory:out});
      result=reviewed.verdict;
    }else{
      const filename=option('--archive');if(!filename)throw new Error('pack需要 --archive 文件名');
      result=await packageRun(plan,out,path.resolve(filename),{allowDrafts:flag('--allow-drafts')});
    }
    console.log(JSON.stringify(result,null,2));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
