// Release 19: compile the worker at build time so production runs plain node, without tsx.
import {build} from 'esbuild';
await build({entryPoints:['scripts/worker.ts'],outfile:'build/worker/worker.mjs',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',sourcemap:false,logLevel:'warning',
 banner:{js:"import {createRequire as __rpRequire} from 'node:module';const require=__rpRequire(import.meta.url);"}});
console.log('Worker compiled to build/worker/worker.mjs');
