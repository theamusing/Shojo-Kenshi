import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
// Always rebuild only the workspace's dist directory; renamed assets cannot linger.
const projectRoot = resolve('.'), outputRoot = resolve(projectRoot, 'dist');
const outputRelative = relative(projectRoot, outputRoot);
if (outputRelative !== 'dist' || isAbsolute(outputRelative)) throw new Error('Invalid build output path');
await rm(outputRoot, { recursive: true, force: true });
await mkdir('dist',{recursive:true});
await copyFile('index.html','dist/index.html');
await copyFile('.nojekyll','dist/.nojekyll');
await cp('src','dist/src',{recursive:true});
await cp('sprites','dist/sprites',{recursive:true});
await cp('assets','dist/assets',{recursive:true});
console.log('Static site ready in dist/ (GitHub Pages subpaths supported).');
