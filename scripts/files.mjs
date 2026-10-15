import fs from 'node:fs/promises';
import path from 'node:path';
export const roots=['.agents/plugins','.codex-plugin','.github','scripts','skills','core','tests'];
export const topFiles=['.gitignore','LICENSE','README.md','README.en.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','cli.mjs','package.json','plugin.json','providers.example.json'];
export async function releaseFiles(root){
  const result=[...topFiles];
  async function walk(relative){
    const entries=await fs.readdir(path.join(root,relative),{withFileTypes:true});
    for(const entry of entries){
      const name=relative+'/'+entry.name;
      if(entry.isSymbolicLink())throw new Error('Release must not follow symlinks: '+name);
      if(entry.isDirectory())await walk(name);else if(entry.isFile())result.push(name);
    }
  }
  for(const directory of roots)await walk(directory);
  return result.sort();
}
