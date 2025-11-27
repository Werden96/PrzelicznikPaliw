// script.js - fetch relative, show scraped keys (names), per-item margins via localStorage
const VAT = 1.23;

function marginKeyFor(name){ return 'margin:' + encodeURIComponent(name); }
function getMargin(name){ const v = localStorage.getItem(marginKeyFor(name)); return v === null ? 0 : parseInt(v,10) || 0; }
function setMargin(name, grosze){ localStorage.setItem(marginKeyFor(name), String(grosze)); }

function formatZl(v){ if(v === null || v === undefined) return 'brak'; return Number(v).toFixed(3).replace('.',','); }

function fetchJsonRelative(name){
  const url = new URL(name, document.baseURI).href;
  return fetch(url, { cache: 'no-cache' });
}

async function loadAndRender(){
  const meta = document.getElementById('meta');
  const list = document.getElementById('list');
  try{
    const res = await fetchJsonRelative('prices.json');
    if(!res.ok){
      meta && (meta.innerText = 'Brak prices.json — poczekaj na Action lub sprawdź logi.');
      list && (list.innerText = '');
      return;
    }
    const data = await res.json();
    const prices = data.prices || {};
    meta && (meta.innerText = `Źródło: ${data.source || '—'} · pobrano: ${new Date(data.fetched_at || Date.now()).toLocaleString()}`);

    list.innerHTML = '';
    const keys = Object.keys(prices);
    if(keys.length === 0){
      list.innerText = 'Brak pozycji w prices.json';
      return;
    }

    for(const name of keys){
      const entry = prices[name] || {};
      let gross = (typeof entry.gross === 'number') ? entry.gross : null;
      let per = (typeof entry.per_liter === 'number') ? entry.per_liter : null;
      if(per === null && entry.raw !== undefined && entry.raw !== null) per = Number(entry.raw) / 1000.0;
      if(gross === null && per !== null) gross = per * VAT;

      const item = document.createElement('div'); item.className = 'item';
      const left = document.createElement('div'); left.className = 'left';
      const lbl = document.createElement('div'); lbl.className = 'label'; lbl.innerText = name;
      const priceLine = document.createElement('div'); priceLine.className = 'price small';
      priceLine.innerText = 'Brutto / L: ' + (gross === null ? 'brak' : formatZl(gross) + ' zł');
      left.appendChild(lbl); left.appendChild(priceLine);

      const controls = document.createElement('div'); controls.className = 'controls';
      const input = document.createElement('input'); input.type = 'number'; input.step = '1';
      input.value = String(getMargin(name));
      input.title = 'Marża w groszach';
      const saveBtn = document.createElement('button'); saveBtn.innerText = 'Zapisz';
      const resetBtn = document.createElement('button'); resetBtn.innerText = 'Reset';

      saveBtn.onclick = ()=>{
        const v = parseInt(input.value||'0',10) || 0;
        setMargin(name, v);
        const adjusted = (gross === null) ? null : (gross + v/100.0);
        priceLine.innerText = 'Brutto / L: ' + (adjusted === null ? 'brak' : formatZl(adjusted) + ' zł');
      };
      resetBtn.onclick = ()=>{
        setMargin(name, 0);
        input.value = '0';
        const adjusted = (gross === null) ? null : (gross + 0);
        priceLine.innerText = 'Brutto / L: ' + (adjusted === null ? 'brak' : formatZl(adjusted) + ' zł');
      };

      input.addEventListener('input', ()=>{
        const v = parseInt(input.value||'0',10) || 0;
        const adjusted = (gross === null) ? null : (gross + v/100.0);
        priceLine.innerText = 'Brutto / L: ' + (adjusted === null ? 'brak' : formatZl(adjusted) + ' zł');
      });

      controls.appendChild(input);
      controls.appendChild(saveBtn);
      controls.appendChild(resetBtn);

      item.appendChild(left);
      item.appendChild(controls);
      list.appendChild(item);
    }

    drawChartFromHistory();

  }catch(err){
    console.error('Load error', err);
    if(document.getElementById('meta')) document.getElementById('meta').innerText = 'Błąd pobierania danych (sprawdź konsolę).';
    if(document.getElementById('list')) document.getElementById('list').innerText = '';
  }
}

async function drawChartFromHistory(){
  const ch = document.getElementById('chart');
  ch.innerText = 'Ładowanie wykresu…';
  try{
    const res = await fetchJsonRelative('history.json');
    if(!res.ok){ ch.innerText = 'Brak historii.'; return; }
    const hist = await res.json();
    if(!Array.isArray(hist) || hist.length === 0){ ch.innerText = 'Brak historii.'; return; }

    const first = hist[0].prices || {};
    const keys = Object.keys(first);
    if(keys.length === 0){ ch.innerText = 'Brak danych historycznych.'; return; }
    const chosenKey = keys[0];

    const points = hist.map(h => {
      const p = h.prices && h.prices[chosenKey];
      if(!p) return { t: new Date(h.fetched_at), v: null };
      const gross = (typeof p.gross === 'number') ? p.gross
                    : ((p.per_liter? p.per_liter * VAT : (p.raw? p.raw/1000.0*VAT : null)));
      return { t: new Date(h.fetched_at), v: gross };
    });

    const vals = points.map(p=>p.v).filter(v=>v!==null);
    if(vals.length === 0){ ch.innerText = 'Brak wartości do wykresu.'; return; }

    const min = Math.min(...vals), max = Math.max(...vals);
    const width = 720, height = 200, pad = 30;
    const stepX = (width - pad*2) / (points.length -1 || 1);
    let path = '';
    points.forEach((pt,i)=>{
      const x = pad + i*stepX;
      const y = pt.v === null ? null : pad + ((max - pt.v)/(max - min || 1))*(height - pad*2);
      if(y === null) return;
      if(path==='') path += `M ${x} ${y}`; else path += ` L ${x} ${y}`;
    });
    const svg = [];
    svg.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
    svg.push(`<rect width="100%" height="100%" fill="transparent"/>`);
    svg.push(`<path d="${path}" fill="none" stroke="#0b69ff" stroke-width="2"/>`);
    svg.push(`</svg>`);
    ch.innerHTML = svg.join('');
  }catch(e){
    console.error('Chart error', e);
    ch.innerText = 'Błąd wykresu.';
  }
}

document.addEventListener('DOMContentLoaded', ()=> loadAndRender());