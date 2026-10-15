import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {releaseFiles} from './files.mjs';
import {makeZip} from '../skills/travel-illustrator/scripts/runtime/archive.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),package_=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const files=await releaseFiles(root),version=package_.version,directory=path.join(root,'dist');
await fs.mkdir(directory,{recursive:true});
const output=[];
for(const kind of ['project','skill']){
  const skillPrefix='skills/travel-illustrator/',selected=kind==='project'?files:files.filter(file=>file.startsWith(skillPrefix));
  const name=(kind==='project'?'travel-canvas-':'travel-illustrator-')+version+'.zip';
  const entries=await Promise.all(selected.map(async file=>({name:kind==='project'?'travel-canvas-'+version+'/'+file:'travel-illustrator/'+file.slice(skillPrefix.length),data:await fs.readFile(path.join(root,file))})));
  const bytes=makeZip(entries);await fs.writeFile(path.join(directory,name),bytes);
  output.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),files:selected.length});
}
await fs.writeFile(path.join(directory,'SHA256SUMS'),output.map(file=>file.sha256+'  '+file.name).join('\n')+'\n');
console.log(JSON.stringify({version,archives:output},null,2));
