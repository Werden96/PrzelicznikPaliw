// fetch_and_parse.js - final: extract raw (PLN/1000L), per_liter, gross (= per_liter*1.23)
// maps rows to keys: benzyna, on, op
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://spot.lotosspv1.pl/2/hurtowe_ceny_paliw'; // używamy źródła, z którego pracowaliśmy
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
  let cleaned = String(cell).replace(/[^\d,.\s]/g,'').trim();
  if(!cleaned) return null;
  cleaned = cleaned.replace(/\s+/g,'').replace(/,/g,'.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function rowsToPrices(rows){
  // returns object { benzyna: {raw, per_liter, gross}, on:..., op:... }
  const out = {};
  for(const r of rows){
    if(r.length < 2) continue;
    const name = r[0].toLowerCase();
    const rawVal = parseNumericFromCell(r[1]); // e.g. 4448.00
    if(rawVal === null) continue;

    // map row -> key
    let key = null;
    if(name.includes('95') || name.includes('benzyna')) key = 'benzyna';
    else if(name.includes('napędowy') || name.includes('eurodiesel') || name.includes('diesel') || name.includes('on')) {
      // prefer normal diesel as 'on'; keep OP (olej opałowy) separate below when name contains 'opał' or 'do celów opałowych'
      if(name.includes('opał') || name.includes('op') || name.includes('opal')) key = 'op';
      else key = 'on';
    } else if(name.includes('opal') || name.includes('opał')) key = 'op';
    else if(name.includes('lpg')||name.includes('autogaz')) key = 'lpg';

    if(!key) continue;

    const rawRounded = Math.round(rawVal * 100) / 100; // keep two decimals if any
    const per_liter = rawRounded / 1000.0;
    const gross = Math.round(per_liter * VAT * 100000) / 100000; // keep 5 decimals for safety

    out[key] = { raw: rawRounded, per_liter: per_liter, gross: gross };
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
      throw new Error('Nie znaleziono tabeli w HTML (strona mogła zmienić strukturę).');
    }

    const rows = parseTableRows(tableHtml);
    console.log('Znaleziono wierszy:', rows.length);

    const scraped = rowsToPrices(rows);
    console.log('Scraped:', scraped);

    // read old
    let old = null;
    if(fs.existsSync(PRICES_FILE)){
      try{ old = JSON.parse(fs.readFileSync(PRICES_FILE,'utf8')); } catch(e){ old = null; }
    }

    // Build final object merging old keys to keep stable shape
    const keys = new Set([...Object.keys(scraped), ...(old && old.prices ? Object.keys(old.prices) : [])]);
    const final = {};
    for(const k of keys){
      if(scraped[k]) final[k] = scraped[k];
      else if(old && old.prices && old.prices[k]) final[k] = old.prices[k];
      else final[k] = { raw: null, per_liter: null, gross: null };
    }

    const payload = { source: SOURCE_URL, fetched_at: new Date().toISOString(), prices: final };

    // compare by gross values
    function pricesEqual(a={}, b={}){
      const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
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
      try{ history = JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'))||[]; } catch(e){ history = []; }
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
