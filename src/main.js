import './style.css';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { toPng } from 'html-to-image';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const demoSvg = studioExamples().bar.code;

const state = {
  sourceType: 'svg',
  sourceName: 'animated-bar-chart.svg',
  sourceCode: demoSvg,
  duration: 5,
  fps: 30,
  outWidth: 1920,
  outHeight: 1080,
  background: '#0a0d14',
  transparent: false,
  fit: 'contain',
  zoom: 1,
  currentTime: 0,
  playing: true,
  ffmpegReady: false,
  exporting: false,
  dirty: false,
  trustedHtml: false,
  renderMode: 'frame',
  engine: 'auto',
  rangeStart: 0, rangeEnd: 5,
  quality: '18',
  assets: {},
  audio: null
};

let ffmpeg;
let playRaf = 0;
let lastTick = performance.now();
let renderController = null;
let activeJob = null;
let nativeAvailable = false;
let apiToken = '';
let previewLoaded = Promise.resolve();
let previewReady = false;
let previewRevision = 0;
let autosaveTimer;
let renderTaskActive = false;
let cancelled = false;
const MAX_BROWSER_PIXELS = 400_000_000;

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">M</div>
        <div><strong>MotionForge Studio</strong><span>SVG / HTML TO VIDEO</span></div>
      </div>
      <div class="project-meta">
        <span class="dot"></span><span id="projectName">motionforge-demo.svg</span>
        <span class="save-state" id="saveState">Not saved yet</span>
      </div>
      <div class="top-actions">
        <button class="ghost" id="newBtn">New</button>
        <button class="ghost" id="openProjectBtn">Open project</button>
        <button class="ghost" id="saveProjectBtn">Save project</button>
        <button class="primary" id="exportBtn">Export MP4</button>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar left-panel">
        <div class="panel-title"><span>Source</span><span class="kbd">LOCAL</span></div>
        <div class="tabs">
          <button class="tab active" data-tab="file">Upload file</button>
          <button class="tab" data-tab="code">Paste code</button>
        </div>

        <div class="tab-page active" data-page="file">
          <label class="dropzone" id="dropzone">
            <input id="fileInput" type="file" accept=".svg,.html,.htm,image/svg+xml,text/html" hidden>
            <div class="drop-icon">＋</div>
            <strong>Drop SVG or HTML</strong>
            <span>or click to browse</span>
            <small>SMIL · CSS · HTML · Canvas</small>
          </label>
          <div class="file-card" id="fileCard">
            <div class="file-badge" id="fileBadge">SVG</div>
            <div class="file-info"><strong id="fileName">motionforge-demo.svg</strong><span id="fileDetails">960 × 540 · animated</span></div>
            <button class="icon-btn" id="reloadBtn" title="Reload preview">↻</button>
          </div>
        </div>

        <div class="tab-page" data-page="code">
          <textarea id="codeInput" spellcheck="false" placeholder="Paste SVG or full HTML code here..."></textarea>
          <button class="primary full" id="applyCodeBtn">Apply to preview</button>
        </div>

        <div class="divider"></div>
        <div class="panel-title"><span>Animation examples</span></div>
        <select id="exampleSelect" aria-label="Animation example"><option value="bar">Animated bar chart · SVG</option><option value="line">Line graph · SVG</option><option value="pie">Donut chart · SVG</option><option value="css">Dashboard cards · HTML/CSS</option><option value="canvas">Canvas graph · HTML/JS</option></select>
        <button class="secondary full" id="loadExampleBtn">Load example</button>
        <button class="secondary full" id="spinGeneratorBtn" style="margin-top:8px">Optional: birthday date spin</button>
        <div class="quick-grid" style="margin-top:8px"><button class="mini" id="counterTemplateBtn">Countdown</button><button class="mini" id="revealTemplateBtn">Text reveal</button></div>
        <label class="asset-label">Import images / fonts / JS / CSS<input id="assetInput" type="file" multiple accept="image/*,.woff,.woff2,.ttf,.otf,.js,.css" hidden></label>
        <p class="hint" id="assetStatus">Reference imported files by name, including local chart.js or styles.css. JavaScript runs only in trusted mode.</p>
        <label class="asset-label">Add local audio<input id="audioInput" type="file" accept="audio/*" hidden></label>
        <div class="quick-grid"><button class="mini" id="removeAudioBtn">Remove audio</button><input id="audioVolume" aria-label="Audio volume" type="number" min="0" max="2" step="0.1" value="1"></div>
        <p class="hint" id="audioStatus">Audio muxing requires native FFmpeg.</p>
        <div class="divider"></div>
        <div class="panel-title"><span>Project</span></div>
        <div class="field-row"><label>Duration</label><div class="input-suffix"><input id="durationInput" type="number" min="0.1" max="300" step="0.1" value="3"><span>sec</span></div></div>
        <div class="field-row"><label>Background</label><div class="color-wrap"><input id="bgColor" type="color" value="#0a0d14"><input id="bgText" value="#0a0d14" maxlength="7"></div></div>
        <label class="check-row"><input id="transparentInput" type="checkbox"><span>Transparent background</span></label>
        <label class="check-row"><input id="trustInput" type="checkbox"><span>Trust imported HTML scripts</span></label>
        <p class="hint">Enable trusted HTML only for files/code you created or trust. SVG animations work without this option.</p>

        <div class="divider"></div>
        <div class="panel-title"><span>Quick tools</span></div>
        <div class="quick-grid">
          <button class="mini" id="snapshotBtn">PNG frame</button>
          <button class="mini" id="copyCodeBtn">Copy code</button><button class="mini" id="downloadSourceBtn">Save SVG / HTML</button>
          <button class="mini" id="resetViewBtn">Fit view</button>
          <button class="mini" id="diagnoseBtn">Diagnose</button>
        </div>
      </aside>

      <section class="stage-area">
        <div class="stage-toolbar">
          <div class="toolbar-group">
            <button class="icon-btn" id="zoomOutBtn">−</button>
            <button class="zoom-value" id="zoomValue">100%</button>
            <button class="icon-btn" id="zoomInBtn">＋</button>
          </div>
          <div class="toolbar-group center-label">
            <span id="modeChip" class="mode-chip">SVG · SEEKABLE ANIMATION</span>
          </div>
          <div class="toolbar-group">
            <select id="fitSelect"><option value="contain">Fit</option><option value="cover">Fill</option></select>
            <button class="icon-btn" id="fullscreenBtn" title="Fullscreen">⛶</button>
          </div>
        </div>
        <div class="source-message hidden" id="sourceMessage" role="alert"></div><div class="canvas-outer" id="canvasOuter">
          <div class="stage-bg" id="stageBg">
            <div class="preview-frame" id="previewFrame">
              <iframe id="preview" sandbox="allow-same-origin" title="Animation preview"></iframe>
            </div>
          </div>
          <div class="render-badge" id="renderBadge"><span></span> Ready</div>
        </div>

        <div class="timeline">
          <div class="transport">
            <button class="icon-btn" id="restartBtn">↺</button>
            <button class="play-btn" id="playBtn">Ⅱ</button>
            <button class="icon-btn" id="endBtn">↦</button>
            <div class="time-readout"><span id="currentTime">00:00.000</span><em>/</em><span id="totalTime">00:03.000</span></div>
          </div>
          <div class="scrubber-wrap">
            <div class="ruler" id="ruler"></div>
            <input id="scrubber" type="range" min="0" max="3" value="0" step="0.001">
          </div>
        </div>
      </section>

      <aside class="sidebar right-panel">
        <div class="panel-title"><span>Export settings</span><span class="status-pill" id="enginePill">Engine idle</span></div>
        <label class="stack-field"><span>Aspect ratio</span><select id="aspectSelect"><option value="landscape">Landscape · 16:9</option><option value="portrait">Reel · 9:16</option><option value="square">Square · 1:1</option><option value="custom">Custom</option></select></label>
        <label class="stack-field"><span>Resolution</span><select id="resolutionSelect">
          <option value="1280x720">HD · 1280×720</option>
          <option value="1920x1080" selected>Full HD · 1920×1080</option>
          <option value="2560x1440">2K · 2560×1440</option>
          <option value="3840x2160">4K · 3840×2160</option>
          <option value="custom">Custom</option>
        </select></label>
        <div class="two-col custom-res" id="customRes">
          <label><span>Width</span><input id="widthInput" type="number" value="1920" min="64" max="7680"></label>
          <label><span>Height</span><input id="heightInput" type="number" value="1080" min="64" max="4320"></label>
        </div>
        <label class="stack-field"><span>Frame rate</span><select id="fpsSelect"><option>24</option><option selected>30</option><option>60</option></select></label>
        <div class="two-col"><label><span>Export from (sec)</span><input id="rangeStart" type="number" min="0" step="0.1" value="0"></label><label><span>Export to (sec)</span><input id="rangeEnd" type="number" min="0.1" step="0.1" value="3"></label></div>
        <label class="stack-field"><span>Encoder</span><select id="engineSelect"><option value="auto">Auto · prefer local native FFmpeg</option><option value="native">Native FFmpeg · local launcher</option><option value="wasm">FFmpeg.wasm · browser</option></select></label>
        <label class="stack-field"><span>Quality</span><select id="qualitySelect"><option value="23">Balanced</option><option value="18" selected>High</option><option value="15">Maximum</option></select></label>
        <label class="stack-field"><span>Render method</span><select id="renderModeSelect"><option value="frame">Frame-accurate (SVG/CSS)</option><option value="live">Live capture (HTML/Canvas)</option></select></label>

        <div class="estimate-card">
          <div><span>Frames</span><strong id="frameEstimate">90</strong></div>
          <div><span>Output</span><strong id="sizeEstimate">~ 4–12 MB</strong></div>
          <div><span>Privacy</span><strong class="green">Local processing</strong></div>
        </div>

        <button class="export-big" id="exportBigBtn"><span>Export MP4</span><small>H.264 · native / browser FFmpeg</small></button>
        <button class="secondary full" id="exportWebmBtn">Export WebM preview</button>

        <div class="divider"></div>
        <div class="panel-title"><span>Render queue</span><button class="text-btn" id="clearLogBtn">Clear</button></div>
        <div class="log" id="log"><div class="log-empty">No renders yet.</div></div>
      </aside>
    </main>

    <footer class="statusbar">
      <div><span class="online-dot"></span> Local-only workspace</div>
      <div id="footerStatus">Ready · external assets blocked by default</div>
      <div>MotionForge Studio 2.1</div>
    </footer>
  </div>

  <div class="modal hidden" id="progressModal">
    <div class="modal-card">
      <div class="spinner-ring"></div>
      <h3 id="progressTitle">Rendering video</h3>
      <p id="progressText">Preparing frames…</p>
      <div class="progress-track"><div id="progressBar"></div></div>
      <div class="progress-stats"><span id="progressPct">0%</span><span id="progressDetail">Initializing</span></div>
      <button class="secondary full" id="cancelExportBtn">Cancel render</button>
    </div>
  </div>

  <div class="modal hidden" id="spinModal"><div class="modal-card generator-card">
    <h3>Birthday date spin</h3><p>Months, days and years roll, slow down and stop on your chosen date.</p>
    <label class="stack-field"><span>Target birthday</span><input type="date" id="birthdayInput" value="2000-01-01"></label>
    <label class="stack-field"><span>Name / title</span><input id="birthdayTitle" maxlength="60" value="HAPPY BIRTHDAY"></label>
    <div class="two-col"><label><span>Spin duration</span><input type="number" id="spinDuration" min="2" max="20" step="0.5" value="6"></label><label><span>Final hold</span><input type="number" id="spinHold" min="0.5" max="15" step="0.5" value="3"></label></div>
    <label class="stack-field"><span>Layout</span><select id="spinAspect"><option value="portrait">Reel · 9:16</option><option value="landscape">Landscape · 16:9</option><option value="square">Square · 1:1</option></select></label>
    <div class="two-col"><label><span>Accent</span><input type="color" id="spinAccent" value="#65e2bf"></label><label><span>Background</span><input type="color" id="spinBackground" value="#080b12"></label></div>
    <div class="quick-grid"><button class="secondary" id="closeSpinBtn">Close</button><button class="primary" id="createSpinBtn">Create animation</button></div>
  </div></div>
  <input id="projectInput" type="file" accept=".mforge,.json,application/json" hidden>
`;

function studioExamples() {
  const labels=['Jan','Feb','Mar','Apr','May','Jun'];
  const values=[42,58,49,74,68,92];
  const colors=['#68d9cf','#70ccec','#8899ef','#a18ade','#d19ddf','#e9b976'];
  const header=`<rect width="1920" height="1080" fill="#101722"/><text x="150" y="145" font-family="Arial" font-size="28" letter-spacing="5" fill="#8fa3bb">MOTIONFORGE · ANIMATED DATA</text>`;
  const svg=body=>`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${header}${body}</svg>`;
  const bar=svg(`<text x="150" y="245" font-family="Arial" font-size="72" font-weight="700" fill="#f2f6fc">Monthly performance</text><text x="150" y="310" font-family="Arial" font-size="28" fill="#8fa3bb">Example data · edit labels and values in the source</text><path d="M150 420V890H1780" fill="none" stroke="#334256" stroke-width="3"/>${[25,50,75,100].map(v=>`<path d="M150 ${890-v*4.6}H1780" stroke="#263449" stroke-width="2"/><text x="125" y="${900-v*4.6}" text-anchor="end" font-family="Arial" font-size="22" fill="#8fa3bb">${v}</text>`).join('')}${values.map((value,i)=>`<g><rect x="${235+i*255}" y="890" width="145" height="0" rx="10" fill="${colors[i]}"><animate attributeName="height" from="0" to="${value*4.6}" begin="${i*.18}s" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .7 .2 1"/><animate attributeName="y" from="890" to="${890-value*4.6}" begin="${i*.18}s" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .7 .2 1"/></rect><text x="${307+i*255}" y="${870-value*4.6}" text-anchor="middle" font-family="Arial" font-size="32" font-weight="700" fill="#f2f6fc" opacity="0">${value}<animate attributeName="opacity" from="0" to="1" begin="${1.6+i*.18}s" dur=".35s" fill="freeze"/></text><text x="${307+i*255}" y="945" text-anchor="middle" font-family="Arial" font-size="30" fill="#acbcd0">${labels[i]}</text></g>`).join('')}`);
  const path='M220 800 L500 690 L780 735 L1060 510 L1340 570 L1640 390';
  const line=svg(`<text x="150" y="245" font-family="Arial" font-size="72" font-weight="700" fill="#f2f6fc">A story of steady growth</text><text x="150" y="310" font-family="Arial" font-size="28" fill="#8fa3bb">Example line graph · 6 data points</text><path d="M180 380V860H1750" fill="none" stroke="#334256" stroke-width="3"/><path d="${path}" fill="none" stroke="#68d9cf" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="1000"><animate attributeName="stroke-dashoffset" from="1000" to="0" dur="3s" fill="freeze"/></path>${[[220,800],[500,690],[780,735],[1060,510],[1340,570],[1640,390]].map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="12" fill="#f2f6fc" opacity="0"><set attributeName="opacity" to="1" begin="${i*.6}s" fill="freeze"/></circle><text x="${x}" y="935" font-family="Arial" font-size="30" text-anchor="middle" fill="#8fa3bb">${labels[i]}</text>`).join('')}`);
  const pie=svg(`<text x="150" y="245" font-family="Arial" font-size="72" font-weight="700" fill="#f2f6fc">Project completion</text><circle cx="620" cy="635" r="225" fill="none" stroke="#263449" stroke-width="70"/><circle cx="620" cy="635" r="225" fill="none" stroke="#68d9cf" stroke-width="70" stroke-linecap="round" pathLength="100" stroke-dasharray="78 100" stroke-dashoffset="78" transform="rotate(-90 620 635)"><animate attributeName="stroke-dashoffset" from="78" to="0" dur="3s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .7 .2 1"/></circle><text x="620" y="655" text-anchor="middle" font-family="Arial" font-size="110" font-weight="700" fill="#f2f6fc" opacity="0">78%<animate attributeName="opacity" from="0" to="1" begin="2s" dur="1s" fill="freeze"/></text><text x="1080" y="585" font-family="Arial" font-size="45" fill="#f2f6fc">78% completed</text><text x="1080" y="660" font-family="Arial" font-size="32" fill="#8fa3bb">22% remaining</text><text x="1080" y="765" font-family="Arial" font-size="26" fill="#8fa3bb">Example data · SVG donut chart</text>`);
  const css=`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#edf1f5;font-family:Arial,sans-serif;color:#1c2b3f}.page{padding:7vw;width:100%;height:100%}small{letter-spacing:.3em;color:#546b83;font-size:1.4vw}h1{font-size:4.5vw;margin:2vw 0 4vw}.cards{display:flex;gap:2vw}.card{flex:1;background:white;border-radius:1.5vw;padding:2.5vw;box-shadow:0 1vw 3vw #22334412;animation:enter 1.2s both}.card:nth-child(2){animation-delay:.3s}.card:nth-child(3){animation-delay:.6s}h2{font-size:1.5vw;color:#546b83;font-weight:400}.value{font-size:4vw;font-weight:700}.track{background:#e3eaf0;height:1vw;border-radius:1vw;margin-top:3vw;overflow:hidden}.fill{width:80%;height:100%;background:#237f88;transform-origin:left;animation:grow 2.5s .6s both}.card:nth-child(2) .fill{width:64%;background:#7566a2}.card:nth-child(3) .fill{width:92%;background:#c08b3b}@keyframes enter{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}</style></head><body><main class="page"><small>ANIMATED DASHBOARD</small><h1>A clear view of progress.</h1><div class="cards"><section class="card"><h2>Projects completed</h2><div class="value">80%</div><div class="track"><div class="fill"></div></div></section><section class="card"><h2>Monthly target</h2><div class="value">64%</div><div class="track"><div class="fill"></div></div></section><section class="card"><h2>Customer satisfaction</h2><div class="value">92%</div><div class="track"><div class="fill"></div></div></section></div></main></body></html>`;
  const canvas=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#101722;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="chart" data-motionforge-capture="full"></canvas><script>const canvas=document.getElementById('chart'),ctx=canvas.getContext('2d');const values=[42,58,49,74,68,92];window.motionforgeSeek=function(seconds){canvas.width=innerWidth;canvas.height=innerHeight;const w=canvas.width,h=canvas.height,p=Math.min(Math.max(seconds/3,0),1),ease=1-Math.pow(1-p,3);ctx.fillStyle='#101722';ctx.fillRect(0,0,w,h);ctx.fillStyle='#f2f6fc';ctx.font='bold '+w*.045+'px Arial';ctx.fillText('Canvas graph',w*.08,h*.17);ctx.fillStyle='#8fa3bb';ctx.font=w*.018+'px Arial';ctx.fillText('Deterministic HTML/JS example · '+seconds.toFixed(2)+' seconds',w*.08,h*.25);values.forEach((v,i)=>{const x=w*(.12+i*.13),height=h*.46*(v/100)*ease;ctx.fillStyle=['#68d9cf','#70ccec','#8899ef','#a18ade','#d19ddf','#e9b976'][i];ctx.fillRect(x,h*.8-height,w*.075,height);ctx.fillStyle='#f2f6fc';ctx.fillText(String(Math.round(v*ease)),x,h*.8-height-h*.025);});};window.motionforgeSeek(0);</script></body></html>`;
  return {bar:{name:'animated-bar-chart.svg',code:bar,duration:5},line:{name:'animated-line-graph.svg',code:line,duration:5},pie:{name:'animated-donut-chart.svg',code:pie,duration:5},css:{name:'animated-dashboard.html',code:css,duration:5},canvas:{name:'seekable-canvas-graph.html',code:canvas,duration:5}};
}

function errorMessage(error) {
  if (typeof error === 'string' && error.trim()) return error;
  if(error?.name==='EncodingError')return 'The frame could not be rasterized. Check SVG markup and embedded images/fonts, then test PNG frame export.';
  if (error?.message) return String(error.message);
  if (error?.type === 'error' || error?.target?.tagName === 'IMG') return 'Image capture failed. An SVG/HTML snapshot could not be decoded. Check imported images/fonts and try the PNG frame test.';
  if (error?.name === 'AbortError') return 'Operation cancelled.';
  return 'Operation failed. Use Diagnose and try the supplied chart example to isolate the source.';
}
function showSourceError(error) {
  const message=errorMessage(error);
  $('#sourceMessage').textContent=message;
  $('#sourceMessage').classList.remove('hidden');
  log(message,'error'); setStatus('Source not applied · previous preview kept','error');
}
function clearSourceError(){ $('#sourceMessage').classList.add('hidden'); $('#sourceMessage').textContent=''; }
function normalizeSource(raw) {
  let code=String(raw||'').replace(/^\uFEFF/,'').trim();
  if(!code)throw new Error('Paste complete SVG or HTML code first.');
  const fence=/^```(?:svg|xml|html)?\s*\n([\s\S]*?)\n```$/i.exec(code);
  if(fence)code=fence[1].trim();
  if(code.includes('```'))throw new Error('Copy one complete code block, without Markdown fences or surrounding explanations.');
  const significant=code.replace(/<!--[\s\S]*?-->/g,'').replace(/^<\?xml[^>]*>\s*/i,'').replace(/^<!doctype\s+svg[^>]*>\s*/i,'').trim();
  if(/^<svg(?:\s|>)/i.test(significant)) {
    if(!/\bxmlns\s*=/.test(significant.match(/^<svg\b[^>]*>/i)?.[0]||''))code=code.replace(/<svg\b/i,'<svg xmlns="http://www.w3.org/2000/svg"');
    const doc=new DOMParser().parseFromString(code,'image/svg+xml');
    const error=doc.querySelector('parsererror');
    if(error||doc.documentElement.localName!=='svg')throw new Error('Invalid SVG: '+(error?.textContent||'missing root SVG').replace(/\s+/g,' ').slice(0,230));
    return {code,type:'svg'};
  }
  if(/^<(?:rect|circle|ellipse|path|line|polyline|polygon|text|g|defs|mask|clipPath|linearGradient|radialGradient|animate|animateTransform|stop|filter)\b/i.test(significant)||/<\/svg\s*>/i.test(code)&&!/<svg\b/i.test(code))throw new Error('This is an incomplete SVG fragment. Copy everything from the opening <svg ...> tag through the closing </svg> tag. The previous preview has been kept.');
  if(!/^<(?:!doctype\s+html|html|head|body|div|main|section|article|style|canvas|p|h[1-6]|table|figure|svg)\b/i.test(significant))throw new Error('Expected a complete SVG or HTML document. Plain prompts cannot be rendered; paste the generated code.');
  const doc=new DOMParser().parseFromString(code,'text/html');
  if(!doc.body.querySelector('svg,canvas,div,main,section,article,p,h1,h2,h3,table,figure,img,video')&&!doc.body.textContent.trim())throw new Error('The HTML contains no visible content to preview. Include the body content, not only styles or definitions.');
  return {code,type:'html'};
}
async function applySource(raw,name,clearAssets=false) {
  const candidate=normalizeSource(raw); // Validate before changing the active project.
  const previous={...state};
  try {
    Object.assign(state,{sourceCode:candidate.code,sourceType:candidate.type,sourceName:name||`pasted-animation.${candidate.type}`,currentTime:0,trustedHtml:false,playing:false});
    if(clearAssets){state.assets={};state.audio=null;}
    const inferred=inferDuration(candidate.code,candidate.type);if(inferred)state.duration=Math.min(300,inferred);
    state.rangeStart=0;state.rangeEnd=state.duration;
    if(candidate.type==='svg'){const size=parseSvgSize(candidate.code);state.outWidth=Math.round(clampNumber(size.width,64,7680,1920)/2)*2;state.outHeight=Math.round(clampNumber(size.height,64,7680,1080)/2)*2;}
    await updatePreview();
    $('#codeInput').value=candidate.code;$('#playBtn').textContent='▶';updateUi();markDirty();clearSourceError();
    log(`${candidate.type.toUpperCase()} ready: ${state.sourceName}`,'success');
    if(candidate.type==='html'&&/<script\b/i.test(candidate.code))log('This HTML contains JavaScript. Enable Trust imported HTML scripts only if you trust the code.','info');
  } catch(error) {Object.assign(state,previous);updateUi();await updatePreview().catch(()=>{});throw error;}
}

function markDirty(flag = true) {
  state.dirty = flag;
  $('#saveState').textContent = flag ? 'Unsaved changes · autosaving' : 'Project file saved';
  $('#saveState').classList.toggle('dirty', flag);
  if (flag) scheduleAutosave();
}

function setStatus(text, level = 'normal') {
  $('#footerStatus').textContent = text;
  $('#renderBadge').className = `render-badge ${level}`;
  $('#renderBadge').replaceChildren(document.createElement('span'), document.createTextNode(' ' + text));
}

function log(message, type = 'info') {
  const box = $('#log');
  $('.log-empty', box)?.remove();
  const row = document.createElement('div');
  row.className = `log-row ${type}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  row.innerHTML = `<span class="log-dot"></span><div><strong>${escapeHtml(message)}</strong><small>${time}</small></div>`;
  box.prepend(row);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function fmtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function parseSvgSize(code) {
  try {
    const doc = new DOMParser().parseFromString(code, 'image/svg+xml');
    const svg = doc.documentElement;
    const length=value=>/^([0-9.]+)(px)?$/.test(value||'')?parseFloat(value):0;
    let w = length(svg.getAttribute('width'));
    let h = length(svg.getAttribute('height'));
    if (!w || !h) {
      const vb = (svg.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
      if (vb.length === 4 && vb.every(Number.isFinite)) { w = vb[2]; h = vb[3]; }
    }
    return { width: Math.round(w || 960), height: Math.round(h || 540) };
  } catch { return { width: 960, height: 540 }; }
}

function inferDuration(code, type) {
  if (type !== 'svg') return null;
  const doc=new DOMParser().parseFromString(code,'image/svg+xml');
  const seconds=value=>{const m=/^([0-9.]+)(ms|s|min|h)?$/.exec((value||'').trim());return m?Number(m[1])*({ms:.001,s:1,min:60,h:3600}[m[2]||'s']):null;};
  const ends=[...doc.querySelectorAll('animate,animateTransform,animateMotion,set')].map(el=>{const duration=seconds(el.getAttribute('dur'));if(duration===null)return 0;const begin=seconds(el.getAttribute('begin'))||0;const repeats=Number(el.getAttribute('repeatCount'));return begin+duration*(Number.isFinite(repeats)&&repeats>0?repeats:1);});
  return ends.length?Math.max(...ends)||null:null;
}

function resolveAssets(src) {
  const lookup = value => {
    if (/^(data:|blob:|#)/i.test(value)) return value;
    const key = value.replace(/^\.\//, '').split('/').pop();
    return Object.hasOwn(state.assets,key) ? state.assets[key].data : value;
  };
  let result = src.replace(/\b(src|href|xlink:href|poster)\s*=\s*(["'])(.*?)\2/gi, (_, attr, quote, value) => `${attr}=${quote}${lookup(value)}${quote}`);
  return result.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi, (_, quote, value) => `url("${lookup(value)}")`);
}

function buildPreviewDocument() {
  const csp = state.trustedHtml && state.sourceType === 'html'
    ? "default-src data: blob:; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
    : "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data: blob:; media-src data: blob:; base-uri 'none'; form-action 'none'";
  const policy = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const styles = `<style>html,body{margin:0;min-width:0;min-height:0;width:100%;height:100%;overflow:hidden;background:transparent}svg[data-motionforge-root]{width:100%;height:100%;display:block}</style>`;
  const src = resolveAssets(state.sourceCode);
  if (state.sourceType === 'svg') {
    const parsed = new DOMParser().parseFromString(src, 'image/svg+xml');
    const svg = parsed.documentElement;
    if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Invalid SVG markup.');
    svg.setAttribute('data-motionforge-root', '');
    svg.setAttribute('preserveAspectRatio', state.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
    return `<!doctype html><html><head><meta charset="utf-8">${policy}${styles}</head><body>${new XMLSerializer().serializeToString(svg)}</body></html>`;
  }
  const parsed = new DOMParser().parseFromString(src, 'text/html');
  parsed.querySelectorAll('base,meta[http-equiv="Content-Security-Policy" i]').forEach(el => el.remove());
  parsed.head.insertAdjacentHTML('afterbegin', policy + styles);
  if (!state.trustedHtml) {
    parsed.querySelectorAll('script').forEach(el => el.remove());
    parsed.querySelectorAll('*').forEach(el => [...el.attributes].forEach(attr => { if (/^on/i.test(attr.name)) el.removeAttribute(attr.name); }));
  }
  return '<!doctype html>' + parsed.documentElement.outerHTML;
}

function updatePreview() {
  let source;
  try {source=buildPreviewDocument();}catch(error){showSourceError(error);return Promise.reject(error);}
  const revision=++previewRevision;
  previewReady=false;
  const next=document.createElement('iframe');next.id='preview';next.title='Animation preview';
  next.setAttribute('sandbox',state.trustedHtml&&state.sourceType==='html'?'allow-scripts allow-same-origin':'allow-same-origin');
  // Set srcdoc before insertion, so an about:blank load cannot consume the handler.
  next.srcdoc=source;
  previewLoaded=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Preview loading timed out. Check the HTML and embedded assets.')),15000);
    next.addEventListener('load',async()=>{
      try{
        if(revision!==previewRevision){clearTimeout(timer);resolve();return;}
        const doc=next.contentDocument;if(!doc?.body)throw new Error('Preview document is unavailable.');
        if(state.sourceType==='svg'&&!doc.querySelector('svg'))throw new Error('Preview is missing its SVG root.');
        if(doc.fonts)await Promise.race([doc.fonts.ready,sleep(3000)]);
        const images=[...doc.images];
        await Promise.all(images.map(img=>img.complete?Promise.resolve():Promise.race([img.decode().catch(()=>{}),sleep(3000)])));
        layoutPreview();
        const win=doc.defaultView;
        if(state.trustedHtml&&typeof win.motionforgeSeek==='function'&&typeof win.motionforgeSetPlaying==='function')win.motionforgeSetPlaying(false);
        await setAnimationTime(state.currentTime,true);
        if(state.playing)playAnimations();
        previewReady=true;clearSourceError();setStatus('Ready','success');resolve();
      }catch(error){previewReady=false;showSourceError(error);reject(error);}finally{clearTimeout(timer);}
    },{once:true});
  });
  $('#preview').replaceWith(next);layoutPreview();updateModeChip();return previewLoaded;
}

function layoutPreview() {
  const stage = $('#stageBg');
  stage.style.aspectRatio = `${state.outWidth} / ${state.outHeight}`;
  const bounds = $('#canvasOuter').getBoundingClientRect();
  const ratio = state.outWidth / state.outHeight;
  const width = Math.max(50, Math.min(bounds.width * .86, (bounds.height - 55) * ratio));
  stage.style.width = width + 'px';
  const frame = $('#preview');
  frame.style.width = state.outWidth + 'px'; frame.style.height = state.outHeight + 'px';
  frame.style.transformOrigin = '0 0';
  frame.style.transform = `scale(${width / state.outWidth})`;
}

function updateModeChip() {
  const label = state.sourceType === 'svg' ? 'SVG · SEEKABLE ANIMATION' : (state.trustedHtml ? 'HTML · TRUSTED LIVE' : 'HTML · SAFE PREVIEW');
  $('#modeChip').textContent = label;
  $('#fileBadge').textContent = state.sourceType.toUpperCase();
}

function updateUi() {
  $('#projectName').textContent = state.sourceName;
  $('#fileName').textContent = state.sourceName;
  $('#durationInput').value = state.duration;
  $('#scrubber').max = state.duration;
  $('#totalTime').textContent = fmtTime(state.duration);
  $('#currentTime').textContent = fmtTime(state.currentTime);
  $('#scrubber').value = Math.min(state.currentTime, state.duration);
  $('#fpsSelect').value = String(state.fps);
  $('#widthInput').value = state.outWidth;
  $('#heightInput').value = state.outHeight;
  $('#bgColor').value = state.background;
  $('#bgText').value = state.background;
  $('#transparentInput').checked = state.transparent;
  $('#trustInput').checked = state.trustedHtml;
  $('#renderModeSelect').value = state.renderMode;
  $('#engineSelect').value = state.engine;
  $('#qualitySelect').value = state.quality;
  $('#rangeStart').value = state.rangeStart; $('#rangeEnd').value = state.rangeEnd;
  $('#fitSelect').value = state.fit;
  $('#assetStatus').textContent = `${Object.keys(state.assets).length} embedded asset(s) · external URLs blocked`;
  $('#audioStatus').textContent = state.audio ? `Audio: ${state.audio.name} · native MP4 only` : 'Audio muxing requires native FFmpeg.';
  $('#audioVolume').value = state.audio?.volume ?? 1;
  syncResolutionUi();
  layoutPreview();
  $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#previewFrame').style.transform = `scale(${state.zoom})`;
  $('#stageBg').style.backgroundColor = state.transparent ? 'transparent' : state.background;
  $('#stageBg').classList.toggle('checker', state.transparent);
  $('#frameEstimate').textContent = Math.ceil((state.rangeEnd - state.rangeStart) * state.fps).toLocaleString();
  const frames = state.duration * state.fps;
  const pixels = state.outWidth * state.outHeight;
  const lo = Math.max(1, Math.round(frames * pixels / (1920*1080*30) * 3));
  $('#sizeEstimate').textContent = `~ ${lo}–${Math.round(lo*3)} MB`;
  const dims = state.sourceType === 'svg' ? parseSvgSize(state.sourceCode) : {width:'HTML',height:'Canvas'};
  $('#fileDetails').textContent = state.sourceType === 'svg' ? `${dims.width} × ${dims.height} · animated` : 'HTML5 · local preview';
  renderRuler();
}

function renderRuler() {
  const ruler = $('#ruler');
  ruler.innerHTML = '';
  const marks = Math.min(12, Math.max(3, Math.ceil(state.duration)));
  for (let i=0; i<=marks; i++) {
    const s = document.createElement('span');
    s.style.left = `${(i/marks)*100}%`;
    s.textContent = `${(state.duration*i/marks).toFixed(state.duration < 5 ? 1 : 0)}s`;
    ruler.appendChild(s);
  }
}

function setZoom(z) {
  state.zoom = Math.max(.25, Math.min(2, z));
  updateUi();
}

function accessPreviewDoc() {
  const frame = $('#preview');
  try { return frame.contentDocument; } catch { return null; }
}

async function setAnimationTime(sec, pause = true) {
  const doc = accessPreviewDoc();
  if (!doc) return;
  doc.querySelectorAll('svg').forEach(svg => {
    try { if (pause) svg.pauseAnimations?.(); svg.setCurrentTime?.(sec); } catch {}
  });
  for (const animation of doc.getAnimations?.({subtree:true}) || []) {
    if (pause) animation.pause();
    try { animation.currentTime = sec * 1000; } catch {}
  }
  if (state.trustedHtml && typeof doc.defaultView.motionforgeSeek === 'function') await doc.defaultView.motionforgeSeek(sec);
}

function playAnimations() {
  const doc = accessPreviewDoc();
  if (!doc) return;
  // SMIL/CSS remain paused and are driven by the single application clock.
  doc.querySelectorAll('svg').forEach(svg => svg.pauseAnimations?.());
  for (const animation of doc.getAnimations?.({subtree:true}) || []) animation.pause();
}
function pauseAnimations() { playAnimations(); const doc=accessPreviewDoc(); if(state.trustedHtml&&typeof doc?.defaultView.motionforgeSetPlaying==='function')doc.defaultView.motionforgeSetPlaying(false); }

function tick(now) {
  const dt = Math.min(.1, (now - lastTick) / 1000); lastTick = now;
  if (state.playing && !state.exporting) {
    state.currentTime = Math.min(state.duration, state.currentTime + dt);
    setAnimationTime(state.currentTime, true).catch(err => { state.playing=false; log(errorMessage(err),'error'); });
    if (state.currentTime >= state.duration) { state.playing = false; $('#playBtn').textContent = '▶'; }
    $('#currentTime').textContent = fmtTime(state.currentTime);
    $('#scrubber').value = state.currentTime;
  }
  playRaf = requestAnimationFrame(tick);
}

async function readSourceFile(file) {
  if(!/\.(svg|html?|htm)$/i.test(file.name))throw new Error('Choose an SVG or HTML file.');
  if(file.size>25_000_000)throw new Error('Source file exceeds 25 MB.');
  await applySource(await file.text(),file.name,true);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName() {
  return state.sourceName.replace(/\.(svg|html?|mforge|json)$/i, '') || 'motionforge-export';
}

async function paintFrame() { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }

function frozenClone(node) {
  if(!node)throw new Error('No visible source element is available to capture.');
  const doc = node.ownerDocument;
  const clone = node.cloneNode(true);
  const originals = [node, ...node.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const smilAttributes = new Map();
  node.querySelectorAll('animate,animateTransform,set,animateMotion').forEach(animation => {
    const href = animation.getAttribute('href') || animation.getAttribute('xlink:href');
    const target = href?.startsWith('#') ? doc.getElementById(href.slice(1)) : animation.parentElement;
    if (!target) return;
    const attr = animation.getAttribute('attributeName') || (animation.localName === 'animateMotion' ? 'transform' : null);
    if (attr) { if (!smilAttributes.has(target)) smilAttributes.set(target, new Set()); smilAttributes.get(target).add(attr); }
  });
  for (let i=0; i<originals.length; i++) {
    const original = originals[i], copy = copies[i];
    if (!(original instanceof doc.defaultView.Element)) continue;
    if (['animate','animateTransform','animateMotion','set','script'].includes(original.localName)) continue;
    const computed = doc.defaultView.getComputedStyle(original);
    const svgProperties=['color','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','display','visibility','filter','clip-path','mask','font-family','font-size','font-weight','font-style','font-stretch','letter-spacing','word-spacing','text-anchor','dominant-baseline','alignment-baseline','paint-order','vector-effect','transform','transform-origin','transform-box','mix-blend-mode','stop-color','stop-opacity','flood-color','flood-opacity','lighting-color','cx','cy','r','rx','ry','x','y','width','height','d'];
    const properties=original.namespaceURI==='http://www.w3.org/2000/svg'?svgProperties:computed;
    for (const property of properties) {
      if (!/^(animation|transition)/.test(property)) {
        let value=computed.getPropertyValue(property);
        if(original.namespaceURI==='http://www.w3.org/2000/svg')value=value.replace(/url\(["']?[^)#]*#([^)'"\s]+)["']?\)/g,'url(#$1)');
        if(value)copy.style.setProperty(property,value,'important');
      }
    }
    copy.style.setProperty('animation', 'none', 'important');
    copy.style.setProperty('transition', 'none', 'important');
    for (const attr of smilAttributes.get(original) || []) {
      const value = original[attr]?.animVal;
      try {
        if (value && typeof value.numberOfItems === 'number' && attr === 'transform') {
          // Consolidate a copy of animated transform matrices without modifying the live SVG.
          const matrices = []; for (let j=0;j<value.numberOfItems;j++) { const m=value.getItem(j).matrix; matrices.push(`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`); }
          copy.setAttribute(attr, matrices.join(' '));
          copy.style.setProperty('transform',matrices.map(value=>value.replace(/matrix\(([^)]+)\)/,(_,numbers)=>'matrix('+numbers.trim().split(/\s+/).join(',')+')')).join(' ')||'none','important');
        } else if (typeof value === 'number' || typeof value === 'string') copy.setAttribute(attr, String(value));
        else if (value && typeof value.value === 'number') {copy.setAttribute(attr,String(value.value));if(['x','y','cx','cy','r','rx','ry','width','height'].includes(attr))copy.style.setProperty(attr,value.value+'px','important');}
        else if (value && typeof value.numberOfItems === 'number' && value.numberOfItems && value.getItem(0).value !== undefined) {
          copy.setAttribute(attr, Array.from({length:value.numberOfItems}, (_,j)=>value.getItem(j).value).join(' '));
        }
      } catch {}
    }
    if (original.localName === 'canvas') {
      const image = doc.createElement('img'); image.src = original.toDataURL(); image.style.cssText = copy.style.cssText; image.width=original.width; image.height=original.height; copy.replaceWith(image);
    }
  }
  clone.querySelectorAll('animate,animateTransform,animateMotion,set,script').forEach(el => el.remove());
  return clone;
}

async function captureFramePng() {
  const doc = accessPreviewDoc(); if (!doc || !previewReady) throw new Error('A valid preview is required before capturing a frame.');
  const canvas = document.createElement('canvas'); canvas.width=state.outWidth; canvas.height=state.outHeight;
  const ctx=canvas.getContext('2d');
  if (!state.transparent) { ctx.fillStyle=state.background; ctx.fillRect(0,0,canvas.width,canvas.height); }
  if (state.sourceType === 'svg') {
    const root=doc.querySelector('svg');if(!root)throw new Error('The preview contains no SVG root. Reapply a complete SVG document.');
    const svg=frozenClone(root);
    svg.setAttribute('width', String(state.outWidth)); svg.setAttribute('height', String(state.outHeight));
    svg.style.setProperty('width', state.outWidth+'px','important'); svg.style.setProperty('height',state.outHeight+'px','important');
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    try { const img=new Image(); img.src=url; try{await img.decode();}catch{throw new Error('SVG frame could not be decoded. Check SVG markup and embedded images/fonts.');} ctx.drawImage(img,0,0,canvas.width,canvas.height); } finally { URL.revokeObjectURL(url); }
  } else if (doc.querySelectorAll('canvas').length===1 && doc.querySelector('canvas').getAttribute('data-motionforge-capture')==='full' && [...doc.body.children].filter(el=>!['script','style'].includes(el.localName)).length===1 && doc.body.querySelector('canvas').parentElement===doc.body) {
    const sourceCanvas=doc.body.querySelector('canvas');
    ctx.drawImage(sourceCanvas,0,0,canvas.width,canvas.height);
  } else {
    const clone=frozenClone(doc.body);
    clone.style.setProperty('width', state.outWidth+'px','important'); clone.style.setProperty('height',state.outHeight+'px','important');
    const wrapper=document.createElement('div'); wrapper.style.cssText=`position:fixed;left:-${state.outWidth+100}px;top:0;width:${state.outWidth}px;height:${state.outHeight}px;pointer-events:none;`;
    wrapper.appendChild(clone); document.body.appendChild(wrapper);
    try {
      const png=await toPng(clone,{fontEmbedCSS:[...doc.querySelectorAll('style')].map(el=>el.textContent).join('\n'),pixelRatio:1,canvasWidth:state.outWidth,canvasHeight:state.outHeight,width:state.outWidth,height:state.outHeight,skipAutoScale:true});
      const img=new Image(); img.src=png; await img.decode(); ctx.drawImage(img,0,0);
    } finally { wrapper.remove(); }
  }
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob ? resolve(blob) : reject(new Error('Frame capture failed.')),'image/png'));
}

async function loadFfmpeg() {
  if (state.ffmpegReady && ffmpeg) return;
  $('#enginePill').textContent = 'Loading engine…';
  ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({progress}) => { if(state.exporting)setProgress(72+Math.max(0,Math.min(1,progress))*25,'Encoding H.264…'); });
  ffmpeg.on('log', ({ message }) => {
    if (message && /frame=|time=|error|warning/i.test(message)) $('#progressDetail').textContent = message.slice(0, 90);
  });
  const coreURL = await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript');
  const wasmURL = await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm');
  try { await ffmpeg.load({ coreURL, wasmURL }); } finally { URL.revokeObjectURL(coreURL); URL.revokeObjectURL(wasmURL); }
  state.ffmpegReady = true;
  $('#enginePill').textContent = 'FFmpeg ready';
  log('Local FFmpeg engine ready', 'success');
}

function showProgress(title) {
  $('#progressTitle').textContent = title;
  $('#progressText').textContent = 'Preparing local render…';
  $('#progressBar').style.width = '0%';
  $('#progressPct').textContent = '0%';
  $('#progressDetail').textContent = 'Initializing';
  $('#progressModal').classList.remove('hidden');
}
function hideProgress() { $('#progressModal').classList.add('hidden'); }
function setProgress(pct, text) {
  const n = Math.max(0, Math.min(100, Math.round(pct)));
  $('#progressBar').style.width = `${n}%`;
  $('#progressPct').textContent = `${n}%`;
  if (text) $('#progressDetail').textContent = text;
}

function exportSettings() {
  if(!previewReady)throw new Error('Wait for a valid preview before exporting.');
  normalizeSource(state.sourceCode);
  const start=Number(state.rangeStart), end=Number(state.rangeEnd);
  if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>state.duration||end<=start) throw new Error('Choose an export range within the project duration.');
  const frames=Math.ceil((end-start)*state.fps);
  if (state.outWidth%2 || state.outHeight%2) throw new Error('MP4 needs even width and height.');
  if (state.sourceType==='html' && state.trustedHtml && state.renderMode==='frame' && typeof accessPreviewDoc()?.defaultView.motionforgeSeek !== 'function' && /requestAnimationFrame|setInterval|setTimeout/.test(state.sourceCode)) throw new Error('This JavaScript animation needs Live capture or a window.motionforgeSeek(seconds) hook.');
  return {start,end,frames};
}
async function nativeRequest(path, options={}) {
  const response=await fetch(path,{...options,headers:{...options.headers,'X-MotionForge-Token':apiToken},signal:options.signal || renderController?.signal});
  if (!response.ok) { let message=await response.text(); try {message=JSON.parse(message).error || message;} catch {} throw new Error(message); }
  return response;
}
function checkCancel() { if (cancelled) throw new Error('Render cancelled'); }
async function startRender(title) {
  if (renderTaskActive) return false;
  renderTaskActive=true; cancelled=false; state.exporting=true; renderController=new AbortController();
  showProgress(title); setStatus('Rendering…','busy'); pauseAnimations();
  $$('.workspace input,.workspace select,.workspace button,.top-actions button').forEach(el=>{el.dataset.wasDisabled=el.disabled?'1':'0';el.disabled=true;});
  return true;
}
async function prepareRender(mode,start) {
  if (mode==='live') {
    if (start !== 0) throw new Error('Live capture starts from 0 seconds. Use a seek hook for a later start.');
    state.currentTime=0; await updatePreview();
    const doc=accessPreviewDoc();
    if(state.trustedHtml&&typeof doc.defaultView.motionforgeSetPlaying==='function')doc.defaultView.motionforgeSetPlaying(true);
    doc.querySelectorAll('svg').forEach(svg=>{svg.setCurrentTime?.(0);svg.unpauseAnimations?.();});
    for (const animation of doc.getAnimations?.({subtree:true})||[]) {animation.currentTime=0;animation.play();}
  } else { await setAnimationTime(start,true); await paintFrame(); }
}
async function captureFrames(settings, sink) {
  const mode=state.renderMode;
  await prepareRender(mode,settings.start);
  const started=performance.now(); let late=0;
  for(let i=0;i<settings.frames;i++) {
    checkCancel();
    const t=settings.start+i/state.fps;
    if(mode==='frame') {state.currentTime=t;await setAnimationTime(t,true);await paintFrame();}
    else {
      const wait=started+i*1000/state.fps-performance.now();
      if(wait>0) await sleep(wait);
      if(performance.now()-started-i*1000/state.fps > 1000/state.fps) late++;
    }
    const png=await captureFramePng(); checkCancel(); await sink(png,i);
    const remaining=Math.ceil((performance.now()-started)/(i+1)*(settings.frames-i-1)/1000);
    setProgress((i+1)/settings.frames*72,`Captured ${i+1} / ${settings.frames} · ~${remaining}s left`);
  }
  if(mode==='live'&&late) log(`Live capture missed ${late} timing deadlines. Use a seek hook or reduce resolution/FPS for accurate timing.`,'error');
}
async function finishRender(originalTime,wasPlaying) {
  pauseAnimations(); state.currentTime=originalTime; state.playing=wasPlaying;
  await setAnimationTime(originalTime,true); if(wasPlaying) playAnimations();
  state.exporting=false; renderTaskActive=false; activeJob=null; renderController=null;
  $$('.workspace input,.workspace select,.workspace button,.top-actions button').forEach(el=>{el.disabled=el.dataset.wasDisabled==='1';delete el.dataset.wasDisabled;});
  updateUi(); $('#playBtn').textContent=wasPlaying?'Ⅱ':'▶'; hideProgress();
}
async function exportMp4() {
  if(renderTaskActive) return;
  let settings;
  try { settings=exportSettings(); } catch(err) {log(errorMessage(err),'error');setStatus(errorMessage(err),'error');return;}
  const useNative=state.engine==='native'||(state.engine==='auto'&&nativeAvailable);
  if(useNative&&!nativeAvailable) {log('Native FFmpeg is unavailable. Start the local launcher and run the native-engine setup.','error');return;}
  if(!useNative&&state.audio) {log('Audio MP4 export requires native FFmpeg.','error');return;}
  if(!useNative&&settings.frames*state.outWidth*state.outHeight>MAX_BROWSER_PIXELS) {log('This render exceeds the browser memory budget. Use native FFmpeg, a shorter range or lower resolution.','error');return;}
  const originalTime=state.currentTime,wasPlaying=state.playing;
  await startRender('Rendering MP4');
  let captured=0;
  try {
    if(state.transparent) log('H.264 MP4 has no alpha channel. Transparent areas are rendered against the chosen background.');
    if(useNative) {
      const response=await nativeRequest('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:state.outWidth,height:state.outHeight,fps:state.fps,frames:settings.frames,crf:Number(state.quality),background:state.background,audioVolume:state.audio?.volume??1,audioStart:settings.start})});
      activeJob=(await response.json()).id;
      if(state.audio) await nativeRequest(`/api/jobs/${activeJob}/audio`,{method:'PUT',body:await fetchFile(state.audio.data)});
      await captureFrames(settings,async(blob,i)=>{await nativeRequest(`/api/jobs/${activeJob}/frames/${i}`,{method:'PUT',headers:{'Content-Type':'image/png'},body:blob});captured++;});
      checkCancel(); $('#progressText').textContent='Encoding with native FFmpeg…';
      await nativeRequest(`/api/jobs/${activeJob}/encode`,{method:'POST'});
      let result;
      for(;;) {
        checkCancel(); result=await(await nativeRequest(`/api/jobs/${activeJob}`)).json();
        if(result.status==='done') break;
        if(result.status==='error') throw new Error(result.error||'Encoding failed.');
        setProgress(72+Math.min(25,(result.encodedFrames||0)/settings.frames*25),`Encoding ${result.encodedFrames||0} / ${settings.frames}`);
        await sleep(300);
      }
      checkCancel();
      const blob=await(await nativeRequest(`/api/jobs/${activeJob}/output`)).blob();
      checkCancel(); downloadBlob(blob,`${baseName()}_${state.outWidth}x${state.outHeight}_${state.fps}fps.mp4`);
    } else {
      await loadFfmpeg(); checkCancel();
      await captureFrames(settings,async(blob,i)=>{await ffmpeg.writeFile(`frame${String(i).padStart(6,'0')}.png`,await fetchFile(blob));captured++;});
      $('#progressText').textContent='Encoding H.264 in browser…';
      const exit=await ffmpeg.exec(['-framerate',String(state.fps),'-i','frame%06d.png','-filter_complex',`color=c=${state.background}:s=${state.outWidth}x${state.outHeight}:r=${state.fps}[bg];[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p[v]`,'-map','[v]','-c:v','libx264','-preset','veryfast','-crf',state.quality,'-pix_fmt','yuv420p','-movflags','+faststart','output.mp4']);
      checkCancel(); if(exit!==0) throw new Error('FFmpeg encoding failed. Check the render log.');
      const data=await ffmpeg.readFile('output.mp4');
      downloadBlob(new Blob([data],{type:'video/mp4'}),`${baseName()}_${state.outWidth}x${state.outHeight}_${state.fps}fps.mp4`);
    }
    log('MP4 export completed','success');setStatus('Export complete','success');
  } catch(err) {log(cancelled?'Render cancelled':errorMessage(err),'error');setStatus(cancelled?'Render cancelled':'Export failed','error');}
  finally {
    if(activeJob) {try{await fetch(`/api/jobs/${activeJob}`,{method:'DELETE',headers:{'X-MotionForge-Token':apiToken}});}catch{}}
    if(!useNative&&ffmpeg&&state.ffmpegReady) await cleanupFrames(captured);
    await finishRender(originalTime,wasPlaying);
  }
}
async function cleanupFrames(frames) {
  if(!ffmpeg) return;
  for(let i=0;i<frames;i++) {try{await ffmpeg.deleteFile(`frame${String(i).padStart(6,'0')}.png`);}catch{}}
  try{await ffmpeg.deleteFile('output.mp4');}catch{}
}
async function exportWebm() {
  if(renderTaskActive) return;
  if(typeof MediaRecorder==='undefined') {log('WebM recording is not supported in this browser.','error');return;}
  let settings; try{settings=exportSettings();}catch(err){log(errorMessage(err),'error');return;}
  const originalTime=state.currentTime,wasPlaying=state.playing;
  await startRender('Recording WebM preview');
  let recorder,stream;
  try {
    const canvas=document.createElement('canvas');canvas.width=state.outWidth;canvas.height=state.outHeight;
    const ctx=canvas.getContext('2d'); stream=canvas.captureStream(0); const track=stream.getVideoTracks()[0];
    const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':MediaRecorder.isTypeSupported('video/webm;codecs=vp8')?'video/webm;codecs=vp8':null;
    if(!mime) throw new Error('This browser cannot encode WebM.');
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.min(40_000_000,Math.max(8_000_000,state.outWidth*state.outHeight*state.fps*.12))});
    const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(new Error(e.error?.message||'WebM recorder failed.'));});
    await prepareRender(state.renderMode,settings.start);
    // Capture the first frame before starting the wall-clock recorder.
    const draw=async()=>{const blob=await captureFramePng();const bitmap=await createImageBitmap(blob);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();};
    await draw(); recorder.start(250); track.requestFrame?.();
    const started=performance.now();let late=0;
    for(let i=1;i<settings.frames;i++) {
      checkCancel();
      if(state.renderMode==='frame') {await setAnimationTime(settings.start+i/state.fps,true);await paintFrame();}
      await draw();
      const wait=started+i*1000/state.fps-performance.now();if(wait>0)await sleep(wait);else late++;
      track.requestFrame?.();setProgress(i/settings.frames*100,`Frame ${i+1} / ${settings.frames}`);
    }
    const remaining=started+(settings.end-settings.start)*1000-performance.now();if(remaining>0)await sleep(remaining);
    recorder.stop();await stopped;checkCancel();
    downloadBlob(new Blob(chunks,{type:'video/webm'}),`${baseName()}_preview.webm`);
    log(late?`WebM exported with ${late} late frames; use MP4 frame export for exact timing.`:'WebM preview exported','success');
    if(state.audio) log('WebM preview is silent; audio is included in native MP4 only.');
    setStatus('Export complete','success');
  }catch(err){log(cancelled?'Recording cancelled':errorMessage(err),'error');setStatus('Recording stopped','error');}
  finally {if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(track=>track.stop());await finishRender(originalTime,wasPlaying);}
}
function projectData() {
  return {format:'motionforge-project',version:2,sourceType:state.sourceType,sourceName:state.sourceName,sourceCode:state.sourceCode,duration:state.duration,fps:state.fps,outWidth:state.outWidth,outHeight:state.outHeight,background:state.background,transparent:state.transparent,renderMode:state.renderMode,quality:state.quality,fit:state.fit,zoom:state.zoom,rangeStart:state.rangeStart,rangeEnd:state.rangeEnd,engine:state.engine,assets:state.assets,audio:state.audio};
}
function saveProject() {downloadBlob(new Blob([JSON.stringify(projectData(),null,2)],{type:'application/json'}),`${baseName()}.mforge`);markDirty(false);log('Project file saved','success');}
function clampNumber(value,lo,hi,fallback) {const n=Number(value);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):fallback;}
function applyProject(data) {
  if(data.format!=='motionforge-project'||![1,2].includes(data.version)||typeof data.sourceCode!=='string')throw new Error('Invalid or unsupported MotionForge project.');
  const normalized=normalizeSource(data.sourceCode);
  data={...data,sourceType:normalized.type,sourceCode:normalized.code};
  const duration=clampNumber(data.duration,.1,300,3);
  Object.assign(state,{sourceType:data.sourceType==='html'?'html':'svg',sourceName:String(data.sourceName||'project.svg'),sourceCode:data.sourceCode,duration,fps:[24,30,60].includes(Number(data.fps))?Number(data.fps):30,outWidth:Math.round(clampNumber(data.outWidth,64,7680,1920)/2)*2,outHeight:Math.round(clampNumber(data.outHeight,64,7680,1080)/2)*2,background:/^#[0-9a-f]{6}$/i.test(data.background)?data.background:'#0a0d14',transparent:!!data.transparent,renderMode:data.renderMode==='live'?'live':'frame',quality:['15','18','23'].includes(String(data.quality))?String(data.quality):'18',fit:['contain','cover'].includes(data.fit)?data.fit:'contain',zoom:clampNumber(data.zoom,.25,2,1),rangeStart:clampNumber(data.rangeStart,0,duration-.01,0),rangeEnd:clampNumber(data.rangeEnd,.01,duration,duration),engine:['auto','wasm','native'].includes(data.engine)?data.engine:'auto',assets:validateAssets(data.assets),audio:validateAudio(data.audio),currentTime:0,trustedHtml:false,playing:false});
  if(state.rangeEnd<=state.rangeStart){state.rangeStart=0;state.rangeEnd=duration;}
  $('#codeInput').value=state.sourceCode;$('#playBtn').textContent='▶';updateUi();updatePreview().catch(showSourceError);
}
function validateAssets(assets) {
  const clean=Object.create(null);for(const [key,value] of Object.entries(assets||{})){if(value&&typeof value.data==='string'&&/^data:(image\/|font\/|text\/(css|javascript)|application\/(javascript|font|x-font|octet-stream))/.test(value.data))clean[key]={data:value.data};}return clean;
}
function validateAudio(audio){return audio&&typeof audio.data==='string'&&/^data:audio\//.test(audio.data)?{name:String(audio.name||'audio'),data:audio.data,volume:clampNumber(audio.volume,0,2,1)}:null;}
async function openProject(file) {if(file.size>60_000_000)throw new Error('Project exceeds 60 MB.');applyProject(JSON.parse(await file.text()));await previewLoaded;markDirty(false);scheduleAutosave();log('Project opened · scripts disabled until trusted','success');}
async function snapshot() {
  if(renderTaskActive)return;
  const wasPlaying=state.playing;state.playing=false;
  try{await setAnimationTime(state.currentTime,true);await paintFrame();downloadBlob(await captureFramePng(),`${baseName()}_${state.currentTime.toFixed(2)}s.png`);log('PNG frame saved','success');}
  catch(err){log(errorMessage(err),'error');}
  finally{state.playing=wasPlaying;}
}
const DB_NAME='motionforge-local-v2';
async function autosaveDb() {return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('projects');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function scheduleAutosave(){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(async()=>{try{const db=await autosaveDb();const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(projectData(),'last');tx.oncomplete=()=>{db.close();if(state.dirty)$('#saveState').textContent='Autosaved · save file for a backup';};tx.onerror=()=>{db.close();log('Autosave failed. Save a .mforge backup.','error');};}catch(err){log('Autosave unavailable. Save a project file.','error');}},500);}
async function restoreAutosave(){try{const db=await autosaveDb();const request=db.transaction('projects').objectStore('projects').get('last');request.onsuccess=()=>{db.close();if(request.result){try{applyProject(request.result);}catch(error){showSourceError(new Error('Previous autosave could not be restored: '+errorMessage(error)));return;}state.dirty=true;$('#saveState').textContent='Recovered autosave';log('Previous workspace recovered','success');}};}catch{}}
function syncResolutionUi(){const w=state.outWidth,h=state.outHeight;const aspect=w===h?'square':Math.abs(w/h-16/9)<.01?'landscape':Math.abs(w/h-9/16)<.01?'portrait':'custom';$('#aspectSelect').value=aspect;const short=Math.min(w,h);const presets={720:'1280x720',1080:'1920x1080',1440:'2560x1440',2160:'3840x2160'};$('#resolutionSelect').value=aspect==='square'||aspect==='custom'?'custom':presets[short]||'custom';$('#customRes').classList.toggle('visible',$('#resolutionSelect').value==='custom');}
function chooseResolution(value,aspect){if(value==='custom')return;const [w,h]=value.split('x').map(Number);state.outWidth=aspect==='portrait'?h:aspect==='square'?h:w;state.outHeight=aspect==='portrait'?w:h;}
async function detectNative(){try{const response=await fetch('/api/diagnostics');if(!response.ok)return;const data=await response.json();apiToken=data.token;nativeAvailable=!!data.nativeAvailable;$('#enginePill').textContent=nativeAvailable?'Native FFmpeg ready':'Browser engine';log(nativeAvailable?'Native FFmpeg available · frames streamed to local disk':'Native FFmpeg not found · browser exporter available');}catch{}}

function diagnostics() {
  const doc = accessPreviewDoc();
  const svg = doc?.querySelector('svg');
  const canvases = doc?.querySelectorAll('canvas').length || 0;
  const animations = doc?.getAnimations?.({subtree:true}).length || 0;
  const external=(state.sourceCode.match(/(?:src|href)\s*=\s*["']https?:|url\(["']?https?:/gi)||[]).length;
  if(external)log(`${external} external resource reference(s) found; import local copies to embed them.`,'error');
  const msg = state.sourceType === 'svg'
    ? `SVG ready · ${animations} CSS/Web animations · SMIL ${svg?.setCurrentTime ? 'seekable' : 'basic'}`
    : `HTML ready · ${canvases} canvas element(s) · ${state.trustedHtml ? 'scripts enabled' : 'scripts disabled'}`;
  log(msg, 'success'); setStatus(msg, 'success');
}

function bind() {
  $$('.tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('active')); btn.classList.add('active');
    $$('.tab-page').forEach(p => p.classList.toggle('active', p.dataset.page === btn.dataset.tab));
    if (btn.dataset.tab === 'code') $('#codeInput').value = state.sourceCode;
  }));

  $('#fileInput').addEventListener('change', async e => {try{if(e.target.files[0])await readSourceFile(e.target.files[0]);}catch(err){showSourceError(err);}e.target.value='';});
  const dz = $('#dropzone');
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', async e => {try{if(e.dataTransfer.files[0])await readSourceFile(e.dataTransfer.files[0]);}catch(err){log(errorMessage(err),'error');}});

  $('#applyCodeBtn').addEventListener('click',async()=>{
    const button=$('#applyCodeBtn');button.disabled=true;button.textContent='Checking source…';
    try{await applySource($('#codeInput').value);}catch(error){showSourceError(error);}
    finally{button.disabled=false;button.textContent='Apply to preview';}
  });
  $('#reloadBtn').addEventListener('click',()=>updatePreview().catch(()=>{}));

  $('#durationInput').addEventListener('change', e => { state.duration = clampNumber(e.target.value,.1,300,3); state.rangeEnd=state.duration; state.currentTime=Math.min(state.currentTime,state.duration); markDirty(); updateUi(); });
  $('#fpsSelect').addEventListener('change', e => { state.fps = Number(e.target.value); markDirty(); updateUi(); });
  $('#resolutionSelect').addEventListener('change', e => {
    chooseResolution(e.target.value,$('#aspectSelect').value);
    $('#customRes').classList.toggle('visible', e.target.value === 'custom'); markDirty(); updateUi();
  });
  $('#widthInput').addEventListener('change', e => { state.outWidth=Math.round(clampNumber(e.target.value,64,7680,1920)/2)*2; markDirty(); updateUi(); });
  $('#heightInput').addEventListener('change', e => { state.outHeight=Math.round(clampNumber(e.target.value,64,7680,1080)/2)*2; markDirty(); updateUi(); });
  $('#bgColor').addEventListener('input', e => { state.background=e.target.value; $('#bgText').value=e.target.value; markDirty(); updateUi(); });
  $('#bgText').addEventListener('change', e => { if(/^#[0-9a-f]{6}$/i.test(e.target.value)){state.background=e.target.value;markDirty();updateUi();} });
  $('#transparentInput').addEventListener('change', e => {state.transparent=e.target.checked;markDirty();updateUi();});
  $('#trustInput').addEventListener('change', e => { state.trustedHtml=e.target.checked; markDirty(); updatePreview().catch(()=>{}); updateUi(); });
  $('#renderModeSelect').addEventListener('change', e => { state.renderMode=e.target.value; markDirty(); updateUi(); });

  $('#playBtn').addEventListener('click', () => {
    state.playing = !state.playing; $('#playBtn').textContent = state.playing ? 'Ⅱ' : '▶';
    if (state.playing && state.currentTime>=state.duration) state.currentTime=0;
    if (state.playing) {playAnimations();const doc=accessPreviewDoc();if(state.trustedHtml&&typeof doc?.defaultView.motionforgeSetPlaying==='function')doc.defaultView.motionforgeSetPlaying(typeof doc.defaultView.motionforgeSeek!=='function');} else pauseAnimations();
  });
  $('#restartBtn').addEventListener('click', () => { state.currentTime=0; setAnimationTime(0,!state.playing); updateUi(); });
  $('#endBtn').addEventListener('click', () => { state.currentTime=state.duration; setAnimationTime(state.duration,true); pauseAnimations(); state.playing=false; $('#playBtn').textContent='▶'; updateUi(); });
  $('#scrubber').addEventListener('input', e => { state.currentTime=Number(e.target.value); state.playing=false; pauseAnimations(); $('#playBtn').textContent='▶'; setAnimationTime(state.currentTime,true); updateUi(); });

  $('#zoomInBtn').addEventListener('click',()=>setZoom(state.zoom+.1));
  $('#zoomOutBtn').addEventListener('click',()=>setZoom(state.zoom-.1));
  $('#zoomValue').addEventListener('click',()=>setZoom(1));
  $('#resetViewBtn').addEventListener('click',()=>setZoom(1));
  $('#fitSelect').addEventListener('change', e => { state.fit=e.target.value; markDirty(); updatePreview().catch(()=>{}); });
  $('#fullscreenBtn').addEventListener('click',()=> $('#canvasOuter').requestFullscreen?.());

  $('#snapshotBtn').addEventListener('click', snapshot);
  $('#copyCodeBtn').addEventListener('click', async()=>{ await navigator.clipboard.writeText(state.sourceCode); log('Source copied to clipboard','success'); });
  $('#diagnoseBtn').addEventListener('click', diagnostics);
  $('#clearLogBtn').addEventListener('click',()=> $('#log').innerHTML='<div class="log-empty">No renders yet.</div>');

  $('#saveProjectBtn').addEventListener('click', saveProject);
  $('#openProjectBtn').addEventListener('click',()=>$('#projectInput').click());
  $('#projectInput').addEventListener('change', async e => { try { if(e.target.files[0]) await openProject(e.target.files[0]); } catch(err){ log(errorMessage(err),'error'); } e.target.value=''; });
  $('#newBtn').addEventListener('click',()=>{if(state.dirty&&!confirm('Start a new project? Save a .mforge file first if you need the current project.'))return;Object.assign(state,{sourceType:'svg',sourceName:'untitled.svg',sourceCode:demoSvg,duration:5,rangeStart:0,rangeEnd:5,currentTime:0,trustedHtml:false,assets:{},audio:null,playing:true});$('#codeInput').value=demoSvg;updatePreview().catch(()=>{});updateUi();markDirty();});

  $('#exportBtn').addEventListener('click', exportMp4); $('#exportBigBtn').addEventListener('click', exportMp4);
  $('#exportWebmBtn').addEventListener('click', exportWebm);
  $('#cancelExportBtn').addEventListener('click',()=>{cancelled=true;renderController?.abort();if(ffmpeg&&state.ffmpegReady&&!activeJob){ffmpeg.terminate();state.ffmpegReady=false;ffmpeg=null;$('#enginePill').textContent='Engine stopped';}if(activeJob)fetch(`/api/jobs/${activeJob}`,{method:'DELETE',headers:{'X-MotionForge-Token':apiToken}}).catch(()=>{});$('#progressText').textContent='Cancelling…';});

  window.addEventListener('beforeunload', e => { if(state.dirty){ e.preventDefault(); e.returnValue=''; } });
}

function readDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
function installTemplate(source,name,duration){normalizeSource(source);state.sourceType='svg';state.sourceCode=source;state.sourceName=name;state.duration=duration;state.rangeStart=0;state.rangeEnd=duration;state.currentTime=0;state.playing=true;state.trustedHtml=false;state.assets={};state.audio=null;$('#codeInput').value=source;markDirty();updateUi();updatePreview().catch(()=>{});$('#playBtn').textContent='Ⅱ';}
function birthdaySvg({year,month,day,title,duration,hold,aspect,accent,background}) {
  const width=aspect==='portrait'?2160:aspect==='square'?2160:3840, height=aspect==='portrait'?3840:2160;
  const cx=width/2, cy=height*.51;
  const row=aspect==='portrait'?240:190, font=aspect==='portrait'?115:100;
  const columns=aspect==='portrait'?[cx-650,cx,cx+650]:[cx-950,cx,cx+950];
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const lists=[Array.from({length:31},(_,i)=>String(i+1).padStart(2,'0')),months,Array.from({length:21},(_,i)=>String(year-10+i))];
  const targets=[day-1,month-1,10];
  let content='';
  for(let col=0;col<3;col++){
    const list=lists[col], steps=list.length*2+targets[col];
    const start=cy, end=cy-steps*row;
    content+=`<g clip-path="url(#window)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="0 ${end-start}" dur="${duration}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.10 0.80 0.14 1"/>`;
    for(let i=0;i<=steps+3;i++)content+=`<text x="${columns[col]}" y="${cy+i*row}" text-anchor="middle" dominant-baseline="central" font-size="${col===1?font:font*1.03}" fill="#f0f6ff">${list[i%list.length]}</text>`;
    content+='</g></g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="window"><rect x="${width*.03}" y="${cy-row*2.3}" width="${width*.94}" height="${row*4.6}"/></clipPath><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${background}"/><stop offset=".35" stop-color="${background}" stop-opacity=".72"/><stop offset=".47" stop-color="${background}" stop-opacity="0"/><stop offset=".53" stop-color="${background}" stop-opacity="0"/><stop offset=".65" stop-color="${background}" stop-opacity=".72"/><stop offset="1" stop-color="${background}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="${background}"/><g font-family="Arial, sans-serif" font-weight="600"><text x="${cx}" y="${height*.21}" text-anchor="middle" font-size="${font*.48}" letter-spacing="12" fill="${accent}">${escapeHtml(title)}</text><text x="${cx}" y="${height*.27}" text-anchor="middle" font-size="${font*.25}" letter-spacing="7" fill="#8794a8">A DATE WORTH CELEBRATING</text><rect x="${width*.05}" y="${cy-row*.5}" width="${width*.9}" height="${row}" rx="28" fill="${accent}" fill-opacity=".08" stroke="${accent}" stroke-opacity=".5" stroke-width="3"/>${content}<rect x="${width*.03}" y="${cy-row*2.3}" width="${width*.94}" height="${row*4.6}" fill="url(#fade)"/><path d="M ${width*.015} ${cy-25} L ${width*.03} ${cy} L ${width*.015} ${cy+25}" fill="none" stroke="${accent}" stroke-width="9" stroke-linecap="round"/><text x="${cx}" y="${height*.77}" text-anchor="middle" font-size="${font*.28}" fill="${accent}" opacity="0">${String(day).padStart(2,'0')} · ${months[month-1]} · ${year}<animate attributeName="opacity" from="0" to="1" begin="${duration}s" dur=".6s" fill="freeze"/></text></g></svg>`;
}
function bindUpgrades(){
  $('#loadExampleBtn').addEventListener('click',async()=>{try{const example=studioExamples()[$('#exampleSelect').value];await applySource(example.code,example.name,true);state.duration=example.duration;state.rangeEnd=example.duration;updateUi();markDirty();}catch(error){showSourceError(error);}});
  $('#downloadSourceBtn').addEventListener('click',()=>downloadBlob(new Blob([state.sourceCode],{type:state.sourceType==='svg'?'image/svg+xml':'text/html'}),`${baseName()}.${state.sourceType}`));
  $('#aspectSelect').addEventListener('change',e=>{const preset=$('#resolutionSelect').value==='custom'?'1920x1080':$('#resolutionSelect').value;if(e.target.value!=='custom')chooseResolution(preset,e.target.value);markDirty();updateUi();});
  $('#qualitySelect').addEventListener('change',e=>{state.quality=e.target.value;markDirty();});
  $('#engineSelect').addEventListener('change',e=>{state.engine=e.target.value;markDirty();});
  ['rangeStart','rangeEnd'].forEach(id=>$('#'+id).addEventListener('change',e=>{state[id]=clampNumber(e.target.value,0,state.duration,id==='rangeEnd'?state.duration:0);markDirty();updateUi();}));
  $('#assetInput').addEventListener('change',async e=>{try{for(const file of e.target.files){if(file.size>10_000_000)throw new Error('Each asset must be under 10 MB.');if(!/\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf|js|css)$/i.test(file.name))throw new Error('Unsupported asset type.');let data=await readDataUrl(file);if(/\.(woff2?|ttf|otf)$/i.test(file.name))data=data.replace(/^data:[^;]*;/,`data:font/${file.name.split('.').pop()};`);if(/\.js$/i.test(file.name))data=data.replace(/^data:[^;]*;/,'data:text/javascript;');if(/\.css$/i.test(file.name))data=data.replace(/^data:[^;]*;/,'data:text/css;');state.assets[file.name]={data};}markDirty();updateUi();await updatePreview();log('Assets embedded','success');}catch(err){log(errorMessage(err),'error');}e.target.value='';});
  $('#audioInput').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('audio/')||file.size>20_000_000)throw new Error('Choose an audio file under 20 MB.');state.audio={name:file.name,data:await readDataUrl(file),volume:1};markDirty();updateUi();}catch(err){log(errorMessage(err),'error');}e.target.value='';});
  $('#removeAudioBtn').addEventListener('click',()=>{state.audio=null;markDirty();updateUi();});
  $('#audioVolume').addEventListener('change',e=>{if(state.audio){state.audio.volume=clampNumber(e.target.value,0,2,1);markDirty();}});
  $('#spinGeneratorBtn').addEventListener('click',()=>$('#spinModal').classList.remove('hidden'));
  $('#closeSpinBtn').addEventListener('click',()=>$('#spinModal').classList.add('hidden'));
  $('#createSpinBtn').addEventListener('click',()=>{
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec($('#birthdayInput').value);if(!match){log('Choose a valid birthday.','error');return;}
    const [year,month,day]=match.slice(1).map(Number),date=new Date(year,month-1,day);if(year<1900||year>2100||date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day){log('Choose a date between 1900 and 2100.','error');return;}
    const duration=clampNumber($('#spinDuration').value,2,20,6),hold=clampNumber($('#spinHold').value,.5,15,3),aspect=$('#spinAspect').value;
    state.outWidth=aspect==='portrait'||aspect==='square'?2160:3840;state.outHeight=aspect==='portrait'?3840:2160;state.background=$('#spinBackground').value;
    installTemplate(birthdaySvg({year,month,day,title:$('#birthdayTitle').value,duration,hold,aspect,accent:$('#spinAccent').value,background:state.background}),'birthday-date-spin.svg',duration+hold);
    $('#spinModal').classList.add('hidden');log('Birthday spin created · exact final date + hold','success');
  });
  $('#counterTemplateBtn').addEventListener('click',()=>{let texts='';for(let i=5;i>=1;i--)texts+=`<text x="960" y="600" text-anchor="middle" font-size="300" fill="#65e2bf" opacity="0">${i}<set attributeName="opacity" to="1" begin="${5-i}s" dur="1s"/></text>`;installTemplate(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#080b12"/><g font-family="Arial">${texts}<text x="960" y="590" text-anchor="middle" font-size="220" fill="#fff" opacity="0">LET'S GO<set attributeName="opacity" to="1" begin="5s" fill="freeze"/></text></g></svg>`,'countdown.svg',7);});
  $('#revealTemplateBtn').addEventListener('click',()=>installTemplate(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#080b12"/><g opacity="0"><animate attributeName="opacity" from="0" to="1" dur="2s" fill="freeze"/><animateTransform attributeName="transform" type="translate" from="0 80" to="0 0" dur="2s" fill="freeze"/><text x="960" y="550" text-anchor="middle" fill="#65e2bf" font-family="Arial" font-size="150">YOUR TITLE</text></g></svg>`,'text-reveal.svg',5));
  window.addEventListener('unhandledrejection',event=>{log(errorMessage(event.reason),'error');});
}

$('#codeInput').value = demoSvg;
bind(); bindUpgrades(); updatePreview().catch(()=>{}); updateUi(); detectNative(); restoreAutosave();
new ResizeObserver(layoutPreview).observe($('#canvasOuter'));
lastTick = performance.now(); playRaf = requestAnimationFrame(tick);
