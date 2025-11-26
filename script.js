// script.js - pokazuje ceny brutto i obsługuje osobne marże (localStorage)

const KEYS = {
  benzyna: 'margin_benzyna_grosze',
  on: 'margin_on_grosze',
  op: 'margin_op_grosze'
};

function getMargin(key){
  const v = localStorage.getItem(KEYS[key]);
  return v === null ? 0 : parseInt(v,10) || 0;
}
function setMargin(key, grosze){
  localStorage.setItem(KEYS[key], String(grosze));
}

function formatZl(val){
  if(val === null || val === undefined) return 'brak';
  return Number(val).toFixed(2).replace('.',','); // display with comma
}

async function loadPricesAndHistory(){
  const metaEl = document.getElementById('meta');
  try{
    const [resPrices, resHistory] = await Promise.all([
      fetch('/prices.json', { cache: 'no-cache' }).catch(()=>null),
      fetch('/history.json', { cache: 'no-cache' }).catch(()=>null)
    ]);

    if(!resPrices || !resPrices.ok){
      metaEl.innerText = 'Brak prices.json — poczekaj na Action lub sprawdź logi.';
      // set margin inputs from localStorage anyway
      initMarginInputs();
      return;
    }
    const data = await resPrices.json();
    const p = data.prices || {};

    // show for each fuel
    showFuel('benzyna', p.benzyna);
    showFuel('on', p.on);
    showFuel('op', p.op);

    metaEl.innerText = `Źródło: ${data.source} · pobrano: ${new Date(data.fetched_at).toLocaleString()}`;

    if(resHistory && resHistory.ok){
      const history = await resHistory.json();
      drawSimpleChart(history);
    } else {
      document.getElementById('chart').innerText = 'Brak historii (poczekaj na pierwszy zapis).';
    }

    // init inputs & buttons
    initMarginInputs();
  }catch(err){
    console.error(err);
    document.getElementById('meta').innerText = 'Błąd pobierania danych.';
    initMarginInputs();
  }
}

function showFuel(key, obj){
  const el = document.getElementById(key);
  const marginInput = document.getElementById('margin-' + key);
  const saved = getMargin(key);
  if(marginInput) marginInput.value = saved;

  if(!obj || typeof obj.gross !== 'number'){
    if(el) el.innerText = 'brak';
    return;
  }
  const base = Number(obj.gross);
  const adjusted = base + (saved / 100.0);
  if(el) el.innerText = adjusted.toFixed(2).replace('.',',');
}

function initMarginInputs(){
  ['benzyna','on','op'].forEach(key=>{
    const saveBtn = document.getElementById('save-' + key);
    const resetBtn = document.getElementById('reset-' + key);
    const input = document.getElementById('margin-' + key);

    if(input){
      // ensure it's populated from storage
      input.value = getMargin(key);
      input.addEventListener('input', ()=> {
        // live-preview without saving
        const val = parseInt(input.value||'0',10) || 0;
        // update shown price live using current prices.json
        const el = document.getElementById(key);
        // reload prices JSON in background to recalc display (cheap)
        fetch('/prices.json', {cache:'no-cache'}).then(r=>r.ok?r.json():null).then(data=>{
          const obj = data && data.prices ? data.prices[key] : null;
          if(obj && typeof obj.gross === 'number'){
            const base = Number(obj.gross);
            const adjusted = base + (val/100.0);
            if(el) el.innerText = adjusted.toFixed(2).replace('.',',');
          }
        }).catch(()=>{});
      });
    }

    if(saveBtn){
      saveBtn.onclick = ()=> {
        const val = parseInt(input.value||'0',10) || 0;
        setMargin(key, val);
        loadPricesAndHistory(); // reload display
      };
    }
    if(resetBtn){
      resetBtn.onclick = ()=> {
        setMargin(key, 0);
        const inp = document.getElementById('margin-' + key);
        if(inp) inp.value = 0;
        loadPricesAndHistory();
      };
    }
  });
}

function drawSimpleChart(history){
  if(!Array.isArray(history) || history.length===0){
    document.getElementById('chart').innerText = 'Brak danych historycznych.';
    return;
  }
  const N = 30;
  const slice = history.slice(-N);
  const points = slice.map(h=>({
    t: new Date(h.fetched_at),
    v: (h.prices && h.prices.benzyna && typeof h.prices.benzyna.gross === 'number') ? Number(h.prices.benzyna.gross) : null
  }));
  const vals = points.map(p=>p.v).filter(v=>v!==null);
  if(vals.length===0){
    document.getElementById('chart').innerText = 'Brak wartości benzyny w historii.';
    return;
  }
  const min = Math.min(...vals), max = Math.max(...vals);
  const width = 560, height = 160, pad = 28;
  const stepX = (width - pad*2) / (points.length - 1 || 1);
  let path = '';
  const svg = [];
  svg.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
  svg.push(`<rect width="100%" height="100%" fill="transparent"/>`);
  points.forEach((pt,i)=>{
    const x = pad + i * stepX;
    const y = pt.v===null ? null : pad + ((max - pt.v)/(max - min || 1)) * (height - pad*2);
    if(y===null) return;
    if(path==='') path += `M ${x} ${y}`; else path += ` L ${x} ${y}`;
  });
  svg.push(`<path d="${path}" fill="none" stroke="#0b69ff" stroke-width="2"/>`);
  svg.push(`</svg>`);
  document.getElementById('chart').innerHTML = svg.join('');
}

// init
document.addEventListener('DOMContentLoaded', ()=> {
  // wire up save/reset buttons after DOM ready
  initMarginInputs();
  loadPricesAndHistory();
});
