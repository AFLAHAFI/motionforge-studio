import { cp, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const src = resolve(root, 'node_modules/@ffmpeg/core/dist/esm');
const dest = resolve(root, 'public/ffmpeg');

try {
  await access(src, constants.R_OK);
} catch {
  console.error('FFmpeg core was not found. Run: npm install');
  process.exit(1);
}

await mkdir(dest, { recursive: true });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await cp(resolve(src, file), resolve(dest, file), { force: true });
}
console.log('FFmpeg core copied to public/ffmpeg.');
