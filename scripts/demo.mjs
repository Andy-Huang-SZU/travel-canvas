import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const args=process.argv.slice(2);
  if(args.length && (args.length!==2||args[0]!=='--out'))throw new Error('Usage: npm run demo -- --out ./runs/my-demo');
  const destination=path.resolve(args[1]||'./runs/demo-'+Date.now());
  await fs.mkdir(destination,{recursive:true});
  if((await fs.readdir(destination)).length)throw new Error('Demo destination is not empty; choose a new directory.');
  const cli=path.join(root,'cli.mjs'),skill=path.join(root,'skills/travel-illustrator');
  const run=(...arguments_)=>execFileSync(process.execPath,[cli,...arguments_],{cwd:root,encoding:'utf8'});
  const planDirectory=path.join(destination,'plan'),execution=path.join(destination,'execution');
  run('plan',path.join(skill,'assets/examples/native-demo.json'),'--execution','manual','--out',planDirectory);
  const planFile=path.join(planDirectory,'plan.json'),plan=JSON.parse(await fs.readFile(planFile,'utf8')),job=plan.jobs[0];
  const waiting=JSON.parse(run('render',planFile,'--config',path.join(root,'providers.example.json'),'--provider','manual','--out',execution));
  if(waiting.status!=='awaiting-result'||waiting.requestCount!==0)throw new Error('Offline demo unexpectedly submitted a request.');
  run('collect',planFile,'--job',job.jobId,'--digest',job.contentDigest,'--image',path.join(skill,'assets/demos/native-demo.png'),'--executed-prompt',path.join(skill,'assets/demos/native-demo.prompt.txt'),'--out',execution);
  const archive=path.join(destination,'demo-draft.zip');
  const packed=JSON.parse(run('pack',planFile,'--out',execution,'--archive',archive,'--allow-drafts'));
  if(packed.status!=='draft-package'||packed.images!==1)throw new Error('Expected one explicitly unreviewed draft image.');
  await fs.writeFile(path.join(destination,'DEMO.txt'),'Offline replay of the bundled fictional example. No new image was generated and no API was called. The ZIP is a draft, not a new visual review or user acceptance.\n');
  console.log(JSON.stringify({status:'offline-demo-complete',newImagesGenerated:0,httpGenerationRequests:0,archive,packageStatus:packed.status,plan:planFile},null,2));
} catch(error){console.error(error.message);process.exitCode=1;}
