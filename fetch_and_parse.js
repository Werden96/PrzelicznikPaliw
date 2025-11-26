// fetch_and_parse.js - minimal, zero deps
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://spot.lotosspv1.pl/2/hurtowe_ceny_paliw';
const PRICES_FILE = 'prices.json';
const HISTORY_FILE = 'history.json';
const HISTORY_DIR = 'history';
const MAX_HISTORY_ENTRIES = 1000;

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function htmlDecode(s) {
  // prosty decode dla najczęstszych encji
  return s.replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
}

function extractTableHtml(html) {
  const m = html.match(/<table[\s\S]*?<\/table>/i);
  return m ? m[0] : null;
}

function parseTableRows(tableHtml) {
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(tableHtml)) !== null) {
    const trHtml = tr[0];
    const cells = [];
    const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cell;
    while ((cell = cellRe.exec(trHtml)) !== null) {
      let txt = cell[1] || '';
      txt = stripTags(txt);
      txt = htmlDecode(txt);
      txt = txt.replace(/\u00A0/g, ' ').trim();
      cells.push(txt);
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function rowsToPrices(rows) {
  const result = { pb95: null, pb98: null, diesel: null, lpg: null };
  for (const r of rows) {
    const joined = r.join(' ').toLowerCase();
    // try to find first price-looking token in row
    const priceToken = r.find(c => /(\d{1,2}[.,]\d{2})/.test(c));
    const rawPrice = priceToken ? (priceToken.match(/(\d{1,2}[.,]\d{2})/)[0].replace(',', '.')) : null;
    const price = rawPrice ? parseFloat(rawPrice) : null;

    // heurystyka nazw
    if (/95|pb95|benzyna 95/.test(joined) && price !== null) result.pb95 = price;
    else if (/98|pb98|benzyna 98/.test(joined) && price !== null) result.pb98 = price;
    else if (/diesel|olej nap[ęe]dowy|on/.test(joined) && price !== null) result.diesel = price;
    else if (/lpg|autogaz/.test(joined) && price !== null) result.lpg = price;
    else if (r.length >= 2 && price !== null) {
      // często: [nazwa, cena]
      const name = r[0].toLowerCase();
      if (/95/.test(name) && result.pb95 === null) result.pb95 = price;
      if (/98/.test(name) && result.pb98 === null) result.pb98 = price;
      if (/diesel|on/.test(name) && result.diesel === null) result.diesel = price;
      if (/lpg/.test(name) && result.lpg === null) result.lpg = price;
    }
  }
  return result;
}

async function fetchHtml(url) {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('No fetch available in this Node runtime');
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  return await res.text();
}

(async function main(){
  try {
    console.log('Pobieram', SOURCE_URL);
    const html = await fetchHtml(SOURCE_URL);
    const tableHtml = extractTableHtml(html);
    if (!tableHtml) {
      throw new Error('Nie znaleziono tabeli w HTML');
    }
    const rows = parseTableRows(tableHtml);
    const prices = rowsToPrices(rows);
    const payload = { source: SOURCE_URL, fetched_at: new Date().toISOString(), prices };

    // read old
    let old = null;
    if (fs.existsSync(PRICES_FILE)) {
      try { old = JSON.parse(fs.readFileSync(PRICES_FILE,'utf8')); } catch(e){ old = null; }
    }

    function pricesEqual(a={}, b={}) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        const va = a[k] === null ? null : Number(a[k]);
        const vb = b[k] === null ? null : Number(b[k]);
        if ((va === null) !== (vb === null)) return false;
        if (va !== null && vb !== null && Math.abs(va - vb) > 1e-6) return false;
      }
      return true;
    }

    if (old && pricesEqual(old.prices, prices)) {
      console.log('Ceny bez zmian — brak zapisu.');
      process.exit(0);
    }

    fs.writeFileSync(PRICES_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Zapisano', PRICES_FILE);

    ensureDir(HISTORY_DIR);
    const tsSafe = new Date().toISOString().replace(/[:.]/g,'-');
    const backupFile = path.join(HISTORY_DIR, `prices-${tsSafe}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Zapisano backup:', backupFile);

    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try { history = JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')); } catch(e){ history = []; }
    }
    history.push(payload);
    if (history.length > MAX_HISTORY_ENTRIES) history = history.slice(history.length - MAX_HISTORY_ENTRIES);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log('Zaktualizowano', HISTORY_FILE, 'entries:', history.length);

    process.exit(0);
  } catch (err) {
    console.error('Błąd:', err.message || err);
    process.exit(1);
  }
})();
