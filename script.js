// script.js - rozszerzony wykres: wybór produktu, marża lokalna preview, tooltip
const VAT = 1.23;

function fetchJsonRelative(name){
  const url = new URL(name, document.baseURI).href;
  return fetch(url, { cache: 'no-cache' });
}

function marginKeyFor(name){ return 'margin:' + encodeURIComponent(name); }
function getMarginGrosze(name){ const v = localStorage.getItem(marginKeyFor(name)); return v === null ? 0 : parseInt(v,10) || 0; }
function setMarginGrosze(name, g){ localStorage.setItem(marginKeyFor(name), String(g)); }

function formatZl(v){ if(v === null || v === undefined) return 'brak'; return Number(v).toFixed(3).replace('.',','); }
function formatDateShort(d){ return d.toLocaleString(); }

// render helpers
function createSVG(width, height){ return document.createElementNS('http://www.w3.org/2000/svg','svg'); }
function linePath(data, xScale, yScale){ return data.map((p,i)=> (i===0? 'M ':'L ') + xScale(i) + ' ' + yScale(p)).join(' ').replace(/^L/,'M'); }

async function loadAllAndInit(){
  const meta = document.getElementById('meta');
  const list = document.getElementById('list');
  const select = document.getElementById('productSelect');
  const toggleMargin = document.getElementById('toggleMargin');
  const chartBox = document.getElementById('chart');
  const pointsRange = document.getElementById('pointsRange');
  const pointsCount = document.getElementById('pointsCount');
  const refreshBtn = document.getElementById('refreshBtn');

  pointsCount.innerText = pointsRange.value;
  pointsRange.addEventListener('input', ()=> pointsCount.innerText = pointsRange.value);

  async function refresh(){
    meta.innerText = 'Ładowanie danych…';
    chartBox.innerHTML = 'Ładowanie wykresu…';
    list.innerHTML = '';

    // fetch prices.json and history.json
    const [pRes, hRes] = await Promise.allSettled([fetchJsonRelative('prices.json'), fetchJsonRelative('history.json')]);
    let prices = {}, history = [];
    if(pRes.status === 'fulfilled' && pRes.value.ok){
      try{ prices = await pRes.value.json(); prices = prices.prices || {}; }catch(e){ prices = {}; }
    }
    if(hRes.status === 'fulfilled' && hRes.value.ok){
      try{ history = await hRes.value.json(); }catch(e){ history = []; }
    }

    // build list UI from current prices (prices.json)
    const priceKeys = Object.keys(prices);
    if(priceKeys.length === 0){
      list.innerText = 'Brak pozycji w prices.json';
    } else {
      for(const k of priceKeys){
        const ent = prices[k] || {};
        const gross = (typeof ent.gross === 'number') ? ent.gross : (ent.per_liter ? ent.per_liter * VAT : (ent.raw ? ent.raw/1000.0*VAT : null));
        const wrapper = document.createElement('div'); wrapper.style.display='flex'; wrapper.style.justifyContent='space-between'; wrapper.style.alignItems='center';
        const left = document.createElement('div'); left.style.maxWidth='65%';
        const title = document.createElement('div'); title.className = 'label'; title.innerText = k;
        const price = document.createElement('div'); price.className='small'; price.innerText = 'Brutto/L: ' + (gross===null?'brak':formatZl(gross)+' zł');
        left.appendChild(title); left.appendChild(price);
        const ctrl = document.createElement('div'); ctrl.style.display='flex'; ctrl.style.gap='8px'; ctrl.style.alignItems='center';
        const inpt = document.createElement('input'); inpt.type='number'; inpt.step='1'; inpt.value = String(getMarginGrosze(k));
        inpt.style.width='90px';
        const saveBtn = document.createElement('button'); saveBtn.innerText='Zapisz'; saveBtn.style.cssText='padding:6px 10px;border-radius:6px;border:0;background:#0b69ff;color:#fff';
        saveBtn.onclick = ()=>{ setMarginGrosze(k, parseInt(inpt.value||'0',10)||0); renderChart(); };
        ctrl.appendChild(inpt); ctrl.appendChild(saveBtn);
        wrapper.appendChild(left); wrapper.appendChild(ctrl);
        list.appendChild(wrapper);
      }
    }

    // prepare history-based product list for dropdown
    if(!Array.isArray(history) || history.length === 0){
      meta.innerText = 'Brak historii (history.json). Wykres nie może zostać pobudowany.';
      select.innerHTML = '';
      chartBox.innerText = 'Brak historii do wykresu.';
      return;
    }
    meta.innerText = `Źródło: ${ (history[history.length-1] && history[history.length-1].fetched_at) ? 'ostatnie scrape: '+ new Date(history[history.length-1].fetched_at).toLocaleString() : '' }`;

    // keys from most recent entry (prefer last)
    const recent = history[history.length-1].prices || history[0].prices || {};
    const keys = Object.keys(recent);
    if(keys.length === 0){
      chartBox.innerText = 'Brak produktów w historii.';
      return;
    }

    // populate dropdown only once (or refresh)
    select.innerHTML = '';
    for(const k of keys){
      const opt = document.createElement('option'); opt.value = k; opt.innerText = k; select.appendChild(opt);
    }

    // try to preserve selected value
    if(!select.value && keys.length>0) select.value = keys[0];

    // whenever selection or toggle changes, redraw
    select.onchange = renderChart;
    toggleMargin.onchange = renderChart;
    pointsRange.oninput = renderChart;

    refreshBtn.onclick = async ()=> { await refresh(); };

    // initial draw
    renderChart();

    // renderChart closure
    function renderChart(){
      if(!select.value) return;
      const product = select.value;
      const showMargin = toggleMargin.checked;
      const maxPoints = Number(pointsRange.value) || 200;

      // build series from history (take last N points)
      const pointsRaw = history.map(h => {
        const p = h.prices && h.prices[product];
        const fetched = h.fetched_at ? new Date(h.fetched_at) : new Date();
        if(!p) return { t: fetched, gross: null };
        const gross = (typeof p.gross === 'number') ? p.gross : (p.per_liter ? p.per_liter*VAT : (p.raw ? p.raw/1000.0*VAT : null));
        return { t: fetched, gross: gross };
      }).filter(x=>x.gross !== null);

      if(pointsRaw.length === 0){
        chartBox.innerText = 'Brak punktów historycznych dla wybranego produktu.';
        return;
      }

      // downsample or take last maxPoints
      const pts = pointsRaw.slice(-maxPoints);

      // compute series arrays
      const seriesA = pts.map(p=>p.gross);
      const marginG = getMarginGrosze(product) / 100.0; // grosze -> zł
      const seriesB = pts.map(p=> p.gross + marginG );

      // prepare SVG dims
      const W = chartBox.clientWidth - 16; // padding
      const H = chartBox.clientHeight - 16;
      const padL = 40, padR = 12, padT = 12, padB = 30;
      const innerW = Math.max(10, W - padL - padR);
      const innerH = Math.max(10, H - padT - padB);

      // compute x,y scales
      const n = pts.length;
      const xScale = i => padL + (i / (n-1 || 1)) * innerW;
      const minY = Math.min(...seriesA.concat(seriesB));
      const maxY = Math.max(...seriesA.concat(seriesB));
      const yScale = v => padT + (1 - ( (v - minY) / ( (maxY - minY) || 1) )) * innerH;

      // build svg
      chartBox.innerHTML = '';
      const svg = createSVG(W + 16, H + 16);
      svg.setAttribute('viewBox', `0 0 ${W+16} ${H+16}`);
      svg.style.width = '100%'; svg.style.height = '100%';
      svg.style.overflow = 'visible';

      // grid horizontal + y labels
      const yTicks = 4;
      for(let yi=0; yi<=yTicks; yi++){
        const v = minY + ( (yTicks - yi) / yTicks) * (maxY - minY);
        const y = yScale(v);
        const line = document.createElementNS(svg.namespaceURI,'line');
        line.setAttribute('x1', padL); line.setAttribute('x2', padL+innerW);
        line.setAttribute('y1', y); line.setAttribute('y2', y);
        line.setAttribute('stroke', '#eee'); line.setAttribute('stroke-width','1');
        svg.appendChild(line);

        const lab = document.createElementNS(svg.namespaceURI,'text');
        lab.setAttribute('x', 6); lab.setAttribute('y', y+4);
        lab.setAttribute('font-size','11'); lab.setAttribute('fill','#666');
        lab.textContent = formatZl(v) + ' zł';
        svg.appendChild(lab);
      }

      // X axis labels (time)
      const xTicks = Math.min(6, Math.max(2, Math.floor(n/Math.ceil(n/6))));
      for(let xi=0; xi<=xTicks; xi++){
        const idx = Math.floor( xi * (n-1) / (xTicks || 1) );
        const pt = pts[idx];
        const x = xScale(idx);
        const lab = document.createElementNS(svg.namespaceURI,'text');
        lab.setAttribute('x', x); lab.setAttribute('y', padT+innerH + 20);
        lab.setAttribute('font-size','11'); lab.setAttribute('fill','#666'); lab.setAttribute('text-anchor','middle');
        lab.textContent = new Date(pt.t).toLocaleString();
        svg.appendChild(lab);
      }

      // path A (brutto)
      const dA = seriesA.map((v,i)=> (i===0? 'M ':'L ') + xScale(i) + ' ' + yScale(v)).join(' ').replace(/^L/,'M');
      const pathA = document.createElementNS(svg.namespaceURI,'path');
      pathA.setAttribute('d', dA);
      pathA.setAttribute('fill','none');
      pathA.setAttribute('stroke','#0b69ff');
      pathA.setAttribute('stroke-width','2');
      svg.appendChild(pathA);

      // path B (brutto + marża) (only if showMargin)
      if(showMargin){
        const dB = seriesB.map((v,i)=> (i===0? 'M ':'L ') + xScale(i) + ' ' + yScale(v)).join(' ').replace(/^L/,'M');
        const pathB = document.createElementNS(svg.namespaceURI,'path');
        pathB.setAttribute('d', dB);
        pathB.setAttribute('fill','none');
        pathB.setAttribute('stroke','#ff6b6b');
        pathB.setAttribute('stroke-width','2');
        pathB.setAttribute('stroke-dasharray','6 4');
        svg.appendChild(pathB);
      }

      // points + tooltip
      const tooltip = document.createElement('div');
      tooltip.style.position='absolute'; tooltip.style.pointerEvents='none'; tooltip.style.background='rgba(0,0,0,0.8)';
      tooltip.style.color='#fff'; tooltip.style.padding='6px 8px'; tooltip.style.borderRadius='6px'; tooltip.style.fontSize='12px'; tooltip.style.display='none';
      chartBox.style.position='relative';
      chartBox.appendChild(tooltip);

      const gPoints = document.createElementNS(svg.namespaceURI,'g');
      for(let i=0;i<n;i++){
        const x = xScale(i); const y = yScale(seriesA[i]);
        const c = document.createElementNS(svg.namespaceURI,'circle');
        c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 3);
        c.setAttribute('fill', '#0b69ff');
        c.style.cursor = 'pointer';
        (function(iLocal){
          c.addEventListener('mouseenter', (ev)=>{
            const dt = new Date(pts[iLocal].t);
            const valA = seriesA[iLocal];
            const valB = seriesB[iLocal];
            tooltip.style.display='block';
            tooltip.innerHTML = `<strong>${formatDateShort(dt)}</strong><br>Brutto: ${formatZl(valA)} zł` + (showMargin ? `<br>Brutto+marża: ${formatZl(valB)} zł` : '');
            const rect = chartBox.getBoundingClientRect();
            tooltip.style.left = (ev.clientX - rect.left + 8) + 'px';
            tooltip.style.top = (ev.clientY - rect.top + 8) + 'px';
          });
          c.addEventListener('mouseleave', ()=> tooltip.style.display='none');
        })(i);
        gPoints.appendChild(c);
      }
      svg.appendChild(gPoints);

      // append svg
      chartBox.appendChild(svg);

      // legend update: show/hide marża legend item opacity
      const legendEl = document.getElementById('legend');
      if(legendEl){
        const items = legendEl.querySelectorAll('.item');
        if(items && items[1]) items[1].style.opacity = showMargin ? '1' : '0.4';
      }
    } // renderChart end
  } // refresh end

  // first load
  try{ await refresh(); }catch(e){ console.error(e); document.getElementById('chart').innerText='Błąd ładowania.'; }
}

document.addEventListener('DOMContentLoaded', ()=> loadAllAndInit());