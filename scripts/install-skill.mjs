import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../skills/travel-illustrator/',import.meta.url));
try {
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--to')throw new Error('Usage: node scripts/install-skill.mjs --to /path/to/skills/travel-illustrator');
  const target=path.resolve(args[1]),base=path.resolve(source);
  if(target===base||target.startsWith(base+path.sep))throw new Error('Choose a destination outside the source Skill folder.');
  try {await fs.lstat(target);throw new Error('Destination already exists; nothing was overwritten. Choose another path or review your installed version first.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.cp(base,target,{recursive:true,errorOnExist:true,force:false});
  console.log(JSON.stringify({status:'installed-files',skill:'travel-illustrator',path:target,next:'Let your agent discover this directory or read its SKILL.md. Host activation is separate from file installation.'},null,2));
} catch(error){console.error(error.message);process.exitCode=1;}
