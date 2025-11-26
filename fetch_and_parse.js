// fetch_and_parse.js - zapisuje dokładne nazwy paliw z tabeli jako klucze w prices.json
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://spot.lotosspv1.pl/2/hurtowe_ceny_paliw';
const PRICES_FILE = 'prices.json';
const HISTORY_FILE = 'history.json';
const HISTORY_DIR = 'history';
const MAX_HISTORY_ENTRIES = 1000;
const VAT = 1.23;

function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); }
function stripTags(s){ return String(s).replace(/<[^>]*>/g,'').trim(); }
function htmlDecode(s){ return String(s).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); }

function extractTableHtml(html){
  const m = html.match(/<table[\s\S]*?<\/table>/i);
  return m ? m[0] : null;
}
function parseTableRows(tableHtml){
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let tr;
  while((tr = trRe.exec(tableHtml)) !== null){
    const trHtml = tr[0];
    const cells = [];
    const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cell;
    while((cell = cellRe.exec(trHtml)) !== null){
      let txt = stripTags(cell[1]||'');
      txt = htmlDecode(txt).trim();
      cells.push(txt);
    }
    if(cells.length) rows.push(cells);
  }
  return rows;
}

function parseNumericFromCell(cell){
  if(!cell) return null;
  let cleaned = String(cell).replace(/[^\d,.\s]/g,'').trim(); // keep digits, dot, comma, space
  if(!cleaned) return null;
  cleaned = cleaned.replace(/\s+/g,'').replace(/,/g,'.'); // "4 448,00" -> "4448.00"
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Build mapping: key = original name string, value = { raw: number (PLN / 1000L), per_liter, gross }
function rowsToPrices(rows){
  const out = {};
  for(const r of rows){
    // we expect at least two columns: [name, price]
    if(r.length < 2) continue;
    const name = r[0].trim();
    const rawVal = parseNumericFromCell(r[1]);
    if(rawVal === null) {
      // if price cell empty or unparsable, skip but keep key with null values
      out[name] = { raw: null, per_liter: null, gross: null };
      continue;
    }
    const rawRounded = Math.round(rawVal * 100) / 100; // keep 2 decimals
    const per_liter = rawRounded / 1000.0;
    const gross = Math.round(per_liter * VAT * 100000) / 100000; // 5 decimals
    out[name] = { raw: rawRounded, per_liter: per_liter, gross: gross };
  }
  return out;
}

async function fetchHtml(url){
  if(typeof globalThis.fetch !== 'function') throw new Error('No fetch available in Node runtime');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
  if(!res.ok) throw new Error('Fetch failed: ' + res.status);
  return await res.text();
}

(async function main(){
  try{
    console.log('Pobieram', SOURCE_URL);
    const html = await fetchHtml(SOURCE_URL);

    const tableHtml = extractTableHtml(html);
    if(!tableHtml){
      throw new Error('Nie znaleziono tabeli w HTML (tabela mogła być zmieniona lub generowana JS).');
    }

    const rows = parseTableRows(tableHtml);
    console.log('Znaleziono wierszy:', rows.length);

    const scraped = rowsToPrices(rows);
    console.log('Scraped entries:', Object.keys(scraped).length);

    // read old
    let old = null;
    if(fs.existsSync(PRICES_FILE)){
      try{ old = JSON.parse(fs.readFileSync(PRICES_FILE,'utf8')); } catch(e){ old = null; }
    }

    // Build final: keep any old keys too, but prefer scraped values for keys that exist
    const keys = new Set([...(old && old.prices ? Object.keys(old.prices) : []), ...Object.keys(scraped)]);
    const final = {};
    for(const k of keys){
      if(scraped.hasOwnProperty(k)) final[k] = scraped[k];
      else if(old && old.prices && old.prices[k]) final[k] = old.prices[k];
      else final[k] = { raw: null, per_liter: null, gross: null };
    }

    const payload = { source: SOURCE_URL, fetched_at: new Date().toISOString(), prices: final };

    // compare by gross per key
    function pricesEqual(a={}, b={}){
      const ks = new Set([...Object.keys(a||{}), ...Object.keys(b||{})]);
      for(const k of ks){
        const ga = a[k] && typeof a[k].gross === 'number' ? a[k].gross : null;
        const gb = b[k] && typeof b[k].gross === 'number' ? b[k].gross : null;
        if((ga === null) !== (gb === null)) return false;
        if(ga !== null && gb !== null && Math.abs(ga - gb) > 1e-6) return false;
      }
      return true;
    }

    if(old && pricesEqual(old.prices, final)){
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
    if(fs.existsSync(HISTORY_FILE)){
      try{ history = JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')) || []; } catch(e){ history = []; }
    }
    history.push(payload);
    if(history.length > MAX_HISTORY_ENTRIES) history = history.slice(history.length - MAX_HISTORY_ENTRIES);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log('Zaktualizowano', HISTORY_FILE, 'entries:', history.length);

    process.exit(0);
  }catch(err){
    console.error('Błąd:', err.message || err);
    process.exit(1);
  }
})();
