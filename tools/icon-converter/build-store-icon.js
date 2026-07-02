#!/usr/bin/env node
// Generates the appstore app icon as SVG + PNGs into store-assets/.
// The artwork replicates src/c/app/pins_art.c (the watch's main image) —
// same pin geometry, formation table, and draw order, minus the title band.
// Usage: node build-store-icon.js [output-dir]

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const INK = '#27514f'; // ui_accent as it appears in screenshots/cover-image.png
const BG = '#ffffff';

// --- pin geometry, verbatim from pins_art.c ---------------------------------
const PIN_R = 17; // half width of a pin
const TOP_RX = 17; // top oval half width — flush with the sides (the watch's 1px lip reads as misalignment at icon scale)
const TOP_RY = 20; // half height of the (tall) top oval — the number lives here
const BOT_RY = 9; // half height of the bottom rim oval
const PIN_BODY = 48; // body height: top-oval centre → bottom-oval centre
const PIN_GAP = 6; // horizontal gap between neighbouring pins in a row
const ROW_DY = 30; // how much lower each row sits than the one behind it
const STROKE = 2;

const PITCH = 2 * PIN_R + PIN_GAP; // centre-to-centre spacing in a row
const HPITCH = PITCH / 2; // hex rows nest by half a pitch

// The standard formation, back row first; offsets in half-pitch units.
const ROWS = [
  { v: [7, 9, 8], off: [-2, 0, 2] },
  { v: [5, 11, 12, 6], off: [-3, -1, 1, 3] },
  { v: [3, 10, 4], off: [-2, 0, 2] },
  { v: [1, 2], off: [-1, 1] },
];

// Matches FONT_KEY_GOTHIC_24_BOLD digits (~14px tall) centred in the top oval.
const FONT_SIZE = 19.5;
const NUM_BASELINE_DY = 6.0;

// One fake-3D pin, head-on. `cyT` is the top-oval centre. Painter order as in
// draw_pin(): background silhouette first, then the ink outline and number.
function pinSvg(cx, cyT, value, stroke) {
  const baseY = cyT + PIN_BODY;
  return `
    <g>
      <rect x="${cx - PIN_R}" y="${cyT}" width="${2 * PIN_R}" height="${PIN_BODY}" fill="${BG}"/>
      <ellipse cx="${cx}" cy="${cyT}" rx="${TOP_RX}" ry="${TOP_RY}" fill="${BG}"/>
      <ellipse cx="${cx}" cy="${baseY}" rx="${PIN_R}" ry="${BOT_RY}" fill="${BG}"/>
      <g stroke="${INK}" stroke-width="${stroke}" fill="none" stroke-linecap="round">
        <ellipse cx="${cx}" cy="${cyT}" rx="${TOP_RX}" ry="${TOP_RY}"/>
        <line x1="${cx - PIN_R}" y1="${cyT}" x2="${cx - PIN_R}" y2="${baseY}"/>
        <line x1="${cx + PIN_R}" y1="${cyT}" x2="${cx + PIN_R}" y2="${baseY}"/>
        <path d="M ${cx - PIN_R} ${baseY} A ${PIN_R} ${BOT_RY} 0 0 0 ${cx + PIN_R} ${baseY}"/>
      </g>
      <text x="${cx}" y="${cyT + NUM_BASELINE_DY}" text-anchor="middle"
            font-family="Helvetica Neue, Helvetica, Arial" font-weight="bold"
            font-size="${FONT_SIZE}" fill="${INK}">${value}</text>
    </g>`;
}

// Bundle bounds in pin coordinates (back row top-oval centre = origin).
const minX = -3 * HPITCH - TOP_RX;
const maxX = 3 * HPITCH + TOP_RX;
const minY = -TOP_RY;
const maxY = 3 * ROW_DY + PIN_BODY + BOT_RY;
const w = maxX - minX + STROKE;
const h = maxY - minY + STROKE;

// Centre + scale into a square canvas with a little padding.
const SIDE = 200;
const PAD = 10;
const scale = (SIDE - 2 * PAD) / Math.max(w, h);
const tx = (SIDE - w * scale) / 2 - (minX - STROKE / 2) * scale;
const ty = (SIDE - h * scale) / 2 - (minY - STROKE / 2) * scale;

function iconSvg(stroke) {
  const pins = [];
  for (let r = 0; r < ROWS.length; r++) {
    const cyT = r * ROW_DY;
    ROWS[r].off.forEach((off, p) => {
      pins.push(pinSvg(off * HPITCH, cyT, ROWS[r].v[p], stroke));
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIDE} ${SIDE}" role="img" aria-label="Mölkky pins">
  <rect width="${SIDE}" height="${SIDE}" fill="${BG}"/>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">${pins.join('')}
  </g>
</svg>
`;
}

const outDir = path.resolve(process.argv[2] ?? path.join(__dirname, '..', '..', 'store-assets'));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'app-icon.svg'), iconSvg(STROKE));

for (const size of [80, 144]) {
  // Below ~100px a 2px-at-200 stroke thins out; bump it so the outline holds up.
  const svg = iconSvg(size < 100 ? 3.5 : STROKE);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
    shapeRendering: 2,
  });
  const png = r.render();
  const file = path.join(outDir, `app-icon-${size}.png`);
  fs.writeFileSync(file, png.asPng());
  console.log(`${file} (${png.width}x${png.height})`);
}
