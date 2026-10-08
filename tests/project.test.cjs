// Run from project root after npm install --no-save jsdom (development only).
const fs=require('node:fs');
const assert=require('node:assert/strict');
let JSDOM;
try {({JSDOM}=require('jsdom'));} catch {({JSDOM}=require('../../qa_runtime/node_modules/jsdom'));}
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://localhost:4173',runScripts:'outside-only'});
dom.window.requestAnimationFrame=()=>0;
let source=fs.readFileSync('src/main.js','utf8').replace(/^import .*;\n/gm,'');
source=source.slice(0,source.indexOf("\n$('#codeInput').value = demoSvg;\nbind();"));
dom.window.eval(source+`\nwindow.testApi={state,birthdaySvg,buildPreviewDocument,applyProject,projectData,inferDuration,chooseResolution,parseSvgSize,setAnimationTime};`);
const api=dom.window.testApi;
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS',name);}
check('SVG duration includes begin delays and finite repeats',()=>{assert.equal(api.inferDuration('<svg><animate dur="2s" begin="3s" repeatCount="2"/></svg>','svg'),7);assert.equal(api.inferDuration('<svg><animate dur="500ms"/></svg>','svg'),.5);});
check('Birthday reels contain correct final day/month/year with frozen end',()=>{
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  for(let month=1;month<=12;month++){
    const day=month===2?28:15,year=2008;
    const svg=api.birthdaySvg({year,month,day,title:'A & B',duration:6,hold:3,aspect:'portrait',accent:'#65e2bf',background:'#080b12'});
    const doc=new dom.window.DOMParser().parseFromString(svg,'image/svg+xml');assert.equal(doc.querySelector('parsererror'),null);
    assert.equal(doc.documentElement.getAttribute('viewBox'),'0 0 2160 3840');
    const groups=[...doc.querySelectorAll('g[clip-path] > g')];assert.equal(groups.length,3);
    const steps=[31*2+day-1,12*2+month-1,21*2+10];
    const expected=[String(day).padStart(2,'0'),months[month-1],String(year)];
    groups.forEach((g,i)=>{assert.equal(g.querySelectorAll('text')[steps[i]].textContent,expected[i]);assert.equal(g.querySelector('animateTransform').getAttribute('fill'),'freeze');assert.equal(g.querySelector('animateTransform').getAttribute('to'),`0 ${-steps[i]*240}`);});
    assert.ok(svg.includes('A &amp; B'));
  }
});
check('Safe HTML removes scripts and inline handlers and blocks network',()=>{Object.assign(api.state,{sourceType:'html',trustedHtml:false,sourceCode:'<html><head><base href="https://bad.example/"></head><body onload="alert(1)"><script>alert(1)</script><img src="https://bad.example/x"></body></html>'});const doc=new dom.window.DOMParser().parseFromString(api.buildPreviewDocument(),'text/html');assert.equal(doc.querySelector('script'),null);assert.equal(doc.querySelector('base'),null);assert.equal(doc.body.hasAttribute('onload'),false);assert.ok(doc.querySelector('meta[http-equiv]').content.includes("default-src 'none'"));});
check('Embedded assets replace relative image references',()=>{api.state.sourceCode='<html><body><img src="images/photo.png"></body></html>';api.state.assets={'photo.png':{data:'data:image/png;base64,AA=='}};assert.ok(api.buildPreviewDocument().includes('data:image/png;base64,AA=='));});
check('SVG parser rejects invalid SVG',()=>{api.state.sourceType='svg';api.state.sourceCode='<svg><bad></svg>';assert.throws(()=>api.buildPreviewDocument(),/Invalid SVG/);});
check('Portrait and square presets preserve intended proportions',()=>{api.chooseResolution('3840x2160','portrait');assert.equal(api.state.outWidth,2160);assert.equal(api.state.outHeight,3840);api.chooseResolution('1920x1080','square');assert.equal(api.state.outWidth,1080);assert.equal(api.state.outHeight,1080);});
check('Project restores quality, assets, range and even dimensions with trust disabled',()=>{
  // JSDOM does not load srcdoc; a rejected invalid preview avoids asynchronous browser-only work.
  api.applyProject({format:'motionforge-project',version:2,sourceType:'svg',sourceCode:'<svg xmlns="http://www.w3.org/2000/svg"/>',sourceName:'test.svg',duration:9,fps:60,outWidth:721,outHeight:1281,quality:'15',rangeStart:6,rangeEnd:9,fit:'cover',zoom:1.5,assets:{'photo.png':{data:'data:image/png;base64,AA=='}},trustedHtml:true});
  assert.equal(api.state.quality,'15');assert.equal(api.state.trustedHtml,false);assert.equal(api.state.outWidth%2,0);assert.equal(api.state.rangeStart,6);assert.equal(api.state.rangeEnd,9);assert.equal(api.state.fit,'cover');assert.equal(api.projectData().assets['photo.png'].data,'data:image/png;base64,AA==');
});
check('Legacy v1 project remains readable',()=>{api.applyProject({format:'motionforge-project',version:1,sourceType:'svg',sourceCode:'<svg xmlns="http://www.w3.org/2000/svg"/>',duration:3});assert.equal(api.state.rangeEnd,3);assert.equal(api.state.quality,'18');});
check('Timeline seeking pauses SMIL and CSS and applies the exact timestamp',()=>{
  dom.window.eval(`
    window.seekObservation={smilPaused:false,cssPaused:false,seconds:-1,milliseconds:-1};
    accessPreviewDoc=()=>({querySelectorAll:()=>[{pauseAnimations:()=>window.seekObservation.smilPaused=true,setCurrentTime:value=>window.seekObservation.seconds=value}],getAnimations:()=>[{pause:()=>window.seekObservation.cssPaused=true,set currentTime(value){window.seekObservation.milliseconds=value;}}],defaultView:{}});
    window.testApi.state.trustedHtml=false;
  `);
  api.setAnimationTime(2.25,true);
  const observed=dom.window.seekObservation;
  assert.equal(observed.smilPaused,true);assert.equal(observed.cssPaused,true);assert.equal(observed.seconds,2.25);assert.equal(observed.milliseconds,2250);
});
console.log(`${checks} checks passed.`);dom.window.close();
