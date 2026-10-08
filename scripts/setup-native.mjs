import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
try {
  const path=require('ffmpeg-static');
  execFileSync(path,['-version'],{stdio:'ignore',timeout:5000});
  console.log('Native FFmpeg is ready. Start the local launcher.');
} catch {
  console.error('Native FFmpeg is not installed. Run npm install --save-optional ffmpeg-static@5.2.0 while online.');
  console.error('Alternatively place your FFmpeg executable in bin/ or add FFmpeg to PATH. Browser export remains available.');
  process.exitCode=1;
}
