// fetch_and_parse.js - improved parsing for "4 448,00" format and PLN/1000L -> divide by 1000
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

// Clean a cell string and try to extract a numeric value.
// Handles "4 448,00", "4448,00", "4.448,00", "4,448.00", etc.
// Returns float or null.
function parseNumericFromCell(cell) {
  if (!cell || typeof cell !== 'string') return null;
  // remove non digit, comma, dot, and space characters
  let cleaned = cell.replace(/[^\d,.\s]/g, '').trim();
  if (!cleaned) return null;
  // remove spaces that are thousands separators: "4 448,00" -> "4448,00"
  cleaned = cleaned.replace(/\s+/g, '');
  // replace comma with dot for decimal
  cleaned = cleaned.replace(/,/g, '.');
  // now parse
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  // Heuristic: if value looks like price-per-1000L (>=1000), convert to per liter:
  // e.g. 4448 -> 4.448
  if (Math.abs(n) >= 1000) return n / 1000.0;
  // if extremely large (>=100), consider dividing by 100 or 1000? we avoid guessing here.
  return n;
}

// Return array of numeric tokens found in a row cell (strings like "4,80", "4", "80", "4.80", "480")
function findNumericTokensInRow(r) {
  const tokens = [];
  for (const cell of r) {
    const cleaned = String(cell).replace(/[^\d,. ]+/g, ' ').trim();
    if (!cleaned) continue;
    for (const part of cleaned.split(/\s+/)) {
      if (!part) continue;
      if (/[0-9]/.test(part)) tokens.push(part);
    }
  }
  return tokens;
}

function extractPriceFromRow(r) {
  // 1) Try to parse any individual cell directly (handles "4 448,00")
  for (const cell of r) {
    const tryNum = parseNumericFromCell(cell);
    if (tryNum !== null) return tryNum;
  }

  // 2) Fallback: tokens logic (split across cells)
  const tokens = findNumericTokensInRow(r);
  if (tokens.length === 0) return null;

  // If single token like "480" -> try heuristics
  if (tokens.length === 1) {
    const t = tokens[0].replace(',', '.');
    if (!t.includes('.') && t.length === 3) {
      const p = parseFloat(t) / 100.0; // 480 -> 4.80
      if (!isNaN(p)) return p;
    }
    if (!t.includes('.') && t.length === 2) {
      const n = parseInt(t, 10);
      if (!isNaN(n) && n <= 99) return n / 10.0; // 48 -> 4.8 heuristic (kept for legacy)
    }
    const direct = parseFloat(t);
    if (!isNaN(direct)) return direct;
  }

  // 3) If multiple tokens, try combine adjacent like "4" + "448,00"
  for (let i = 0; i < tokens.length; i++) {
    // try combine tokens from i up to i+2
    let comb = '';
    for (let j = i; j < Math.min(tokens.length, i + 3); j++) {
      comb += tokens[j];
    }
    // clean combined and try parse
    const cleaned = comb.replace(/\s+/g, '').replace(/,/g, '.');
    const val = parseFloat(cleaned);
    if (!isNaN(val)) {
      if (Math.abs(val) >= 1000) return val / 1000.0;
      return val;
    }
  }

  return null;
}

function rowsToPrices(rows) {
  const result = { pb95: null, pb98: null, diesel: null, lpg: null };

  for (const r of rows) {
    const joined = r.join(' ').toLowerCase();
    const price = extractPriceFromRow(r);

    // debugging: log tokens when price is found
    // console.log('DEBUG ROW:', r, '=> price', price);

    if (/95|pb95|benzyna 95|benzyna95/.test(joined) && price !== null) {
      result.pb95 = price;
      continue;
    }
    if (/98|pb98|benzyna 98|benzyna98/.test(joined) && price !== null) {
      result.pb98 = price;
      continue;
    }
    if (/diesel|olej nap[ęe]dowy|on|olej-napędowy/.test(joined) && price !== null) {
      // prefer first diesel-like for diesel
      if (result.diesel === null) result.diesel = price;
      continue;
    }
    if (/lpg|autogaz/.test(joined) && price !== null) {
      result.lpg = price;
      continue;
    }

    // fallback: if first cell contains name like "PB95" etc.
    if (r.length >= 2 && price !== null) {
      const name = r[0].toLowerCase();
      if (/95/.test(name) && result.pb95 === null) result.pb95 = price;
      else if (/98/.test(name) && result.pb98 === null) result.pb98 = price;
      else if (/diesel|on/.test(name) && result.diesel === null) result.diesel = price;
      else if (/lpg/.test(name) && result.lpg === null) result.lpg = price;
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

    // debug: small sample
    console.log('--- HTML fragment ---');
    console.log((html.slice(0,2000).replace(/\n/g,'\\n')).slice(0,1200));
    console.log('--- koniec fragmentu ---');

    const tableHtml = extractTableHtml(html);
    if (!tableHtml) {
      console.error('Nie znaleziono tabeli w HTML - tabela może być generowana po stronie klienta (JS).');
      const low = html.toLowerCase();
      console.log('Token counts:', {
        '95': (low.match(/95/g)||[]).length,
        'benzyna': (low.match(/benzyna/g)||[]).length,
        'diesel': (low.match(/diesel|olej nap/g)||[]).length,
        'lpg': (low.match(/lpg|autogaz/g)||[]).length
      });
      process.exit(1);
    }

    console.log('Tabela znaleziono - parsuję wiersze (fragment):');
    const rows = parseTableRows(tableHtml);
    console.log('Liczba wierszy:', rows.length);
    for (let i=0;i<Math.min(12, rows.length); i++) {
      console.log(i, JSON.stringify(rows[i]));
    }

    const prices = rowsToPrices(rows);
    console.log('Wynik parsowania (raw):', JSON.stringify(prices));

    const payload = { source: SOURCE_URL, fetched_at: new Date().toISOString(), prices };

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

    if (old === null) {
      console.log('Brak wcześniejszego prices.json — zapisuję pierwszy wpis.');
    } else if (pricesEqual(old.prices, prices)) {
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
