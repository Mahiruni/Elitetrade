// Decorative OHLC simulation aligned to the existing phone artwork.
// It uses no broker feed, account credentials, or trading actions.
export function mountHeroMarket(svg) {
  if (!svg) return () => {};
  const step = 8.7, left = 12, count = 22;
  const up = '#1595ff', down = '#f35d79';
  const scale = price => 67 + (2438 - price) * 16.5;
  const prices = [2422.8,2421.9,2423.3,2424.4,2424.7,2423.6,2422.8,2423.1,2425.2,2427.2,2426.6,2428.9,2431.1,2430.0,2431.8,2433.6,2434.5,2433.8,2432.7,2433.1,2432.5,2432.7];
  let bars = prices.map((close,index) => {
    const open = index ? prices[index - 1] : 2422.1;
    return {open,close,high:Math.max(open,close) + .3 + (index % 3) * .2,low:Math.min(open,close) - .35 - (index % 4) * .15};
  });
  const grid = Array.from({length:11},(_,index) => {
    const value = 2438 - index * 2, y = scale(value);
    return `<path d="M7 ${y}H204" stroke="#1a2b3b" stroke-width=".7" stroke-dasharray="2 3"/><text x="210" y="${y + 3.5}" fill="#a7b7c9" font-size="10">${value.toFixed(2)}</text>`;
  }).join('') + Array.from({length:5},(_,i) => `<path d="M${14 + i * 43} 58V410" stroke="#1a2b3b" stroke-width=".7" stroke-dasharray="2 3"/>`).join('');
  svg.innerHTML = `<defs><clipPath id="hero-phone-chart"><rect x="7" y="58" width="198" height="353"/></clipPath></defs>
    <g transform="matrix(1 .008 .036 1 231 327)" font-family="Arial,sans-serif">
      <rect width="251" height="438" fill="#08121f"/>
      <text x="10" y="25" fill="#eef4fc" font-size="15">XAUUSD · M15</text>
      <text x="11" y="44" fill="#9faec1" font-size="10">DEMO</text>
      <circle cx="233" cy="20" r="3" fill="#31cea0"/>
      ${grid}<path d="M205 58V413M7 413H249" stroke="#3c5065" stroke-width=".8"/>
      <g clip-path="url(#hero-phone-chart)"><g data-market-candles></g><line data-market-price-line x1="7" x2="205" stroke="${up}" stroke-width="1" stroke-dasharray="3 3"/></g>
      <g data-market-price-marker><rect x="206" y="-9" width="44" height="18" rx="1.5" fill="${up}"/><text data-market-price x="208" y="3.5" fill="white" font-size="10">2432.70</text></g>
      <text x="10" y="431" fill="#a7b7c9" font-size="10">09:00</text><text x="89" y="431" fill="#a7b7c9" font-size="10">12:00</text><text x="162" y="431" fill="#a7b7c9" font-size="10">15:00</text>
    </g>`;
  const candles = svg.querySelector('[data-market-candles]');
  const line = svg.querySelector('[data-market-price-line]');
  const marker = svg.querySelector('[data-market-price-marker]');
  const priceText = svg.querySelector('[data-market-price]');
  const button = svg.closest('.hero-visual').querySelector('[data-market-toggle]');
  let candleNodes;
  function paintBar(node,bar,index) {
    const x = left + index * step, y = Math.min(scale(bar.open),scale(bar.close));
    const color = bar.close >= bar.open ? up : down;
    node.setAttribute('fill',color); node.setAttribute('stroke',color);
    const wick = node.firstElementChild, body = node.lastElementChild;
    wick.setAttribute('x1',x); wick.setAttribute('x2',x);
    wick.setAttribute('y1',scale(bar.high)); wick.setAttribute('y2',scale(bar.low));
    body.setAttribute('x',x - 2.7); body.setAttribute('y',y);
    body.setAttribute('height',Math.max(1.5,Math.abs(scale(bar.open) - scale(bar.close))));
  }
  function redraw() {
    candles.innerHTML = bars.map(() => '<g><line stroke-width="1"/><rect width="5.4" stroke="none" rx=".4"/></g>').join('');
    candleNodes = [...candles.children];
    bars.forEach((bar,index) => paintBar(candleNodes[index],bar,index));
  }
  function paintPrice() {
    const active = bars[count - 1], y = scale(active.close), color = active.close >= active.open ? up : down;
    paintBar(candleNodes[count - 1],active,count - 1);
    line.setAttribute('y1',y); line.setAttribute('y2',y); line.setAttribute('stroke',color);
    marker.setAttribute('transform',`translate(0 ${y})`);
    marker.firstElementChild.setAttribute('fill',color);
    priceText.textContent = active.close.toFixed(2);
  }
  redraw(); paintPrice();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, lastTime = 0, age = 0, tickAge = 0, slideAge = 700;
  let target = bars[count - 1].close, paused = false, inView = false, disposed = false;
  let seed = 41;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const running = () => !disposed && !paused && !motion.matches && inView && !document.hidden;
  function tick(time) {
    frame = 0;
    if (!running() || !svg.isConnected) return;
    // Update at 30fps and cap elapsed time after a background tab resumes.
    if (lastTime && time - lastTime < 32) { frame = requestAnimationFrame(tick); return; }
    const delta = lastTime ? Math.min(time - lastTime,80) : 33;
    lastTime = time; age += delta; tickAge += delta; slideAge += delta;
    if (tickAge >= 420) {
      target = Math.max(2420.5,Math.min(2436.4,target + (random() - .48) * 1.4));
      tickAge = 0;
    }
    const active = bars[count - 1];
    active.close += (target - active.close) * (1 - Math.exp(-delta / 170));
    active.high = Math.max(active.high,active.close);
    active.low = Math.min(active.low,active.close);
    if (age >= 6000) {
      bars.shift(); bars.push({open:active.close,close:active.close,high:active.close + .08,low:active.close - .08});
      age = 0; slideAge = 0; redraw();
    }
    const progress = Math.min(1,slideAge / 650);
    candles.setAttribute('transform',`translate(${step * (1 - progress) ** 3} 0)`);
    paintPrice();
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    svg.dataset.marketState = motion.matches ? 'reduced' : paused ? 'paused' : inView && !document.hidden ? 'running' : 'offscreen';
    if (running()) { if (!frame) { lastTime = 0; frame = requestAnimationFrame(tick); } }
    else { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
  }
  function toggle() {
    paused = !paused;
    const label = paused ? 'Resume market preview' : 'Pause market preview';
    button.setAttribute('aria-pressed',String(paused)); button.setAttribute('aria-label',label); button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${paused ? 'm8 5 11 7-11 7Z' : 'M9 5v14m6-14v14'}"/></svg>`;
    sync();
  }
  const observer = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; sync(); });
  observer.observe(svg); button.addEventListener('click',toggle);
  motion.addEventListener('change',sync); document.addEventListener('visibilitychange',sync); sync();
  return () => {
    disposed = true; cancelAnimationFrame(frame); observer.disconnect();
    button.removeEventListener('click',toggle); motion.removeEventListener('change',sync); document.removeEventListener('visibilitychange',sync);
  };
}
