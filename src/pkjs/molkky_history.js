// =============================================================================
// molkky_history.js — the one phone-side place that knows the MKHistGame byte
// layout. The storage lib keeps records opaque on purpose (decoupled from the C
// struct); this decoder is the deliberate, contained exception that turns a
// Store.snapshot() into human-readable games for the config webview.
//
// MUST stay in sync with the structs in src/c/app/molkky.h:
//
//   MKResult (8 B):  id u8@0  place u8@1  score u8@2  flags u8@3
//                    misses u8@4  throws u8@5  points u16@6
//   MKHistGame:      date i32@0  start i32@4  count u8@8  settings u8@9
//                    _pad[2]@10  results[count] @12  (MKResult, sorted by place)
//                    (duration is derived: date - start)
//
// Flag bits: MK_RES_OUT 0x1, MK_RES_WON 0x2 (flags); MK_SET_LOSE3 0x1,
// MK_SET_FINAL 0x2 (settings).
//
// NOTE: records store the roster `id`, not the name — names live only in the
// watch's persist. So players surface as `#<id>` here; resolving real names
// would need a separate roster sync (a future enhancement).
// =============================================================================

var Store = require('./storage');

function readU16(a, o) { return (a[o] | (a[o + 1] << 8)) >>> 0; }
function readI32(a, o) {
  return (a[o] | (a[o + 1] << 8) | (a[o + 2] << 16) | (a[o + 3] << 24)); // signed
}

function isoFromUnix(sec) {
  if (!sec) return null;
  return new Date(sec * 1000).toISOString();
}

function decodeResult(a, o) {
  var flags = a[o + 3];
  return {
    player: a[o] >>> 0,          // roster id (no name on the phone)
    place:  a[o + 1] >>> 0,
    score:  a[o + 2] >>> 0,
    won:    !!(flags & 0x2),     // MK_RES_WON
    out:    !!(flags & 0x1),     // MK_RES_OUT
    misses: a[o + 4] >>> 0,
    throws: a[o + 5] >>> 0,
    points: readU16(a, o + 6)
  };
}

// Decode one record's bytes into a readable game. Tolerates a short/garbled
// record by clamping `count` to what the buffer can hold.
function decodeGame(a) {
  var date = readI32(a, 0);
  var start = readI32(a, 4);
  var count = a[8] >>> 0;
  var settings = a[9] >>> 0;
  // bytes 10-11 are padding
  var maxFit = Math.floor((a.length - 12) / 8);
  if (count > maxFit) count = maxFit < 0 ? 0 : maxFit;
  var players = [];
  for (var i = 0; i < count; i++) players.push(decodeResult(a, 12 + i * 8));
  return {
    date: date,
    endedISO:   isoFromUnix(date),
    startedISO: isoFromUnix(start),
    durationMin: (start && date > start) ? Math.round((date - start) / 60) : 0,
    lose3:      !!(settings & 0x1),   // MK_SET_LOSE3
    finalRound: !!(settings & 0x2),   // MK_SET_FINAL
    players: players
  };
}

// Turn a Store.snapshot() into { schema, count, games[] }, newest game first.
function decodeArchive(snap) {
  var recs = (snap && snap.records) || [];
  var games = [];
  for (var i = 0; i < recs.length; i++) {
    try {
      var g = decodeGame(Store.b64dec(recs[i].data));
      g.seq = recs[i].seq;
      games.push(g);
    } catch (err) { /* skip an unreadable record rather than fail the whole view */ }
  }
  games.sort(function (x, y) { return y.seq - x.seq; });
  return { schema: snap ? snap.schema : null, count: games.length, games: games };
}

// Roll a decoded archive up into per-player lifetime stats — the phone's exact,
// full-history counterpart to the watch's running MKLifetime totals. Keyed by
// roster id (the records carry no names — see the note above), so players show
// as #id. Returns rows sorted by games played (desc), then id.
function aggregatePlayers(archive) {
  var games = (archive && archive.games) || [];
  var byId = {};
  for (var i = 0; i < games.length; i++) {
    var ps = games[i].players || [];
    for (var j = 0; j < ps.length; j++) {
      var p = ps[j];
      var L = byId[p.player];
      if (!L) L = byId[p.player] = { id: p.player, games: 0, wins: 0,
                                     throws: 0, misses: 0, points: 0, placeSum: 0 };
      L.games++;
      if (p.place === 1) L.wins++;
      L.throws += p.throws;
      L.misses += p.misses;
      L.points += p.points;
      L.placeSum += p.place;
    }
  }
  var out = [];
  for (var k in byId) {
    if (!byId.hasOwnProperty(k)) continue;
    var s = byId[k];
    out.push({
      id:          s.id,
      games:       s.games,
      wins:        s.wins,
      winPct:      s.games  ? Math.round(s.wins * 100 / s.games) : 0,
      accuracyPct: s.throws ? Math.round((s.throws - s.misses) * 100 / s.throws) : 0,
      avgPoints:   s.throws ? Math.round(s.points * 10 / s.throws) / 10 : 0,
      avgPlace:    s.games  ? Math.round(s.placeSum * 10 / s.games) / 10 : 0
    });
  }
  out.sort(function (a, b) { return (b.games - a.games) || (a.id - b.id); });
  return out;
}

module.exports = { decodeArchive: decodeArchive, decodeGame: decodeGame,
                   aggregatePlayers: aggregatePlayers };
