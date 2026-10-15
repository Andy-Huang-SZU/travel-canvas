import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {releaseFiles} from './files.mjs';
import {validateProject,planProject,SKINS} from '../core/plan.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async relative=>JSON.parse(await fs.readFile(path.join(root,relative),'utf8'));
const package_=await read('package.json'),portable=await read('plugin.json'),codex=await read('.codex-plugin/plugin.json');
assert.equal(portable.name,package_.name);assert.equal(codex.name,package_.name);
assert.equal(portable.version,package_.version);assert.equal(codex.version,package_.version);
assert.equal(codex.skills,'./skills/');
const skill='skills/travel-illustrator',instructions=await fs.readFile(path.join(root,skill,'SKILL.md'),'utf8');
assert.match(instructions,/^---\nname: travel-illustrator\ndescription: .+/);
assert.ok(instructions.includes('version: "'+package_.version+'"'));
for(const file of ['README.md','README.en.md','CONTRIBUTING.md',skill+'/SKILL.md',skill+'/references/execution.md',skill+'/references/portable-contract.md']){
  const text=await fs.readFile(path.join(root,file),'utf8');
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
    const link=match[1];if(/^(?:[a-z]+:|#)/i.test(link))continue;
    const target=path.resolve(root,path.dirname(file),link.split('#')[0]);
    assert.ok(target.startsWith(root),'Reference escapes package: '+file);
    assert.ok((await fs.stat(target)).isFile(),'Missing local reference: '+file+' → '+link);
  }
}
const marketplace=await read('.agents/plugins/marketplace.json');
assert.equal(marketplace.plugins[0].name,portable.name);
assert.equal(path.resolve(root,marketplace.plugins[0].source.path),path.resolve(root));
assert.ok(marketplace.plugins[0].source.path.startsWith('./'));
const examples=await fs.readdir(path.join(root,skill,'assets/examples'));
for(const filename of examples){const input=await read(skill+'/assets/examples/'+filename);validateProject(input);assert.ok(planProject(input).jobs.length>0);}
for(const skin of Object.values(SKINS)){const mirror=await read(skill+'/assets/templates/'+skin.id+'.json');for(const key of Object.keys(skin))assert.deepEqual(mirror[key],skin[key]);}
assert.deepEqual(await read('providers.example.json'),await read(skill+'/assets/config/providers.example.json'));
const receipt=await read(skill+'/assets/demos/native-demo.receipt.json'),image=await fs.readFile(path.join(root,skill,'assets/demos/native-demo.png'));
assert.equal(createHash('sha256').update(image).digest('hex'),receipt.sha256);
const files=await releaseFiles(root);
for(const file of files){
  assert.ok(!/(?:^|\/)(?:runs|private|node_modules|dist|\.git)(?:\/|$)/.test(file),file);
  assert.ok(!/\.local\.json$|(?:^|\/)\.env(?:\.|$)/.test(file),file);
  if(!file.endsWith('.png')){
    const text=await fs.readFile(path.join(root,file),'utf8');
    assert.ok(!/\/Users\/[a-zA-Z0-9_-]+\//.test(text),'Personal absolute path: '+file);
    assert.ok(!/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text),'Private key: '+file);
    assert.ok(!/gh[pousr]_[a-zA-Z0-9]{30,}/.test(text),'GitHub token: '+file);
  }
}
console.log(JSON.stringify({status:'passed',version:package_.version,releaseFiles:files.length,fictionalExamples:examples.length,checks:['manifest identity','Skill references bundled','marketplace path','input semantics','template mirrors','provider config mirrors','demo image hash','release file boundaries']}));
