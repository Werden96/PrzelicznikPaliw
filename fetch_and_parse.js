// fetch_and_parse.js - zapisuje tylko bieżące nazwy z tabeli (NO MERGE)
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
  let cleaned = String(cell).replace(/[^\d,.\s]/g,'').trim();
  if(!cleaned) return null;
  cleaned = cleaned.replace(/\s+/g,'').replace(/,/g,'.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function isHeaderLike(name){
  if(!name) return false;
  const s = String(name).trim().toLowerCase();
  return s === 'paliwo' || s === 'cena' || s === 'produkt' || s === '';
}

function rowsToPrices(rows){
  const out = {};
  for(const r of rows){
    if(r.length < 2) continue;
    const name = r[0].trim();
    if(isHeaderLike(name)) continue;
    const rawVal = parseNumericFromCell(r[1]);
    if(rawVal === null){
      out[name] = { raw: null, per_liter: null, gross: null };
      continue;
    }
    const rawRounded = Math.round(rawVal * 100) / 100;
    const per_liter = rawRounded / 1000.0;
    const gross = Math.round(per_liter * VAT * 100000) / 100000;
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

(function safeWriteSync(file, data){
  try { fs.writeFileSync(file, data, 'utf8'); return true; } catch(e) { console.error('Write error', e); return false; }
});

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
    const scrapedKeys = Object.keys(scraped);
    console.log('Sparsowane klucze:', scrapedKeys);

    if(scrapedKeys.length === 0){
      console.log('Brak sensownych wpisów w tabeli — nie nadpisuję prices.json (safe mode).');
      process.exit(0);
    }

    // payload contains ONLY scraped keys (no merge)
    const payload = { source: SOURCE_URL, fetched_at: new Date().toISOString(), prices: {} };
    for(const k of scrapedKeys) payload.prices[k] = scraped[k];

    safeWriteSync(PRICES_FILE, JSON.stringify(payload, null, 2));
    console.log('Zapisano', PRICES_FILE);

    ensureDir(HISTORY_DIR);
    const tsSafe = new Date().toISOString().replace(/[:.]/g,'-');
    const backupFile = path.join(HISTORY_DIR, `prices-${tsSafe}.json`);
    safeWriteSync(backupFile, JSON.stringify(payload, null, 2));
    console.log('Zapisano backup:', backupFile);

    let history = [];
    if(fs.existsSync(HISTORY_FILE)){
      try{ history = JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')) || []; } catch(e){ history = []; }
    }
    history.push(payload);
    if(history.length > MAX_HISTORY_ENTRIES) history = history.slice(history.length - MAX_HISTORY_ENTRIES);
    safeWriteSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log('Zaktualizowano', HISTORY_FILE, 'entries:', history.length);

    process.exit(0);
  }catch(err){
    console.error('Błąd:', err.message || err);
    process.exit(1);
  }
})();