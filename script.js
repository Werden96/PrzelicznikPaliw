// script.js - loads prices.json, shows gross per liter and allows client-side margin (grosze) stored in localStorage

const MARGIN_KEY = 'fuel_margin_grosze'; // integer grosze

async function loadPricesAndHistory() {
  const metaEl = document.getElementById('meta');
  try {
    const [resPrices, resHistory] = await Promise.all([
      fetch('/prices.json', { cache: 'no-cache' }).catch(()=>null),
      fetch('/history.json', { cache: 'no-cache' }).catch(()=>null)
    ]);

    if (!resPrices || !resPrices.ok) {
      metaEl.innerText = 'Brak prices.json — poczekaj na Action lub sprawdź logi.';
      return;
    }
    const data = await resPrices.json();
    const p = data.prices || {};

    // read saved margin (grosze)
    const saved = localStorage.getItem(MARGIN_KEY);
    const marginGrosze = saved !== null ? parseInt(saved,10) : 0;
    document.getElementById('margin').value = marginGrosze;

    function show(id, obj) {
      const el = document.getElementById(id);
      if (!obj || obj.gross === null) el.innerText = 'brak';
      else {
        const base = Number(obj.gross);
        const adjusted = base + (marginGrosze / 100.0);
        el.innerText = adjusted.toFixed(2);
      }
    }

    show('benzyna', p.benzyna);
    show('on', p.on);
    show('op', p.op);

    metaEl.innerText = `Źródło: ${data.source} · pobrano: ${new Date(data.fetched_at).toLocaleString()}`;

    if (resHistory && resHistory.ok) {
      const history = await resHistory.json();
      drawSimpleChart(history);
    } else {
      document.getElementById('chart').innerText = 'Brak historii (poczekaj na pierwszy zapis).';
    }
  } catch (err) {
    console.error(err);
    document.getElementById('meta').innerText = 'Błąd pobierania danych.';
  }
}

function drawSimpleChart(history) {
  if (!Array.isArray(history) || history.length === 0) {
    document.getElementById('chart').innerText = 'Brak danych historycznych.';
    return;
  }
  const N = 30;
  const slice = history.slice(-N);
  const points = slice.map(h => ({
    t: new Date(h.fetched_at),
    v: (h.prices && h.prices.benzyna && typeof h.prices.benzyna.gross === 'number') ? Number(h.prices.benzyna.gross) : null
  }));

  const vals = points.map(p => p.v).filter(v => v !== null);
  if (vals.length === 0) {
    document.getElementById('chart').innerText = 'Brak wartości PB95 w historii.';
    return;
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const width = 560, height = 160, pad = 28;
  const svg = [];
  svg.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
  svg.push(`<rect width="100%" height="100%" fill="transparent"/>`);
  const stepX = (width - pad*2) / (points.length - 1 || 1);
  let path = '';
  points.forEach((pt,i)=>{
    const x = pad + i*stepX;
    const y = pt.v === null ? null : pad + ((max - pt.v)/(max - min || 1))*(height - pad*2);
    if(y===null) return;
    if(path==='') path += `M ${x} ${y}`; else path += ` L ${x} ${y}`;
  });
  svg.push(`<path d="${path}" fill="none" stroke="#0b69ff" stroke-width="2"/>`);
  svg.push(`</svg>`);
  document.getElementById('chart').innerHTML = svg.join('');
}

document.getElementById('saveMargin').addEventListener('click', ()=>{
  const val = parseInt(document.getElementById('margin').value || '0',10) || 0;
  localStorage.setItem(MARGIN_KEY, String(val));
  loadPricesAndHistory();
});

loadPricesAndHistory();
