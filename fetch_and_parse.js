// fetch_and_parse.js - improved price extraction (handles split cells like ["4","80"])
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

// Return array of numeric tokens found in a row cell (strings like "4,80", "4", "80", "4.80", "480")
function findNumericTokensInRow(r) {
  const tokens = [];
  for (const cell of r) {
    // remove currency words, keep digits, comma and dot and spaces
    const cleaned = cell.replace(/[^\d,. ]+/g, ' ').trim();
    if (!cleaned) continue;
    // split on spaces because some cells have "4 80" etc.
    for (const part of cleaned.split(/\s+/)) {
      if (!part) continue;
      // keep if contains digit
      if (/[0-9]/.test(part)) tokens.push(part);
    }
  }
  return tokens;
}

// Try to extract a float price from row r
function extractPriceFromRow(r) {
  // 1) try to find a token with decimal (xx,yy or xx.yy)
  for (const cell of r) {
    const m = cell.match(/(\d{1,2}[.,]\d{1,3})/);
    if (m) {
      const raw = m[1].replace(',', '.');
      const p = parseFloat(raw);
      if (!isNaN(p)) return p;
    }
  }

  // 2) try fallback: if there is a single token like "480" assume it's cents -> 4.80 if length 3/2 heuristic
  const tokens = findNumericTokensInRow(r);
  if (tokens.length === 1) {
    const t = tokens[0].replace(',', '.');
    // if t has no dot/comma but length 3, interpret as 4.80 (480 -> 4.80)
    if (!t.includes('.') && t.length === 3) {
      const p = parseFloat(t) / 100.0;
      if (!isNaN(p)) return p;
    }
    // if it's like "48" maybe 4.8? ambiguous — try divide by 10 if >=10 and <=200
    if (!t.includes('.') && t.length === 2) {
      // heuristic: 48 -> 4.8 if <= 99
      const n = parseInt(t, 10);
      if (!isNaN(n) && n <= 99) return n / 10.0;
    }
    // lastly try direct parse
    const p2 = parseFloat(t);
    if (!isNaN(p2)) return p2;
  }

  // 3) if multiple numeric tokens, try to combine adjacent that look like integer + fractional (e.g. ["4","80"])
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i].replace(',', '.');
    const b = tokens[i+1].replace(',', '.');
    // a integer, b exactly two digits -> combine
    if (/^\d{1,2}$/.test(a) && /^\d{2}$/.test(b)) {
      const combined = `${a}.${b}`;
      const p = parseFloat(combined);
      if (!isNaN(p)) return p;
    }
    // if a has 1-2 digits ending with dot/comma missing, combine
    if (/^\d{1,2}$/.test(a) && /^\d{1,3}$/.test(b)) {
      const combined = `${a}.${b}`;
      const p = parseFloat(combined);
      if (!isNaN(p)) return p;
    }
  }

  return null;
}

function rowsToPrices(rows) {
  const result = { pb95: null, pb98: null, diesel: null, lpg: null };

  for (const r of rows) {
    const joined = r.join(' ').toLowerCase();
    const price = extractPriceFromRow(r);

    // debug log small tokens
    // console.log('ROW TOKENS:', r, '=> price candidate=', price);

    if (/95|pb95|benzyna 95|benzyna95/.test(joined) && price !== null) {
      result.pb95 = price;
      continue;
    }
    if (/98|pb98|benzyna 98|benzyna98/.test(joined) && price !== null) {
      result.pb98 = price;
      continue;
    }
    if (/diesel|olej nap[ęe]dowy|on|olej-napędowy/.test(joined) && price !== null) {
      result.diesel = price;
      continue;
    }
    if (/lpg|autogaz/.test(joined) && price !== null) {
      result.lpg = price;
      continue;
    }

    // fallback: if first cell contains name like "PB95" or "95" etc.
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
    // console.log(tableHtml.slice(0,1200));
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
