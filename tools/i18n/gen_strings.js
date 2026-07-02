#!/usr/bin/env node
// Generate src/c/app/strings.{h,c} from tools/i18n/translations.csv.
//
// The CSV is the single source of truth for the app's translations. Run this
// whenever it changes:
//
//     node tools/i18n/gen_strings.js        # or: npm run strings
//
// CSV format (UTF-8):
//     id,en,fi[,<more langs>]
//   * The first language column is the base (index 0): it backs any missing
//     translation and is the app's default until a saved/seeded language applies.
//   * String rows have an id like STR_NEW_GAME. An empty cell means "no
//     translation" -> falls back to the base language at runtime.
//   * Meta rows (id starts with '@') describe each language, not a string:
//         @autonym      the language's own name, shown in the picker
//         @sys_locale   ISO code matched against i18n_get_system_locale()
//                       (empty -> the platform has no such locale, e.g. Finnish)
//         @month_01..12 month names for the %b/%B date spec; if a language leaves
//                       them all empty it formats dates numerically (months=NULL)
//
// Cells hold natural text (real newlines, real quotes); this script C-escapes
// them. printf specifiers (%d, %s, %%) and strftime specifiers pass through.
//
// Output:
//   * src/c/app/strings.{h,c} — the StrId enum and locale registration.
//   * resources/data/locale_<lang>.bin — each language's strings packed into a
//     blob that ships as a raw resource (kept out of the 64 KB RAM image; loaded
//     to the heap on demand). Every language needs a matching package.json entry:
//         { "type": "raw", "name": "LOCALE_<LANG>", "file": "data/locale_<lang>.bin" }
//     This script warns if one is missing.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.normalize(path.join(__dirname, '..', '..'));
const CSV_PATH = path.join(ROOT, 'tools', 'i18n', 'translations.csv');
const OUT_H = path.join(ROOT, 'src', 'c', 'app', 'strings.h');
const OUT_C = path.join(ROOT, 'src', 'c', 'app', 'strings.c');
// Packed string blobs ship as raw resources (the resource region is separate
// from the 64 KB-capped RAM image, so full per-language tables fit there).
const RES_DIR = path.join(ROOT, 'resources', 'data');
const ABSENT = 0xFFFF;   // offset sentinel for an untranslated entry (→ base fallback)

const BANNER = '// GENERATED FILE — do not edit by hand.\n' +
               '// Source: tools/i18n/translations.csv\n' +
               '// Regenerate: node tools/i18n/gen_strings.js  (or: npm run strings)\n';


function cEscape(s) {
  let out = '';
  for (const ch of s) {
    if (ch === '\\')      out += '\\\\';
    else if (ch === '"')  out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') continue;
    else                  out += ch;
  }
  return out;
}


function die(msg) {
  process.stderr.write(`gen_strings: error: ${msg}\n`);
  process.exit(1);
}


// Minimal RFC 4180 parser: quoted fields may hold commas, doubled quotes, and
// real newlines. Matches Python csv.reader's behavior on well-formed input.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; }
        else { inQuotes = false; i += 1; }
      } else { field += ch; i += 1; }
    } else if (ch === '"' && field === '') { inQuotes = true; i += 1; }
    else if (ch === ',')  { endField(); i += 1; }
    else if (ch === '\n') { endRow(); i += 1; }
    else if (ch === '\r') { endRow(); i += (text[i + 1] === '\n') ? 2 : 1; }
    else { field += ch; i += 1; }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}


function buildPack(strings, lang, base) {
  // Pack a language's strings: u16 count, u16 offset[count] (0xFFFF = absent),
  // then a blob of NUL-terminated UTF-8 strings. Identical strings share a slot.
  const chunks = [];
  const offsets = [];
  const dedup = new Map();
  let blobLen = 0;
  for (const [, vals] of strings) {
    const txt = vals[lang];
    if (lang !== base && txt === '') {
      offsets.push(ABSENT);                    // untranslated -> base fallback
      continue;
    }
    const raw = Buffer.concat([Buffer.from(txt, 'utf8'), Buffer.from([0])]);
    const key = raw.toString('latin1');
    let off = dedup.get(key);
    if (off === undefined) {
      off = blobLen;
      if (off >= ABSENT) die(`packed strings for '${lang}' exceed 64 KB`);
      dedup.set(key, off);
      chunks.push(raw);
      blobLen += raw.length;
    }
    offsets.push(off);
  }
  const head = Buffer.alloc(2 + 2 * offsets.length);
  head.writeUInt16LE(offsets.length, 0);
  offsets.forEach((o, idx) => head.writeUInt16LE(o, 2 + 2 * idx));
  return Buffer.concat([head, ...chunks]);
}


function main() {
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  if (!rows.length) die('empty CSV');

  const header = rows[0];
  if (header[0] !== 'id' || header.length < 2)
    die("first column must be 'id', followed by one column per language");
  const langs = header.slice(1);           // e.g. ['en', 'fi']
  const cols = {};
  langs.forEach((lang, i) => { cols[lang] = i + 1; });

  const meta = new Map();                  // "metakey\x00lang" -> value
  const strings = [];                      // [[STR_id, {lang: text}]]
  const seen = new Set();
  for (const r of rows.slice(1)) {
    if (!r.length || !r[0].trim()) continue;
    const rid = r[0].trim();
    // Normalize embedded newlines: CSV cells edited on different platforms
    // carry CRLF, but the watch renders '\n' — a stray '\r' is just an
    // unknown glyph. Keeps the packs identical however the CSV was saved.
    const vals = {};
    for (const lang of langs) {
      vals[lang] = (cols[lang] < r.length ? r[cols[lang]] : '')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }
    if (rid.startsWith('@')) {
      for (const lang of langs) meta.set(`${rid}\x00${lang}`, vals[lang]);
      continue;
    }
    if (!rid.startsWith('STR_') || !/^[A-Za-z0-9]+$/.test(rid.slice(4).replace(/_/g, '')))
      die(`bad string id '${rid}' (must look like STR_FOO)`);
    if (seen.has(rid)) die(`duplicate id '${rid}'`);
    seen.add(rid);
    strings.push([rid, vals]);
  }

  const base = langs[0];
  for (const [rid, vals] of strings) {
    if (!vals[base]) die(`string '${rid}' has no ${base} (base-language) text`);
  }

  // ---- strings.h -------------------------------------------------------
  const h = [BANNER, '#pragma once', '#include "c/lib/locale/locale.h"', ''];
  h.push('// One id per translatable string; the tables ship as packed resources');
  h.push('// (see gen_strings.js). Call sites use t(id) / tfmt(buf, n, id, ...) /');
  h.push('// tdate(buf, n, id, time).');
  h.push('typedef enum {');
  for (const [rid] of strings) h.push(`  ${rid},`);
  h.push('  STR__COUNT,');
  h.push('} StrId;');
  h.push('');
  h.push('// Register the locale tables. Call once at startup, before any lookup.');
  h.push('void mk_locale_init(void);');
  h.push('');
  h.push('#define t(id)                   locale_str(id)');
  h.push('#define tfmt(buf, n, id, ...)   locale_format((buf), (n), (id), __VA_ARGS__)');
  h.push('#define tdate(buf, n, id, time) locale_strftime((buf), (n), (id), (time))');
  h.push('');
  write(OUT_H, h.join('\n'));

  const cident = (lang) => lang.toUpperCase().replace(/-/g, '_');

  // ---- packed string blobs (shipped as raw resources) -----------------
  fs.mkdirSync(RES_DIR, { recursive: true });
  const packs = {};
  for (const lang of langs) packs[lang] = buildPack(strings, lang, base);
  for (const lang of langs) {
    fs.writeFileSync(path.join(RES_DIR, `locale_${lang}.bin`), packs[lang]);
  }

  const cBytes = (data) => {
    // 16 bytes per line, comma-separated ints
    const lines = [];
    for (let i = 0; i < data.length; i += 16) {
      const hex = Array.from(data.subarray(i, i + 16),
                             (b) => '0x' + b.toString(16).padStart(2, '0'));
      lines.push('  ' + hex.join(', ') + ',');
    }
    return lines.join('\n');
  };

  // ---- strings.c -------------------------------------------------------
  const c = [BANNER, '#include "strings.h"', '#ifdef PBL_SDK_3', '#include <pebble.h>',
             '#endif', ''];

  // month tables (only for languages that supply names). These stay compiled in
  // (12 short pointers) so locale_strftime can format %b/%B without a load.
  const monthKeys = [];
  for (let k = 1; k <= 12; k++) monthKeys.push('@month_' + String(k).padStart(2, '0'));
  const langMonths = {};
  for (const lang of langs) {
    const vals = monthKeys.map((mk) => meta.get(`${mk}\x00${lang}`) || '');
    if (vals.some((v) => v)) {
      const name = `${cident(lang)}_MONTHS`;
      langMonths[lang] = name;
      c.push(`static const char *const ${name}[12] = {`);
      c.push('  ' + vals.map((v) => `"${cEscape(v)}"`).join(', ') + ',');
      c.push('};');
      c.push('');
    }
  }

  // On the watch the packed blobs ride in resources; embed them only for host
  // builds (which have no resource system) so the engine and tests can index
  // them directly. The bytes are identical to resources/data/locale_<lang>.bin.
  c.push('#ifndef PBL_SDK_3');
  for (const lang of langs) {
    c.push(`static const uint8_t ${cident(lang)}_PACK[] = {`);
    c.push(cBytes(packs[lang]));
    c.push('};');
  }
  c.push('#endif');
  c.push('');

  // locale set
  c.push('// Index 0 is the base locale: it backs untranslated entries and is the default.');
  c.push('static const Locale LOCALES[] = {');
  for (const lang of langs) {
    const autonym = cEscape(meta.get(`@autonym\x00${lang}`) || lang);
    const sysloc = meta.get(`@sys_locale\x00${lang}`) || '';
    const sysField = sysloc ? `"${cEscape(sysloc)}"` : 'NULL';
    const monthsField = langMonths[lang] || 'NULL';
    c.push('#ifdef PBL_SDK_3');
    c.push(`  { .autonym = "${autonym}", .sys_locale = ${sysField}, .months = ${monthsField}, .resource_id = RESOURCE_ID_LOCALE_${cident(lang)} },`);
    c.push('#else');
    c.push(`  { .autonym = "${autonym}", .sys_locale = ${sysField}, .months = ${monthsField}, .pack = ${cident(lang)}_PACK },`);
    c.push('#endif');
  }
  c.push('};');
  c.push('');
  c.push('void mk_locale_init(void) {');
  c.push('  locale_init(LOCALES, (int)(sizeof LOCALES / sizeof LOCALES[0]), STR__COUNT, 0);');
  c.push('}');
  c.push('');
  write(OUT_C, c.join('\n'));

  // Each language needs a matching raw resource in package.json:
  //   { "type": "raw", "name": "LOCALE_<LANG>", "file": "data/locale_<lang>.bin" }
  checkResources(langs, cident);

  let miss = 0;
  for (const [, vals] of strings) {
    for (const lang of langs.slice(1)) if (!vals[lang]) miss += 1;
  }
  console.log(`gen_strings: ${strings.length} strings x ${langs.length} languages -> ` +
              `strings.{h,c} + ${langs.length} resource blob(s)` +
              (miss ? `  (${miss} untranslated -> English fallback)` : ''));
}


function checkResources(langs, cident) {
  // Warn if package.json is missing the raw resource entry a language needs.
  let names;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    names = new Set(pkg.pebble.resources.media.map((m) => m.name));
  } catch (e) {
    return;
  }
  for (const lang of langs) {
    const want = `LOCALE_${cident(lang)}`;
    if (!names.has(want)) {
      process.stderr.write(
        `gen_strings: warning: package.json has no resource '${want}'.\n` +
        `  Add: { "type": "raw", "name": "${want}", "file": "data/locale_${lang}.bin" }\n`);
    }
  }
}


function write(p, text) {
  if (!text.endsWith('\n')) text += '\n';
  fs.writeFileSync(p, text);
}


main();
