import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'output', 'browser');
await mkdir(out, { recursive: true });
const executablePath = process.env.ASIDE_CHROMIUM_PATH || undefined;
const checks = [];
let contexts = [];
const errors = [];
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const q = body.q || body.messages?.find(m=>m.role==='user')?.content || body.contents?.[0]?.parts?.[0]?.text;
    assert.equal(typeof q,'string','One source string per translation request');
    if (q.includes('slow')) await new Promise(resolve => setTimeout(resolve, 1600));
    res.setHeader('Content-Type', 'application/json');
    const text='中文：'+q;
    const response=req.url==='/openai'?{choices:[{finish_reason:'stop',message:{content:text}}]}:req.url==='/anthropic'?{content:[{type:'text',text}],stop_reason:'end_turn'}:req.url.startsWith('/gemini/')?{candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]}:{translatedText:text};
    res.end(JSON.stringify(response));
  } else {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if (req.url === '/frame') { res.end('<!doctype html><html><body><p id="frame-text">A paragraph inside another frame.</p></body></html>'); return; }
    res.end('<!doctype html><html><body><h1>Hello world.</h1><p id="paragraph">A useful paragraph.</p><code>Do not translate code.</code><input value="Do not translate input."><div id="dynamic"></div></body></html>');
  }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/translate`;
async function launch(extension, label) {
  const profile = await mkdtemp(join(out, `${label}-profile-`));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath,
    headless: true, viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'] });
  context.setDefaultTimeout(10000);
  contexts.push(context);
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  return {context, worker, id};
}
async function configure(worker, patch) { await worker.evaluate(patch => chrome.storage.local.set(patch), patch); }
async function message(worker, page, type) {
  return worker.evaluate(async ({url,type}) => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    return chrome.tabs.sendMessage(tab.id,{type});
  },{url:page.url(),type});
}
try {
  // Load the exact shipping manifest first: no test permission is added here.
  const shipping = await launch(join(root,'dist'),'shipping');
  const permissions = await shipping.worker.evaluate(() => chrome.permissions.getAll());
  assert.deepEqual(permissions.permissions.sort(),['activeTab','scripting','storage'].sort());
  assert.ok(permissions.origins.includes('http://*/*') && permissions.origins.includes('https://*/*'));
  checks.push('Exact shipping MV3 installs website access once; core actions require no runtime permission request.');
  const popup = await shipping.context.newPage();
  await popup.goto(`chrome-extension://${shipping.id}/popup/index.html`);
  await popup.locator('#page-status').filter({hasText:'普通网页'}).waitFor();
  assert.equal(await popup.locator('#translate').isDisabled(),true);
  assert.equal(await popup.locator('#auto-translate').isChecked(),false);
  assert.equal(await popup.locator('#youtube-enabled').isChecked(),true);
  assert.equal(await popup.locator('#selection-enabled').isChecked(),true);
  assert.equal(await popup.locator('#service-details').getAttribute('open'),null);
  await popup.setViewportSize({width:360,height:640});
  await popup.screenshot({path:join(out,'popup-shipping.png')});
  await popup.locator('#service-details').click();
  await popup.locator('#service').selectOption('libre');
  await popup.locator('#endpoint').fill('http://remote.example/translate');
  await popup.locator('#save-service').click();
  await popup.locator('#settings-status').filter({hasText:'HTTPS'}).waitFor();
  checks.push('Shipping popup: Chinese defaults, page/selection/subtitle preferences, folded service settings, restricted page and invalid URL feedback.');
  for(const protocol of ['openai','anthropic','gemini']) {
    await popup.locator('#service').selectOption(protocol);
    assert.equal(await popup.locator('#model').isVisible(),true);
    assert.ok((await popup.locator('#endpoint').inputValue()).startsWith('https://'));
  }
  assert.ok(await popup.locator('#provider option').count()>=2);
  checks.push('AI configuration stays folded by default; protocol presets populate their provider fields.');
  await shipping.context.close(); contexts=[];

  // Functional checks use the exact shipping manifest and bundles unchanged.
  const {context,worker,id} = await launch(join(root,'dist'),'controlled');
  await configure(worker,{service:'libre',endpoint,apiKey:'',autoTranslate:false,youtubeEnabled:true});
  const page = await context.newPage();
  await page.goto(endpoint.replace('/translate','/article'));
  await worker.evaluate(async url => {
    const tab=(await chrome.tabs.query({})).find(t=>t.url===url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/index.js']});
  },page.url());
  await message(worker,page,'PAGE_TOGGLE');
  await page.locator('h1').filter({hasText:'中文：Hello world.'}).waitFor();
  await page.locator('#paragraph').filter({hasText:'中文：A useful paragraph.'}).waitFor();
  assert.equal(await page.locator('code').textContent(),'Do not translate code.');
  assert.equal(await page.locator('input').inputValue(),'Do not translate input.');
  await page.evaluate(()=>{document.querySelector('#dynamic').textContent='New dynamic text.';});
  await page.locator('#dynamic').filter({hasText:'中文：New dynamic text.'}).waitFor();
  await configure(worker,{youtubeEnabled:false});
  assert.equal((await message(worker,page,'PAGE_STATUS')).translated,true);
  await configure(worker,{selectionEnabled:false});
  assert.equal((await message(worker,page,'PAGE_STATUS')).translated,true,'Selection preferences preserve manual webpage translation');
  await configure(worker,{selectionEnabled:true});
  await page.screenshot({path:join(out,'page-translated.png')});
  await message(worker,page,'PAGE_TOGGLE');
  assert.equal(await page.locator('h1').textContent(),'Hello world.');
  assert.equal(await page.locator('#dynamic').textContent(),'New dynamic text.');
  checks.push('Actual bundled page translator: translate/restore, dynamic text, input/code exclusion, subtitle setting isolation.');

  const frameUrl = endpoint.replace('127.0.0.1','localhost').replace('/translate','/frame');
  await page.evaluate(url => { const frame=document.createElement('iframe');frame.src=url;frame.id='cross-frame';document.body.append(frame); },frameUrl);
  await page.frameLocator('#cross-frame').locator('#frame-text').waitFor();
  await page.locator('#aside-floating').getByRole('button',{name:'翻译此页',exact:true}).click();
  await page.frameLocator('#cross-frame').locator('[data-aside-translation]').filter({hasText:'中文：A paragraph inside another frame.'}).waitFor();
  await page.locator('#paragraph [data-aside-translation]').waitFor();
  assert.equal(await page.frameLocator('#cross-frame').locator('#aside-floating').count(),0,'Only the top frame owns floating controls');
  await page.evaluate(() => { const frame=document.createElement('iframe');frame.id='srcdoc-frame';frame.srcdoc='<p id="inherited-text">An inherited-origin paragraph.</p>';document.body.append(frame); });
  await page.frameLocator('#srcdoc-frame').locator('#inherited-text').waitFor();
  await page.waitForTimeout(250);
  await page.locator('#aside-floating').getByRole('button',{name:'恢复原文',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-aside-translation]'));
  assert.equal(await page.frameLocator('#cross-frame').locator('[data-aside-translation]').count(),0);
  assert.equal(await page.frameLocator('#srcdoc-frame').locator('[data-aside-translation]').count(),0,'A new untranslated frame must not toggle on while its parent restores');
  await page.locator('#aside-floating').getByRole('button',{name:'翻译此页',exact:true}).click();
  await page.frameLocator('#srcdoc-frame').locator('[data-aside-translation]').filter({hasText:'中文：An inherited-origin paragraph.'}).waitFor();
  await page.locator('#aside-floating').getByRole('button',{name:'恢复原文',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-aside-translation]'));
  checks.push('Shipping floating control sets all frames consistently: a different origin, inherited about:srcdoc, and a newly inserted untranslated frame, with one top-frame entry.');

  await configure(worker,{autoTranslate:true});
  assert.equal((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length,0,'Static page scripts replace legacy optional registration');
  const automatic=await context.newPage();
  await automatic.goto(endpoint.replace('/translate','/automatic'));
  await automatic.locator('h1').filter({hasText:'中文：Hello world.'}).waitFor();
  await configure(worker,{autoTranslate:false,youtubeEnabled:true});
  await automatic.locator('h1').filter({hasText:/^Hello world\.$/}).waitFor();
  checks.push('Exact shipping package auto-translates new tabs and restores connected pages without permission dialogs.');

  let settingsPopup=await context.newPage();
  await settingsPopup.goto(`chrome-extension://${id}/popup/index.html`);
  await settingsPopup.locator('#service-details').click();
  await settingsPopup.locator('#service').selectOption('deepseek');
  assert.equal(await settingsPopup.locator('#model').inputValue(),'deepseek-flash');
  await settingsPopup.locator('#api-key').fill('fixture-unfinished-draft');
  await settingsPopup.close();
  settingsPopup=await context.newPage();
  await settingsPopup.goto(`chrome-extension://${id}/popup/index.html`);
  await settingsPopup.locator('#service-details').click();
  assert.equal(await settingsPopup.locator('#service').inputValue(),'deepseek');
  assert.equal(await settingsPopup.locator('#api-key').inputValue(),'fixture-unfinished-draft');
  assert.equal((await worker.evaluate(()=>chrome.storage.local.get('service'))).service,'libre','Unfinished provider editing never activates it');
  const optionsOpened=context.waitForEvent('page');
  await settingsPopup.locator('#open-settings').click();
  const realOptions=await optionsOpened;
  await realOptions.waitForURL(`chrome-extension://${id}/options/index.html`);
  await realOptions.locator('#api-key').fill('');
  await realOptions.reload();
  await realOptions.waitForFunction(()=>document.getElementById('save-service')?.disabled===false);
  assert.equal(await realOptions.locator('#service').inputValue(),'deepseek');
  assert.equal(await realOptions.locator('#api-key').inputValue(),'');
  await realOptions.locator('section').last().screenshot({path:join(out,'options-deepseek.png')});
  await realOptions.close();
  checks.push('Shipping popup draft survives document destruction in real chrome.storage.local; openOptionsPage opens a persistent tab and reload preserves the unfinished provider without activating it.');
  for(const service of ['openai','anthropic','gemini']) {
    await settingsPopup.locator('#service').selectOption(service);
    await settingsPopup.locator('#provider').selectOption('custom');
    await settingsPopup.locator('#endpoint').fill(endpoint.replace('/translate',service==='gemini'?'/gemini':'/'+service));
    await settingsPopup.locator('#model').fill('fixture-model');
    await settingsPopup.locator('#api-key').fill('fixture-only-key');
    await settingsPopup.locator('#save-service').click();
    await settingsPopup.locator('#settings-status').filter({hasText:'服务已保存'}).waitFor();
    const stored=await worker.evaluate(()=>chrome.storage.local.get(['service','model','preset']));
    assert.equal(stored.service,service);assert.equal(stored.model,'fixture-model');assert.equal(stored.preset,'custom');
    const replies=await settingsPopup.evaluate(async()=>Promise.all(['Sentence one.','Sentence two.'].map(text=>chrome.runtime.sendMessage({type:'TRANSLATE',text}))));
    assert.deepEqual(replies,[{ok:true,text:'中文：Sentence one.'},{ok:true,text:'中文：Sentence two.'}]);
  }
  await settingsPopup.setViewportSize({width:360,height:800});
  await settingsPopup.screenshot({path:join(out,'popup-ai.png')});
  await configure(worker,{service:'libre',endpoint,apiKey:'',model:'',preset:'custom'});
  checks.push('Actual popup saves each AI protocol; actual service worker performs OpenAI/Anthropic/Gemini HTTP requests with concurrent sentence correspondence against the controlled local server.');
  await settingsPopup.close();

  // Produce our own silent video, never reuse media from the old package.
  const generator=await context.newPage();
  const videoBytes=await generator.evaluate(async()=>{
    const canvas=document.createElement('canvas'); canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#18395d';ctx.fillRect(0,0,640,360);
    const stream=canvas.captureStream(12);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start();
    for(let n=0;n<72;n++) { ctx.fillStyle=n%2?'#18395d':'#204969';ctx.fillRect(0,0,640,360);await new Promise(r=>setTimeout(r,84)); }
    recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const media=Buffer.from(videoBytes);await writeFile(join(out,'synthetic.webm'),media);await generator.close();
  const track = (id,lang) => ({events:[
    {tStartMs:300,dDurationMs:1100,segs:[{utf8:lang==='zh'?'第一句中文。':id==='fixture-two'?'Second video sentence.':'The first sentence.'}]},
    {tStartMs:1400,dDurationMs:1400,segs:[{utf8:lang==='zh'?'第二句中文。':'The second sentence.'}]},
    {tStartMs:3200,dDurationMs:1800,segs:[{utf8:lang==='zh'?'最后一句中文。':'The final sentence.'}]}
  ]});
  await context.route('https://www.youtube.com/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/synthetic.webm') {
      const range=route.request().headers().range;
      if(range) { const start=Number(range.match(/bytes=(\d+)/)?.[1]||0);const body=media.subarray(start);
        return route.fulfill({status:206,body,headers:{'content-type':'video/webm','accept-ranges':'bytes','content-range':`bytes ${start}-${media.length-1}/${media.length}`}}); }
      return route.fulfill({body:media,contentType:'video/webm',headers:{'accept-ranges':'bytes'}});
    }
    if(url.pathname==='/api/timedtext') return route.fulfill({json:track(url.searchParams.get('v'),url.searchParams.get('lang'))});
    if(url.pathname!='/watch' && !url.pathname.startsWith('/embed/')) return route.fulfill({body:'',status:404});
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{margin:30px;background:#eef3f9;font:16px sans-serif}#movie_player{position:relative;width:640px;height:360px;background:#18395d}video{width:100%;height:100%}.ytp-caption-window-container{position:absolute;bottom:20px;color:white}</style><h1>Controlled YouTube fixture</h1><div id="movie_player" class="html5-video-player"><video src="/synthetic.webm" controls preload="auto"></video><div class="ytp-caption-window-container"></div></div><script>
window.fixtureMode=new URL(location.href).searchParams.get('v')==='fixture-dom'?'dom':'manual';
document.querySelector('#movie_player').getPlayerResponse=()=>{const id=new URL(location.href).searchParams.get('v')||location.pathname.split('/')[2];return {videoDetails:{videoId:id},captions:{playerCaptionsTracklistRenderer:{captionTracks:window.fixtureMode==='dom'?[]:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?lang=en&v='+id},...(window.fixtureMode==='manual'?[{languageCode:'zh-Hans',baseUrl:'https://www.youtube.com/api/timedtext?lang=zh&v='+id}]:[])]}}};};
</script>`});
  });
  const yt=await context.newPage();
  await yt.goto('https://www.youtube.com/watch?v=fixture-one');
  const video=yt.locator('video');
  await video.evaluate(v=>new Promise(resolve=>{if(v.readyState>=2)resolve();else v.addEventListener('loadeddata',resolve,{once:true});}));
  await yt.waitForFunction(()=>document.querySelector('.lt-youtube-overlay'));
  const overlay=yt.locator('.lt-youtube-overlay');
  await video.evaluate(v=>{v.currentTime=.7;});
  await overlay.getByText('The first sentence.',{exact:true}).waitFor();
  await overlay.getByText('第一句中文。',{exact:true}).waitFor();
  const small=await overlay.getByText('The first sentence.',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await yt.screenshot({path:join(out,'youtube-640.png')});
  await yt.locator('#movie_player').evaluate(el=>{el.style.width='960px';el.style.height='540px';});
  await yt.waitForTimeout(200);
  await yt.screenshot({path:join(out,'youtube-960.png')});
  const large=await overlay.getByText('The first sentence.',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  assert.ok(large>small,`font scales ${small} → ${large}`);
  await video.evaluate(v=>{v.currentTime=3.6;});
  await overlay.getByText('The final sentence.',{exact:true}).waitFor();
  assert.equal(await overlay.getByText('The first sentence.',{exact:true}).isVisible(),false);
  await video.evaluate(v=>{v.currentTime=5.5;});
  await yt.waitForTimeout(100);
  assert.equal(await overlay.getByText('The final sentence.',{exact:true}).isVisible(),false);
  checks.push('YouTube real HTMLVideoElement: JSON3 manual bilingual rows, media-clock seek/expiry, player-size scaling.');
  await yt.evaluate(()=>{document.dispatchEvent(new Event('yt-navigate-start'));history.pushState({},'','/watch?v=fixture-two');document.dispatchEvent(new Event('yt-navigate-finish'));});
  await video.evaluate(v=>{v.currentTime=.7;});
  await overlay.getByText('Second video sentence.',{exact:true}).waitFor();
  assert.equal(await overlay.getByText('The first sentence.',{exact:true}).isVisible(),false);
  await configure(worker,{youtubeEnabled:false});
  await yt.waitForFunction(()=>!document.querySelector('.lt-youtube-overlay'));
  checks.push('YouTube SPA video navigation replaces the old cue; disabling removes the overlay.');
  await configure(worker,{youtubeEnabled:true});
  await yt.goto('https://www.youtube.com/watch?v=fixture-dom');
  await yt.waitForFunction(()=>document.querySelector('.lt-youtube-overlay'));
  await yt.locator('.ytp-caption-window-container').evaluate(el=>{el.innerHTML='<span class="ytp-caption-segment">A slow sentence.</span>';});
  await yt.locator('.lt-youtube-overlay').getByText('A slow sentence.',{exact:true}).waitFor();
  await yt.locator('video').evaluate(v=>{v.currentTime=3.6;});
  await yt.waitForTimeout(1900);
  assert.equal(await yt.locator('.lt-youtube-overlay').getByText('中文：A slow sentence.',{exact:true}).isVisible(),false);
  await yt.locator('.ytp-caption-segment').evaluate(el=>{el.textContent='Fresh caption.';});
  await yt.locator('.lt-youtube-overlay').getByText('中文：Fresh caption.',{exact:true}).waitFor();
  checks.push('YouTube DOM fallback: a slow old translation cannot reappear after seeking; a new caption translates normally.');
  const embedParent=await context.newPage();
  await embedParent.goto(endpoint.replace('/translate','/embed-parent'));
  await embedParent.evaluate(()=>{const iframe=document.createElement('iframe');iframe.src='https://www.youtube.com/embed/fixture-embed';iframe.id='youtube-embed';iframe.width='680';iframe.height='420';document.body.append(iframe);});
  const embed=embedParent.frameLocator('#youtube-embed');
  await embed.locator('video').evaluate(v=>new Promise(resolve=>{if(v.readyState>=2)resolve();else v.addEventListener('loadeddata',resolve,{once:true});}));
  await embed.locator('video').evaluate(v=>{v.currentTime=.7;});
  await embed.locator('.lt-youtube-overlay').getByText('The first sentence.',{exact:true}).waitFor();
  await embed.locator('.lt-youtube-overlay').getByText('第一句中文。',{exact:true}).waitFor();
  assert.equal(await embed.locator('#aside-floating').count(),0);
  checks.push('The unchanged shipping manifest supplies both MAIN bridge and isolated controller to a cross-origin YouTube embed, with working bilingual media-clock captions.');
  await embedParent.close();
  const {testPageLifecycle}=await import('./page-lifecycle-test.mjs');
  checks.push(...await testPageLifecycle(context));
  assert.deepEqual(errors,[],'No page JavaScript errors');
  const report={date:new Date().toISOString(),browser:context.browser()?.version(),checks,errors,
    scope:'Exact shipping manifest and bundles in isolated browser profiles. Controlled HTTP/video fixtures; no runtime permission pregrant or manifest rewriting.'};
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  await Promise.all(contexts.map(c=>c.close().catch(()=>{})));
  await new Promise(resolve=>server.close(resolve));
}
