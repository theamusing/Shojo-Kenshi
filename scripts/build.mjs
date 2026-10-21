import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
await mkdir('dist',{recursive:true});
await copyFile('index.html','dist/index.html');
await copyFile('.nojekyll','dist/.nojekyll');
await cp('src','dist/src',{recursive:true});
await cp('sprites','dist/sprites',{recursive:true});
// Remove stale generated audio when source samples have been removed.
const outputRoot = resolve('dist'), audioOutput = resolve(outputRoot, 'assets/audio');
const audioRelative = relative(outputRoot, audioOutput);
if (!audioRelative || audioRelative.startsWith('..') || isAbsolute(audioRelative)) throw new Error('Invalid audio output path');
await rm(audioOutput, { recursive: true, force: true });
await cp('assets','dist/assets',{recursive:true});
console.log('Static site ready in dist/ (GitHub Pages subpaths supported).');
