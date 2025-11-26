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
    document.getElementById('pb95').innerText = p.pb95 ?? 'brak';
    document.getElementById('pb98').innerText = p.pb98 ?? 'brak';
    document.getElementById('diesel').innerText = p.diesel ?? 'brak';
    document.getElementById('lpg').innerText = p.lpg ?? 'brak';
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
    v: (h.prices && h.prices.pb95) ? Number(h.prices.pb95) : null
  }));

  const vals = points.map(p => p.v).filter(v => v !== null);
  if (vals.length === 0) {
    document.getElementById('chart').innerText = 'Brak wartości PB95 w historii.';
    return;
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);

  const width = 560;
  const height = 160;
  const pad = 28;

  const svgParts = [];
  svgParts.push(`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`);
  svgParts.push(`<rect width="100%" height="100%" fill="transparent"/>`);

  const stepX = (width - pad*2) / (points.length - 1 || 1);
  let path = '';
  points.forEach((pt, i) => {
    const x = pad + i * stepX;
    const y = pt.v === null ? null : pad + ( (max - pt.v) / (max - min || 1) ) * (height - pad*2);
    if (y === null) return;
    if (path === '') path += `M ${x} ${y}`; else path += ` L ${x} ${y}`;
  });

  svgParts.push(`<line x1="${pad}" y1="${pad}" x2="${width-pad}" y2="${pad}" stroke="#eee"/>`);
  svgParts.push(`<line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="#eee"/>`);
  svgParts.push(`<text x="${pad}" y="${pad-6}" font-size="11" fill="#666">${max.toFixed(2)} zł</text>`);
  svgParts.push(`<text x="${pad}" y="${height-6}" font-size="11" fill="#666">${min.toFixed(2)} zł</text>`);
  svgParts.push(`<path d="${path}" fill="none" stroke="#0b69ff" stroke-width="2"/>`);

  points.forEach((pt, i) => {
    if (pt.v === null) return;
    const x = pad + i * stepX;
    const y = pad + ( (max - pt.v) / (max - min || 1) ) * (height - pad*2);
    const t = pt.t.toLocaleString();
    svgParts.push(`<circle cx="${x}" cy="${y}" r="2.5" fill="#0b69ff"><title>${t}: ${pt.v.toFixed(2)} zł</title></circle>`);
  });

  svgParts.push(`</svg>`);
  document.getElementById('chart').innerHTML = svgParts.join('');
}

loadPricesAndHistory();
