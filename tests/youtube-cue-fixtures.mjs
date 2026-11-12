// Project-authored synthetic wire inputs; terminal durations preserve the platform event end.
const words = (start, duration, values) => ({ tStartMs: start, dDurationMs: duration, segs: values.map(([utf8, tOffsetMs]) => ({ utf8, tOffsetMs })) });
const row = (start, duration, text) => ({ tStartMs: start, dDurationMs: duration, segs: [{ utf8: text }] });
export const youtubeCueFixtures = [
  { name: 'word pause', language: 'en', kind: 'asr', events: [words(1000, 5000, [['We',0],[' can',200],[' start',400],[' now',700],[' and',2300],[' keep',2600],[' going',3000]])], expected: [
    {start:1,end:3.3,text:'we can start now'},{start:3.3,end:6,text:' and keep going'}] },
  { name: 'filler and clause', language: 'en', kind: 'asr', events: [words(500,2500,[['We',0],[' have',200],[' uh',400],[' some',450],[' more',1900]]),words(3020,2000,[[' to',0],[' say',80],[' because',900],[' I',1100],[' agree',1300]])], expected: [
    {start:.5,end:3.92,text:'we have some more to say'},{start:3.92,end:5.02,text:' because i agree'}] },
  { name: 'punctuation and newline', language: 'en', kind: 'asr', events: [words(0,7000,['At',' 2.',' Try.',' Yes.',' No?',' Now.','\n','Fine!',' More.',' Next.',' There.',' Here.',' End.'].map((text,index)=>[text,index*450]))], expected: [
    [0,1.35,'at 2. try.'],[1.35,1.8,' yes.'],[1.8,2.25,' no?'],[2.25,3.15,' now.'],[3.15,3.6,' fine!'],[3.6,4.05,' more.'],[4.05,4.5,' next.'],[4.5,4.95,' there.'],[4.95,5.4,' here.'],[5.4,7,' end.']
  ].map(([start,end,text])=>({start,end,text})) },
  { name: 'dense long speech', language: 'en', kind: 'asr', events: [words(230,9000,Array.from({length:34},(_,index)=>[index?' word':'many',index*230]))], expected: Array.from({length:9},(_,index)=>({start:(230+(index?2+(index-1)*4:0)*230)/1000,end:index===8?9.23:(230+(2+index*4)*230)/1000,text:index?' word word word word':'many word'})) },
  { name: 'uppercase fragments', language:'en',kind:'asr',events:[words(0,900,[['HEL',0],['LO',120],[' WORLD',700]]),words(2000,500,[[' LATE',0],[' END',200]])],expected:[{start:0,end:2,text:'hello world'},{start:2,end:2.5,text:' late end'}] },
  { name: 'authored ASR sentences',language:'en',kind:'asr',events:[row(1000,1300,'Already in sentences.'),row(3000,2000,'Follow the event boundaries.')],expected:[{start:1,end:2.3,text:'Already in sentences.'},{start:3,end:5,text:'Follow the event boundaries.'}] },
  { name:'human overlap and roll-up',language:'en',kind:'',events:[row(4000,2000,'Second'),row(1000,90000,'First'),row(4000,2000,'Second'),row(5100,900,'speaker'),{...row(5400,300,'ignored'),aAppend:1},row(6500,500,'Last')],expected:[{start:1,end:4,text:'First'},{start:4,end:6,text:'Second speaker'},{start:6.5,end:7,text:'Last'}] },
  { name:'simultaneous multiline voices',language:'en',kind:'',events:[row(1000,4200,'First\nline'),row(1000,4000,'Other\nvoice'),row(3000,2200,'Second\nline')],expected:[{start:1,end:3,text:'First line Other voice'},{start:3,end:5.2,text:'Second line'}] },
  { name:'Japanese reading time',language:'ja',kind:'asr',events:[row(1000,100,'こんにちは世界'),row(1600,100,'これは次の字幕です'),row(4000,100,'終わり')],expected:[{start:1,end:1.6-.001,text:'こんにちは世界'},{start:1.6,end:1.6+'これは次の字幕です'.length/7,text:'これは次の字幕です'},{start:4,end:4.1,text:'終わり'}] },
];
