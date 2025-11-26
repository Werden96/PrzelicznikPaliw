// script.js - odporny loader: obsługuje różne struktury prices.json
// - obsługuje keys: benzyna/on/op OR pb95/pb98/diesel
// - jeśli brak 'gross' -> oblicza gross = per_liter * VAT (albo raw/1000*VAT)
// - osobne marże per paliwo w localStorage

const VAT = 1.23;
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
function formatDisplay(v){
  if (v === null || v === undefined) return 'brak';
  // show with 2 decimals, comma as decimal separator
  return Number(v).toFixed(2).replace('.',',');
}
function safeNum(x){ return (x === null || x === undefined) ? null : Number(x); }

// map different possible keys to canonical names
function normalizePrices(rawObj){
  // rawObj: whatever is in prices.json .prices
  // return canonical: { benzyna: {raw, per_liter, gross}, on:..., op:... }
  const out = { benzyna: null, on: null, op: null };

  // helper to ensure structure: accept object with raw/per_liter/gross or a plain number
  function normalizeEntry(e){
    if(e == null) return null;
    // if e is a number -> treat as per_liter gross? ambiguous => treat as per_liter
    if(typeof e === 'number') {
      const per_liter = e;
      const gross = per_liter * VAT;
      return { raw: null, per_liter, gross };
    }
    // if e has gross/per_liter/raw use them, else try derive
    const hasRaw = e.raw !== undefined && e.raw !== null;
    const hasPer = e.per_liter !== undefined && e.per_liter !== null;
    const hasGross = e.gross !== undefined && e.gross !== null;
    let raw = hasRaw ? safeNum(e.raw) : null;
    let per = hasPer ? safeNum(e.per_liter) : null;
    let gross = hasGross ? safeNum(e.gross) : null;

    if(per === null && raw !== null) per = raw / 1000.0;
    if(gross === null && per !== null) gross = per * VAT;
    // if still null, try other heuristics (e.g. e is string)
    return { raw, per_liter: per, gross };
  }

  // direct matches first
  if(!rawObj || typeof rawObj !== 'object') return out;

  // If keys are pb95/pb98/diesel etc, map them
  // Both old and new formats may appear, so check all possibilities.

  // 1) benzyna: prefer 'benzyna' then pb95 or pb98 combined -> choose pb95 if present
  if(rawObj.benzyna) out.benzyna = normalizeEntry(rawObj.benzyna);
  else if(rawObj.pb95) out.benzyna = normalizeEntry(rawObj.pb95);
  else if(rawObj.pb98) out.benzyna = normalizeEntry(rawObj.pb98); // fallback

  // 2) on: prefer 'on' then 'diesel'
  if(rawObj.on) out.on = normalizeEntry(rawObj.on);
  else if(rawObj.diesel) out.on = normalizeEntry(rawObj.diesel);

  // 3) op: prefer 'op' then search for keys containing 'opal' or 'heatoil' or 'opalowy'
  if(rawObj.op) out.op = normalizeEntry(rawObj.op);
  else {
    // try to detect candidate keys
    const candidates = Object.keys(rawObj||{}).filter(k => /opal|opał|heatoil|heat/i.test(k));
    if(candidates.length) out.op = normalizeEntry(rawObj[candidates[0]]);
  }

  // If still null, attempt to infer from any numeric entries (last resort)
  for(const k of Object.keys(rawObj||{})){
    if(out.benzyna && out.on && out.op) break;
    if(typeof rawObj[k] === 'object') continue;
    // skip if key contains 'history' etc
    if(/history|source|fetched/i.test(k)) continue;
  }

  return out;
}

async function loadPricesAndHistory(){
  const metaEl = document.getElementById('meta');
  try{
    const [resPrices, resHistory] = await Promise.all([
      fetch('/prices.json', { cache: 'no-cache' }).catch(()=>null),
      fetch('/history.json', { cache: 'no-cache' }).catch(()=>null)
    ]);

    if(!resPrices || !resPrices.ok){
      metaEl && (metaEl.innerText = 'Brak prices.json — poczekaj na Action lub sprawdź logi.');
      initMarginInputs(); // still init inputs
      return;
    }

    const data = await resPrices.json();
    const p = data.prices || {};

    const canon = normalizePrices(p);

    // For robustness: if normalized entries miss per_liter/gross but original p has pb95 numeric values, try to use them
    // (Handled in normalizePrices already)

    // display each fuel
    displayFuel('benzyna', canon.benzyna, p, data);
    displayFuel('on', canon.on, p, data);
    displayFuel('op', canon.op, p, data);

    metaEl && (metaEl.innerText = `Źródło: ${data.source || '—'} · pobrano: ${new Date(data.fetched_at || Date.now()).toLocaleString()}`);

    if(resHistory && resHistory.ok){
      const history = await resHistory.json();
      drawSimpleChart(history);
    } else {
      const ch = document.getElementById('chart');
      if(ch) ch.innerText = 'Brak historii (poczekaj na pierwszy zapis).';
    }

    initMarginInputs();
  }catch(err){
    console.error('Script load error:', err);
    metaEl && (metaEl.innerText = 'Błąd pobierania danych (sprawdź konsolę).');
    initMarginInputs();
  }
}

function displayFuel(key, canonEntry, rawPricesAll, dataObj){
  const el = document.getElementById(key);
  const savedMargin = getMargin(key);
  // If canonical entry missing, try to compute from rawPricesAll direct keys heuristics:
  let entry = canonEntry;
  if(!entry || (entry.per_liter === null && entry.gross === null)){
    // try to find pb95/pb98/diesel keys numeric objects
    const tryKeys = {
      benzyna: ['benzyna','pb95','pb98'],
      on: ['on','diesel'],
      op: ['op']
    }[key] || [key];
    for(const tk of tryKeys){
      if(rawPricesAll && rawPricesAll[tk]){
        entry = typeof rawPricesAll[tk] === 'object' ? rawPricesAll[tk] : { raw: null, per_liter: safeNum(rawPricesAll[tk]), gross: null };
        break;
      }
    }
  }

  // if still null -> show 'brak'
  if(!entry){
    if(el) el.innerText = 'brak';
    return;
  }

  // compute missing fields: prefer gross; if missing compute gross from per_liter or raw
  let per = safeNum(entry.per_liter);
  let gross = safeNum(entry.gross);
  if(per === null && entry.raw !== undefined && entry.raw !== null) per = safeNum(entry.raw) / 1000.0;
  if(gross === null && per !== null) gross = per * VAT;
  if(gross === null && entry.raw !== undefined && entry.raw !== null) gross = (safeNum(entry.raw)/1000.0) * VAT;

  if(gross === null){
    if(el) el.innerText = 'brak';
    return;
  }

  // apply margin (grosze)
  const adjusted = gross + (savedMargin / 100.0);
  if(el) el.innerText = formatDisplay(adjusted);
}

// margin UI wiring
function initMarginInputs(){
  ['benzyna','on','op'].forEach(key=>{
    const input = document.getElementById('margin-' + key);
    const saveBtn = document.getElementById('save-' + key);
    const resetBtn = document.getElementById('reset-' + key);
    if(input) input.value = getMargin(key);
    if(saveBtn) saveBtn.onclick = ()=> { const v = parseInt(input.value||'0',10) || 0; setMargin(key, v); loadPricesAndHistory(); };
    if(resetBtn) resetBtn.onclick = ()=> { setMargin(key, 0); if(input) input.value = 0; loadPricesAndHistory(); };
    // live preview on input
    if(input) input.addEventListener('input', ()=> {
      // update display quickly using cached prices.json
      fetch('/prices.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(data=>{
        if(!data) return;
        const p = data.prices || {};
        const canon = normalizePrices(p);
        displayFuel(key, canon[key], p, data);
      }).catch(()=>{});
    });
  });
}

// draw chart (same as before) — simple
function drawSimpleChart(history){
  const ch = document.getElementById('chart');
  if(!ch) return;
  if(!Array.isArray(history) || history.length === 0){ ch.innerText = 'Brak danych historycznych.'; return; }
  const N = 30; const slice = history.slice(-N);
  const points = slice.map(h => {
    const p = h.prices || {};
    // handle both shapes
    let val = null;
    if(p.benzyna && typeof p.benzyna.gross === 'number') val = p.benzyna.gross;
    else if(p.pb95 && typeof p.pb95.gross === 'number') val = p.pb95.gross;
    else if(p.benzyna && typeof p.benzyna.per_liter === 'number') val = p.benzyna.per_liter * VAT;
    else if(p.pb95 && typeof p.pb95.per_liter === 'number') val = p.pb95.per_liter * VAT;
    return { t: new Date(h.fetched_at), v: val };
  });
  const vals = points.map(p=>p.v).filter(v=>v!==null);
  if(vals.length===0){ ch.innerText = 'Brak wartości benzyny w historii.'; return; }
  const min = Math.min(...vals), max = Math.max(...vals);
  const width = 560, height = 160, pad = 28;
  const stepX = (width - pad*2) / (points.length -1 || 1);
  let path = '';
  const svg = [];
  svg.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
  svg.push(`<rect width="100%" height="100%" fill="transparent"/>`);
  points.forEach((pt,i)=>{
    const x = pad + i*stepX;
    const y = pt.v===null ? null : pad + ((max - pt.v)/(max - min || 1))*(height - pad*2);
    if(y===null) return;
    if(path==='') path += `M ${x} ${y}`; else path += ` L ${x} ${y}`;
  });
  svg.push(`<path d="${path}" fill="none" stroke="#0b69ff" stroke-width="2"/>`);
  svg.push(`</svg>`);
  ch.innerHTML = svg.join('');
}

document.addEventListener('DOMContentLoaded', ()=> {
  initMarginInputs();
  loadPricesAndHistory();
});
