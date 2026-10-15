import fs from 'node:fs/promises';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {crc32,sha256} from './image-files.mjs';
import {selectFinals} from './runner.mjs';
export function makeZip(entries){
  if(entries.length>65535)throw new Error('当前ZIP写入器不支持ZIP64');
  const local=[],central=[];let offset=0;
  for(const entry of entries){
    if(!entry.name || entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\'))throw new Error('ZIP文件名必须是安全相对路径');
    const name=Buffer.from(entry.name,'utf8'),data=Buffer.from(entry.data),compressed=deflateRawSync(data),crc=crc32(data);
    if(data.length>0xffffffff||compressed.length>0xffffffff||offset>0xffffffff)throw new Error('文件过大，当前ZIP写入器不支持ZIP64');
    const head=Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt32LE(crc,14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
    local.push(head,name,compressed);
    const c=Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    central.push(c,name);offset+=head.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export async function packageRun(plan,directory,filename,{allowDrafts=false}={}){
  const selected=await selectFinals(plan,directory,{allowDrafts});
  const manifest={schemaVersion:'1.0',projectId:plan.projectId,revision:plan.revision,status:selected.status,createdAt:new Date().toISOString(),userAcceptance:'not-recorded',files:[]},entries=[];
  for(const {job,attempt,image} of selected.files){
    const stem=String(job.artifactIndex).padStart(2,'0')+'-'+job.jobId,name='images/'+stem+image.extension;
    entries.push({name,data:image.data});
    let prompt=job.prompt;
    if(attempt.executionPrompt){
      const full=path.resolve(directory,attempt.executionPrompt);
      if(!full.startsWith(path.resolve(directory)+path.sep))throw new Error('实际提示词路径越界');
      prompt=(await fs.readFile(full,'utf8')).replace(/\n$/,'');
      if(sha256(prompt)!==attempt.executionPromptDigest)throw new Error('实际提示词在记录后被修改');
    }
    entries.push({name:'prompts/'+stem+'.txt',data:prompt+'\n'});
    manifest.files.push({jobId:job.jobId,contentDigest:job.contentDigest,tripDay:job.tripDay,artifactIndex:job.artifactIndex,file:name,requestedSize:job.requestedSize,observedSize:image.observedSize,sha256:image.sha256,provider:attempt.provider,reviewStatus:attempt.reviewStatus??'pending',reviewMethod:attempt.coverageEvidence?.method??null,coverageTargets:job.coverageTargets});
  }
  entries.push({name:'manifest.json',data:JSON.stringify(manifest,null,2)+'\n'});
  const bytes=makeZip(entries);
  await fs.mkdir(path.dirname(filename),{recursive:true});
  await fs.writeFile(filename,bytes,{flag:'wx'});
  return {status:manifest.status,filename,bytes:bytes.length,sha256:sha256(bytes),images:manifest.files.length};
}
