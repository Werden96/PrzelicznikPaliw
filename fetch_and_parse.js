// fetch_and_parse.js
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://spot.lotosspv1.pl/2/hurtowe_ceny_paliw';
const PRICES_FILE = 'prices.json';
const HISTORY_FILE = 'history.json';
const HISTORY_DIR = 'history';
const MAX_HISTORY_ENTRIES = 1000;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseTableRowsToPrices(rows) {
  const result = { pb95: null, pb98: null, diesel: null, lpg: null };
  for (const r of rows) {
    if (!r || r.length === 0) continue;
    const text = r.join(' ').toLowerCase();
    // find price token
    const priceMatch = r.find(cell => /(\d{1,2}[.,]\d{2})/.test(cell));
    const rawPrice = priceMatch ? priceMatch.match(/(\d{1,2}[.,]\d{2})/)[0].replace(',', '.') : null;
    const price = rawPrice ? parseFloat(rawPrice) : null;

    if (/95|pb95|benzyna 95/.test(text) && price !== null) result.pb95 = price;
    else if (/98|pb98|benzyna 98/.test(text) && price !== null) result.pb98 = price;
    else if (/diesel|olej napędowy|on/.test(text) && price !== null) result.diesel = price;
    else if (/lpg|autogaz/.test(text) && price !== null) result.lpg = price;
    else if (r.length >= 2) {
      const name = r[0].toLowerCase();
      const maybePrice = r[1].replace(',', '.').replace(/[^\d.]/g,'');
      const p = maybePrice ? parseFloat(maybePrice) : null;
      if (p !== null) {
        if (/95/.test(name) && result.pb95 === null) result.pb95 = p;
        if (/98/.test(name) && result.pb98 === null) result.pb98 = p;
        if (/diesel|on/.test(name) && result.diesel === null) result.diesel = p;
        if (/lpg/.test(name) && result.lpg === null) result.lpg = p;
      }
    }
  }
  return result;
}

async function fetchHtml(url) {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Global fetch not available in this Node. Use Node 18+ or Actions runner.');
  }
  const resp = await globalThis.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceFetcher/1.0)' },
    redirect: 'follow'
  });
  if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);
  return await resp.text();
}

function pricesEqual(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k] === null ? null : Number(a[k]);
    const vb = b[k] === null ? null : Number(b[k]);
    if ((va === null) !== (vb === null)) return false;
    if (va !== null && vb !== null && Math.abs(va - vb) > 1e-6) return false;
  }
  return true;
}

async function main() {
  try {
    console.log('Pobieram', SOURCE_URL);
    const html = await fetchHtml(SOURCE_URL);
    const $ = cheerio.load(html);

    const table = $('table').first();
    if (!table || table.length === 0) {
      throw new Error('Nie znaleziono tabeli na stronie');
    }

    const rows = [];
    table.find('tr').each((i, tr) => {
      const cells = [];
      $(tr).find('th,td').each((j, td) => {
        cells.push($(td).text().trim());
      });
      if (cells.length) rows.push(cells);
    });

    const prices = parseTableRowsToPrices(rows);
    const payload = {
      source: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      prices
    };

    // read old
    let old = null;
    if (fs.existsSync(PRICES_FILE)) {
      try { old = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8')); } catch(e){ old = null; }
    }

    if (old && pricesEqual(old.prices, prices)) {
      console.log('Ceny nie zmieniły się — brak zapisu.');
      process.exit(0);
    }

    fs.writeFileSync(PRICES_FILE, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Zapisano', PRICES_FILE);

    ensureDir(HISTORY_DIR);
    const tsSafe = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(HISTORY_DIR, `prices-${tsSafe}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Zapisano backup:', backupFile);

    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch(e){ history = []; }
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
}

main();
