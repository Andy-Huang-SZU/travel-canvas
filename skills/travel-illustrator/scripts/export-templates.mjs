// Generate machine-readable mirrors from the canonical prototype skin definitions.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {SKINS} from './core/plan.mjs';
const directory=fileURLToPath(new URL('../assets/templates/',import.meta.url));
await fs.mkdir(directory,{recursive:true});
for(const skin of Object.values(SKINS)){
  const data={schemaVersion:'1.0',...skin,role:'visual-skin',contentFormats:['day-timeline','trip-overview','photo-memory'],generatedFrom:'scripts/core/plan.mjs::SKINS',referenceAsset:'Optional user-supplied asset; do not silently bundle private references.',capacityNote:'Initial heuristic, not measured typography or a readability guarantee.',providerParameters:'Stored in provider configuration, not in this template.'};
  await fs.writeFile(directory+skin.id+'.json',JSON.stringify(data,null,2)+'\n');
}
