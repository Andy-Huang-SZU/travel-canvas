import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'travel-canvas-smoke-'));
try {
  const demo=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/demo.mjs'),'--out',path.join(temporary,'demo')],{encoding:'utf8'}));
  assert.equal(demo.newImagesGenerated,0);assert.equal(demo.httpGenerationRequests,0);
  assert.ok((await fs.stat(demo.archive)).size>1000);
  const destination=path.join(temporary,'installed/travel-illustrator');
  execFileSync(process.execPath,[path.join(root,'scripts/install-skill.mjs'),'--to',destination],{encoding:'utf8'});
  // Run the installed Skill after copying it outside the repository.
  const installedOutput=path.join(temporary,'installed-plan');
  const planned=JSON.parse(execFileSync(process.execPath,[path.join(destination,'scripts/cli.mjs'),'plan',path.join(destination,'assets/examples/dense-day.json'),'--execution','manual','--out',installedOutput],{cwd:temporary,encoding:'utf8'}));
  assert.equal(planned.targets,15);assert.equal(planned.status,'planned-not-generated');
  const repeat=spawnSync(process.execPath,[path.join(root,'scripts/install-skill.mjs'),'--to',destination],{encoding:'utf8'});
  assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/already exists/);
  const original=await fs.readFile(path.join(root,'skills/travel-illustrator/SKILL.md'));
  assert.deepEqual(await fs.readFile(path.join(destination,'SKILL.md')),original);
  console.log(JSON.stringify({status:'passed',checks:['offline demo through draft ZIP','standalone Skill install','installed 15-entry plan','existing installation protected'],newProviderCalls:0}));
} finally {await fs.rm(temporary,{recursive:true,force:true});}
