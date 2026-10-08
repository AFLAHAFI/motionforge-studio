const fs=require('node:fs'),assert=require('node:assert/strict');
let JSDOM;try{({JSDOM}=require('jsdom'));}catch{({JSDOM}=require('../../qa_runtime/node_modules/jsdom'));}
const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost:4173',runScripts:'outside-only'});
let source=fs.readFileSync('src/main.js','utf8').replace(/^import .*;\n/gm,'');source=source.slice(0,source.indexOf("\n$('#codeInput').value = demoSvg;\nbind();"));
dom.window.eval(source+'\nwindow.api={state,normalizeSource,applySource,errorMessage,studioExamples,buildPreviewDocument,validateAssets};');
const api=dom.window.api;let count=0;
function check(name,run){run();count++;console.log('PASS',name);}
(async()=>{
check('SVG fragments from the reported recording are rejected',()=>{for(const fragment of ['<rect x="0" width="10"/>','<clipPath id="x"><rect/></clipPath>','<g><text>Chart</text></g>'])assert.throws(()=>api.normalizeSource(fragment),/incomplete SVG fragment/);});
check('BOM, long XML comments and a single Markdown code fence are normalized',()=>{const wrapped='```svg\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>\n```';assert.equal(api.normalizeSource(wrapped).type,'svg');assert.equal(api.normalizeSource('\uFEFF<!--'+'x'.repeat(2000)+'--><svg xmlns="http://www.w3.org/2000/svg"/>').type,'svg');});
check('Missing namespace is repaired and broken XML is rejected',()=>{assert.ok(api.normalizeSource('<svg><rect width="10"/></svg>').code.includes('xmlns="http://www.w3.org/2000/svg"'));assert.throws(()=>api.normalizeSource('<svg><g></svg>'),/Invalid SVG/);});
check('HTML containing SVG stays HTML and plain text is rejected',()=>{assert.equal(api.normalizeSource('<html><body><svg><circle r="10"/></svg></body></html>').type,'html');assert.throws(()=>api.normalizeSource('Create an animated graph'),/Expected/);});
check('All five general animation examples parse correctly',()=>{const examples=api.studioExamples();assert.equal(Object.keys(examples).length,5);for(const [key,value] of Object.entries(examples)){assert.equal(api.normalizeSource(value.code).type,['css','canvas'].includes(key)?'html':'svg');assert.equal(value.duration,5);}});
check('Image errors produce a useful message instead of undefined',()=>{assert.match(api.errorMessage({type:'error'}),/Image capture failed/);assert.notEqual(api.errorMessage(undefined),'undefined');assert.equal(api.errorMessage({message:'Meaningful detail'}),'Meaningful detail');});
check('Local JS and CSS assets survive project validation',()=>{const clean=api.validateAssets({'chart.js':{data:'data:text/javascript;base64,AA=='},'styles.css':{data:'data:text/css;base64,AA=='}});assert.equal(Object.keys(clean).length,2);});
const previous=api.state.sourceCode;
await assert.rejects(api.applySource('<rect/>'),/incomplete SVG/);
assert.equal(api.state.sourceCode,previous);console.log('PASS Rejected import preserves the previous project');count++;
console.log(`${count} import regression groups passed.`);dom.window.close();
})().catch(error=>{console.error(error);dom.window.close();process.exitCode=1;});
