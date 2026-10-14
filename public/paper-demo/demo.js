import {createPaperDemo,paperAction,paperView} from './engine.mjs';
const $=id=>document.getElementById(id);
const money=v=>v.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
let model=createPaperDemo(),interval=null;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function draw(candles) {
 const canvas=$('marketChart'),dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
 const c=canvas.getContext('2d');c.scale(dpr,dpr);
 const w=rect.width,h=rect.height,pad=20;
 const high=Math.max(...candles.map(v=>v.high))+2,low=Math.min(...candles.map(v=>v.low))-2;
 const y=n=>pad+(high-n)/(high-low)*(h-2*pad);
 c.strokeStyle='#272a2e';c.lineWidth=1;
 for(let i=0;i<5;i++){let yp=pad+i*(h-2*pad)/4;c.beginPath();c.moveTo(0,yp);c.lineTo(w,yp);c.stroke();}
 const cw=(w-24)/candles.length;
 candles.forEach((bar,i)=>{
  const x=12+(i+.5)*cw,up=bar.close>=bar.open;
  c.strokeStyle=up?'#75cfa3':'#ef7c76';c.fillStyle=c.strokeStyle;
  c.beginPath();c.moveTo(x,y(bar.high));c.lineTo(x,y(bar.low));c.stroke();
  const top=Math.min(y(bar.open),y(bar.close)),ht=Math.max(1.6,Math.abs(y(bar.close)-y(bar.open)));
  c.fillRect(x-Math.max(1.6,cw*.25),top,Math.max(3.2,cw*.5),ht);
 });
 c.textAlign='right';c.fillStyle='#8c9195';c.font='10px sans-serif';
 for(let i=0;i<4;i++){const v=high-(high-low)*i/3;c.fillText(v.toFixed(1),w-4,y(v)-5)}
}
function render() {
 const v=paperView(model);
 $('balance').textContent=money(v.balance);$('equity').textContent=money(v.equity);
 $('pnl').textContent=(v.unrealized>0?'+':'')+money(v.unrealized);
 $('pnl').className=v.unrealized>=0?'positive':'negative';
 $('engineStatus').textContent=v.running?'RUNNING':'STOPPED';$('engineStatus').className=v.running?'positive':'';
 $('runnerPill').textContent=v.running?'● Running virtual bot':'◯ Paused';$('lastUpdate').textContent='SYNTHETIC · '+v.strategy.toUpperCase();
 $('candleCounter').textContent=v.step+' virtual 5m candles played';
 $('price').textContent=v.quote.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 $('virtualTime').textContent=new Date(v.virtualTime).toUTCString().slice(0,25);
 $('start').disabled=v.running;$('pause').disabled=!v.running;$('strategy').disabled=v.running;
 if(v.position){const p=v.position;$('position').className='position-card'+(p.side==='sell'?' sell':'');
 $('position').innerHTML='<div class="position-head"><span>PAPER '+escape(p.side.toUpperCase())+' · 0.01 LOT</span><span>SIMULATED</span></div><div class="position-grid"><div>ENTRY<strong>'+p.entry.toFixed(2)+'</strong></div><div>STOP LOSS<strong>'+p.stop.toFixed(2)+'</strong></div><div>TAKE PROFIT<strong>'+p.target.toFixed(2)+'</strong></div><div>UNREALIZED<strong>'+money(v.unrealized)+'</strong></div></div>';}
 else{$('position').className='position-empty';$('position').textContent='No simulated position. '+(v.running?'Monitoring closed candles for a synthetic signal.':'Start the paper bot to process signals.')}
 $('events').innerHTML=v.events.map(e=>'<div class="event">'+escape(e)+'</div>').join('');
 $('history').innerHTML=v.history.length?v.history.map(t=>'<div class="trade-row"><div>'+escape(t.side.toUpperCase())+' · Paper 0.01 lot<small>'+t.entry.toFixed(2)+' → '+t.exit.toFixed(2)+'</small></div><strong class="'+(t.pnl>=0?'positive':'negative')+'">'+(t.pnl>=0?'+':'')+money(t.pnl)+'</strong></div>').join(''):'<div class="history-empty">No virtual trades closed yet. Paper orders appear here when simulated stop-loss or take-profit is reached.</div>';
 draw(v.candles);
}
function act(name,value){try{model=paperAction(model,name,value);render();}catch(e){window.alert(e.message)}}
$('start').addEventListener('click',()=>act('start'));
$('pause').addEventListener('click',()=>act('pause'));
$('advance').addEventListener('click',()=>act('step',15));
$('reset').addEventListener('click',()=>{if(confirm('Reset virtual balance and paper trade history?'))act('reset')});
$('strategy').addEventListener('change',e=>act('strategy',e.target.value));
interval=setInterval(()=>{if(model.running){paperAction(model,'step',1);render()}},1400);
new ResizeObserver(()=>render()).observe($('marketChart'));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});
render();