import http from 'node:http';
import { readFile, stat, mkdir, writeFile, rm, mkdtemp, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const base = dirname(fileURLToPath(import.meta.url));
const root = resolve(base, 'dist');
const port = Number(process.env.PORT || 4173);
const token = randomBytes(24).toString('hex');
const jobs = new Map();
let ffmpegPath = process.env.MOTIONFORGE_FFMPEG || '';
if (!ffmpegPath) {
  try { ffmpegPath = (await import('ffmpeg-static')).default; } catch {}
  if (!ffmpegPath) ffmpegPath = join(base, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try { await access(ffmpegPath); } catch { ffmpegPath = 'ffmpeg'; }
}
let nativeAvailable = false;
try { execFileSync(ffmpegPath, ['-version'], { timeout: 5000, stdio: 'ignore', windowsHide: true }); nativeAvailable = true; } catch {}
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function json(res, code, data) { res.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
async function body(req, max) {
  const pieces=[]; let bytes=0;
  for await (const chunk of req) { bytes+=chunk.length; if(bytes>max) {const error=new Error('Request too large.');error.status=413;throw error;}pieces.push(chunk); }
  return Buffer.concat(pieces);
}
function numeric(value,lo,hi) {if(!Number.isFinite(value)||value<lo||value>hi)throw new Error('Invalid export settings.');return value;}
async function deleteJob(id) {
  const job=jobs.get(id);if(!job)return;
  job.cancelled=true;
  if(job.process) {
    const child=job.process;
    await new Promise(resolve=>{child.once('close',resolve);child.kill('SIGKILL');setTimeout(resolve,3000).unref();});
  }
  await rm(job.dir,{recursive:true,force:true});jobs.delete(id);
}
const server=http.createServer(async (req,res)=>{
  try {
    if(req.headers.host!==`localhost:${port}`&&req.headers.host!==`127.0.0.1:${port}`)return json(res,403,{error:'Invalid local host.'});
    const origin=req.headers.origin;
    if(origin&&origin!==`http://localhost:${port}`&&origin!==`http://127.0.0.1:${port}`)return json(res,403,{error:'Cross-origin requests are blocked.'});
    const pathname=new URL(req.url,`http://localhost:${port}`).pathname;
    if(pathname.startsWith('/api/')) {
      if(pathname==='/api/diagnostics'&&req.method==='GET')return json(res,200,{nativeAvailable,token,version:2});
      if(req.headers['x-motionforge-token']!==token)return json(res,403,{error:'Invalid session token.'});
      if(pathname==='/api/jobs'&&req.method==='POST') {
        if(!nativeAvailable)return json(res,503,{error:'Native FFmpeg is unavailable.'});
        if(jobs.size>=2)return json(res,409,{error:'Finish or cancel the active render first.'});
        const data=JSON.parse((await body(req,10000)).toString());
        const width=numeric(data.width,64,7680),height=numeric(data.height,64,7680),frames=numeric(data.frames,1,18000),fps=numeric(data.fps,1,60),crf=numeric(data.crf,15,23);
        if(![width,height,frames,fps,crf].every(Number.isInteger)||width%2||height%2||![24,30,60].includes(fps)||![15,18,23].includes(crf)||!/^#[0-9a-f]{6}$/i.test(data.background))throw new Error('Invalid dimensions, frame count, frame rate or background.');
        const id=randomBytes(16).toString('hex'),dir=await mkdtemp(join(tmpdir(),'motionforge-'));
        jobs.set(id,{id,dir,width,height,frames,fps,crf,background:data.background,audioVolume:numeric(data.audioVolume??1,0,2),audioStart:numeric(data.audioStart??0,0,300),status:'capturing',count:0,bytes:0,encodedFrames:0,created:Date.now()});
        return json(res,201,{id});
      }
      const match=/^\/api\/jobs\/([a-f0-9]{32})(?:\/(.*))?$/.exec(pathname);
      if(!match)return json(res,404,{error:'Unknown local endpoint.'});
      const job=jobs.get(match[1]);if(!job)return json(res,404,{error:'Render job not found.'});
      const action=match[2]||'';
      if(!action&&req.method==='DELETE'){await deleteJob(job.id);return json(res,200,{cancelled:true});}
      if(!action&&req.method==='GET')return json(res,200,{status:job.status,encodedFrames:job.encodedFrames,error:job.error});
      if(action==='audio'&&req.method==='PUT') {
        if(job.status!=='capturing')throw new Error('Job already encoding.');
        await writeFile(join(job.dir,'audio'),await body(req,20_000_000));job.audio=true;return json(res,200,{ok:true});
      }
      const frameMatch=/^frames\/(\d+)$/.exec(action);
      if(frameMatch&&req.method==='PUT') {
        const index=Number(frameMatch[1]);if(job.status!=='capturing'||index!==job.count||index>=job.frames)throw new Error('Frames must arrive in order.');
        const data=await body(req,80_000_000);
        if(data.length<24)throw new Error('Invalid PNG frame.');
        if(data.readUInt32BE(16)!==job.width||data.readUInt32BE(20)!==job.height)throw new Error('PNG dimensions do not match the project.');
        if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid PNG frame.');
        const diskLimit=Number(process.env.MOTIONFORGE_DISK_LIMIT_MB||8192)*1024*1024;
        if(job.bytes+data.length>diskLimit)throw new Error('Local render disk budget exceeded. Shorten the export range.');
        if(job.cancelled)throw new Error('Render cancelled.');
        await writeFile(join(job.dir,`frame${String(index).padStart(6,'0')}.png`),data);job.count++;job.bytes+=data.length;return json(res,200,{ok:true});
      }
      if(action==='encode'&&req.method==='POST') {
        if(job.status!=='capturing'||job.count!==job.frames)throw new Error('All frames must arrive before encoding.');
        job.status='encoding';
        const duration=job.frames/job.fps;
        const args=['-hide_banner','-loglevel','error','-y','-framerate',String(job.fps),'-i','frame%06d.png'];
        if(job.audio)args.push('-ss',String(job.audioStart),'-i','audio');
        const filter=`color=c=${job.background}:s=${job.width}x${job.height}:r=${job.fps}[bg];[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p[v]`;
        args.push('-filter_complex',filter,'-map','[v]');
        if(job.audio)args.push('-map','1:a:0','-af',`volume=${job.audioVolume},apad,afade=t=in:st=0:d=0.25,afade=t=out:st=${Math.max(0,duration-.4)}:d=0.4`,'-c:a','aac','-b:a','192k');
        args.push('-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf',String(job.crf),'-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:1','output.mp4');
        const child=spawn(ffmpegPath,args,{cwd:job.dir,windowsHide:true});job.process=child;
        let errors='',progress='';
        child.stderr.on('data',data=>{errors=(errors+data.toString()).slice(-6000);});
        child.stdout.on('data',data=>{progress+=data.toString();const lines=progress.split('\n');progress=lines.pop();for(const line of lines){const match=/^frame=(\d+)/.exec(line);if(match)job.encodedFrames=Number(match[1]);}});
        child.once('error',error=>{job.status='error';job.error=error.message;job.process=null;});
        child.once('close',code=>{job.process=null;if(job.cancelled)return;job.status=code===0?'done':'error';job.error=code===0?null:errors||`FFmpeg exited ${code}`;});
        return json(res,202,{status:'encoding'});
      }
      if(action==='output'&&req.method==='GET') {
        if(job.status!=='done')throw new Error('Render is not finished.');
        const path=join(job.dir,'output.mp4'),info=await stat(path);
        res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':info.size,'Cache-Control':'no-store'});createReadStream(path).pipe(res);return;
      }
      return json(res,405,{error:'Unsupported operation.'});
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
    const decoded=decodeURIComponent(pathname);
    const path=resolve(root,'.'+decoded);
    if(path!==root&&!path.startsWith(root+sep))return json(res,403,{error:'Invalid path.'});
    let target=path;
    try{const info=await stat(target);if(info.isDirectory())target=join(target,'index.html');}catch{return json(res,404,{error:'File not found. Run npm run build if the app is not built.'});}
    const data=await readFile(target);
    res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:data);
  } catch(error) {if(!res.headersSent)json(res,error.status||400,{error:error.message});else res.destroy();}
});
function openBrowser() {
  const url=`http://localhost:${port}`;
  let command,args;
  if(process.platform==='win32'){command=process.env.ComSpec||'cmd.exe';args=['/d','/s','/c',`start "" "${url}"`];}
  else if(process.platform==='darwin'){command='open';args=[url];}
  else{command='xdg-open';args=[url];}
  const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});
  child.on('error',()=>console.log(`Open your browser manually at ${url}`));child.unref();
}
server.listen(port,'127.0.0.1',()=>{console.log(`MotionForge Studio 2.1 running at http://localhost:${port}\nNative FFmpeg: ${nativeAvailable?'ready':'not found (browser engine remains available)'}`);if(process.argv.includes('--open'))openBrowser();});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Close another MotionForge window or set PORT.`:error.message);process.exitCode=1;});
const expiry=setInterval(()=>{for(const job of jobs.values())if(Date.now()-job.created>60*60*1000)deleteJob(job.id).catch(()=>{});},60000);expiry.unref();
async function stop(){server.close();await Promise.allSettled([...jobs.keys()].map(deleteJob));process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
