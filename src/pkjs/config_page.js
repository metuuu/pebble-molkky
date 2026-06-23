// =============================================================================
// config_page.js — builds the settings webview the Core Devices app opens for
// Mölkky (the gear icon). Self-contained: the whole page is a data: URL, so no
// hosting is needed. PKJS injects two pre-built strings — the decoded,
// human-readable games (for viewing) and the raw lossless snapshot (for export)
// — and the page is pure presentation.
//
// View  : read the decoded JSON.
// Export: copy the raw snapshot JSON (this is what Import consumes — lossless).
// Import: paste a snapshot, then Merge (union by seq) or Replace (overwrite).
//
// Actions return to the app via `pebblejs://close#<encoded JSON>`, picked up by
// the `webviewclosed` handler in index.js.
// =============================================================================

// Inject a JS string literal safely (also neutralises </script>).
function jsStr(s) {
  return JSON.stringify(String(s)).replace(/</g, '\\u003c');
}

var TEMPLATE =
'<!doctype html><meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<style>' +
'body{font:15px/1.4 -apple-system,Roboto,sans-serif;margin:0;padding:16px;' +
'background:#f5f5f7;color:#1c1c1e}' +
'h1{font-size:19px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px}' +
'.muted{color:#6b6b70;font-size:13px;margin:0 0 8px}' +
'textarea{width:100%;box-sizing:border-box;font:12px/1.35 ui-monospace,Menlo,monospace;' +
'border:1px solid #d0d0d5;border-radius:8px;padding:8px;background:#fff;resize:vertical}' +
'button{font-size:15px;padding:10px 14px;margin:6px 6px 0 0;border:0;border-radius:8px;' +
'background:#007aff;color:#fff}button.alt{background:#e3e3e8;color:#1c1c1e}' +
'button.warn{background:#ff3b30}' +
'.row{margin-top:4px}' +
'table{border-collapse:collapse;width:100%;font-size:13px;margin-top:4px}' +
'th,td{text-align:right;padding:4px 6px;border-bottom:1px solid #e3e3e8}' +
'th:first-child,td:first-child{text-align:left}' +
'</style>' +
'<h1>Mölkky history</h1>' +
'<p class="muted" id="count"></p>' +

'<h2>Player stats</h2>' +
'<p class="muted">Lifetime totals from the full archive. Players show as #id ' +
'(names live on the watch). G = games, Acc = accuracy, Pts = points per turn.</p>' +
'<div id="stats"></div>' +

'<h2>View</h2>' +
'<p class="muted">Decoded games. Players show as #id (names live on the watch).</p>' +
'<textarea id="view" rows="10" readonly></textarea>' +

'<h2>Export (backup)</h2>' +
'<p class="muted">Copy this and keep it safe. It is the exact data Import expects.</p>' +
'<textarea id="raw" rows="6" readonly></textarea>' +
'<div class="row"><button id="copy" class="alt">Copy to clipboard</button></div>' +

'<h2>Import (restore)</h2>' +
'<p class="muted">Paste a backup, then merge it in or replace everything.</p>' +
'<textarea id="imp" rows="6" placeholder="Paste exported JSON here"></textarea>' +
'<div class="row">' +
'<button id="merge">Merge</button>' +
'<button id="replace" class="warn">Replace all</button>' +
'<button id="done" class="alt">Done</button>' +
'</div>' +

'<script>' +
'var DECODED=__DECODED__,RAW=__RAW__,COUNT=__COUNT__,STATS=__STATS__;' +
'document.getElementById("view").value=DECODED;' +
'document.getElementById("raw").value=RAW;' +
'document.getElementById("count").textContent=COUNT+" game(s) stored";' +
'(function(){var el=document.getElementById("stats");' +
'if(!STATS.length){el.textContent="No games played yet.";return;}' +
'var h="<table><tr><th>Player</th><th>G</th><th>Win%</th><th>Acc%</th><th>Pts</th><th>Place</th></tr>";' +
'for(var i=0;i<STATS.length;i++){var p=STATS[i];' +
'h+="<tr><td>#"+p.id+"</td><td>"+p.games+"</td><td>"+p.winPct+"</td><td>"+p.accuracyPct+"</td><td>"+p.avgPoints+"</td><td>"+p.avgPlace+"</td></tr>";}' +
'el.innerHTML=h+"</table>";})();' +
'function close(o){location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify(o));}' +
'document.getElementById("copy").onclick=function(){' +
'var t=document.getElementById("raw");t.focus();t.select();' +
'try{document.execCommand("copy");this.textContent="Copied";}catch(e){this.textContent="Select all & copy";}};' +
'function doImport(mode){' +
'var v=document.getElementById("imp").value.trim();' +
'if(!v){alert("Paste a backup first.");return;}' +
'try{JSON.parse(v);}catch(e){alert("That is not valid JSON.");return;}' +
'if(mode==="replace"&&!confirm("Replace ALL stored games with the pasted data?"))return;' +
'close({action:"import",mode:mode,raw:v});}' +
'document.getElementById("merge").onclick=function(){doImport("merge");};' +
'document.getElementById("replace").onclick=function(){doImport("replace");};' +
'document.getElementById("done").onclick=function(){close({action:"none"});};' +
'</script>';

// decodedJson / rawJson are already-stringified JSON (embedded as string literals
// and shown verbatim in textareas); statsJson is a stringified array embedded as
// a live JS value (numbers only, so no </script> risk); count is a number.
function buildUrl(decodedJson, rawJson, statsJson, count) {
  var html = TEMPLATE
    .replace('__DECODED__', jsStr(decodedJson))
    .replace('__RAW__', jsStr(rawJson))
    .replace('__STATS__', function () { return statsJson || '[]'; })  // fn arg: no $ substitution
    .replace('__COUNT__', String(count | 0));
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = { buildUrl: buildUrl };
