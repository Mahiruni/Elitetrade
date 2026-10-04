// Loaded only when the Trade chart has actual provider candles to display.
const ns='http://www.w3.org/2000/svg';
export function drawMarketChart(host,candles,{indicator=false,symbol='',timeframe=''}={}) {
  const available=candles.filter(c=>Number.isFinite(Date.parse(c.time))&&['open','high','low','close'].every(k=>Number.isFinite(c[k])));
  const W=Math.max(240,Math.round(host.clientWidth)),H=W<500?300:380;
  const points=W<500?available.slice(-40):available;
  if(!points.length)return;
  const left=10,right=W<500?64:90,top=26,bottom=40,width=W-left-right,height=H-top-bottom;
  const min=Math.min(...points.map(c=>c.low)),max=Math.max(...points.map(c=>c.high)),pad=(max-min)*.08 || max*.001,lo=min-pad,hi=max+pad;
  const y=v=>top+(hi-v)/(hi-lo)*height,step=width/points.length,x=i=>left+(i+.5)*step;
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${symbol} ${timeframe} broker candlestick chart, ${points.length} candles${indicator?', SMA 20 overlay':''}`);svg.classList.add('candlestick-chart');
  const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;svg.append(el);return el;};
  const format=v=>new Intl.NumberFormat('en',{maximumFractionDigits:5}).format(v);
  for(let i=0;i<=4;i++){const v=hi-(hi-lo)*i/4,yy=y(v);add('line',{x1:left,x2:W-right,y1:yy,y2:yy,class:'candle-grid'});add('text',{x:W-right+10,y:yy+4,class:'candle-axis'},format(v));}
  points.forEach((c,i)=>{const color=c.close>=c.open?'var(--green)':'var(--red)';add('line',{x1:x(i),x2:x(i),y1:y(c.high),y2:y(c.low),stroke:color,'stroke-width':1.4});const rect=add('rect',{x:x(i)-Math.max(1.5,step*.3),y:Math.min(y(c.open),y(c.close)),width:Math.max(3,step*.6),height:Math.max(1.6,Math.abs(y(c.open)-y(c.close))),fill:color});const title=document.createElementNS(ns,'title');title.textContent=`${new Date(c.time).toLocaleString('en')} · O ${format(c.open)} H ${format(c.high)} L ${format(c.low)} C ${format(c.close)}`;rect.append(title);});
  if(indicator&&points.length>=20){const values=[];for(let i=19;i<points.length;i++){const v=points.slice(i-19,i+1).reduce((s,c)=>s+c.close,0)/20;values.push(`${x(i)},${y(v)}`);}add('polyline',{points:values.join(' '),fill:'none',stroke:'var(--accent)','stroke-width':2});}
  for(const i of [...new Set([0,Math.floor(points.length/2),points.length-1])])add('text',{x:Math.min(W-right,Math.max(42,x(i))),y:H-12,'text-anchor':'middle',class:'candle-axis'},new Date(points[i].time).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',hour12:false}));
  host.replaceChildren(svg);
}
