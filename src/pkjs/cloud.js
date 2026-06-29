// =============================================================================
// cloud.js — phone-side GitHub-gist backup for Mölkky.
//
// Backup only (not live sync): the user signs in with GitHub once, and the full
// archive is mirrored into ONE secret gist in their own account. Each backup is a
// `PATCH`, and GitHub keeps every revision — so the gist's revision history *is*
// the backup history, and "restore a specific backup" is just fetching one
// revision and handing it to history.restore().
//
// The backup payload is exactly history.snapshot() (see storage.js) — the same
// opaque, lossless format Export/Import already uses, so nothing here needs to
// understand a record's bytes.
//
// All network lives here. PKJS XHR isn't subject to browser CORS, so the watch's
// settings webview never has to touch GitHub directly — it only kicks off actions
// (sign in, back up now, restore) that this module carries out.
//
// localStorage keys (prefix cloud:):
//   gh:token   the GitHub OAuth access token (gist scope)
//   gh:login   the account login, cached for the settings page
//   gist:id    the backup gist id, once created/discovered
//   lastBackup ISO timestamp of the last successful backup
//   backups    cached [{version, date}] revision list, for the settings page
// =============================================================================

var API = 'https://api.github.com';
var MARKER = 'molkky-backup';            // gist description, used to rediscover it
var FILE = 'molkky-backup.json';         // the single file inside the gist
var K = {
  token: 'cloud:gh:token',
  login: 'cloud:gh:login',
  gist:  'cloud:gist:id',
  last:  'cloud:lastBackup',
  list:  'cloud:backups'
};

function get(k) { return localStorage.getItem(k); }
function set(k, v) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); }

// ---- low-level GitHub call ---------------------------------------------------
// cb(err, data, status): err is null on 2xx, else a short string.
function api(method, path, body, cb) {
  var token = get(K.token);
  if (!token) { cb('no-token'); return; }
  var xhr = new XMLHttpRequest();
  xhr.open(method, API + path, true);
  xhr.setRequestHeader('Authorization', 'token ' + token);
  xhr.setRequestHeader('Accept', 'application/vnd.github+json');
  if (body != null) xhr.setRequestHeader('Content-Type', 'application/json');
  // GitHub requires a User-Agent. Browsers forbid setting it; the PKJS runtime
  // generally allows it. Guard so a runtime that throws doesn't break the call.
  try { xhr.setRequestHeader('User-Agent', 'molkky-pebble'); } catch (e) {}
  xhr.onload = function () {
    var data = null;
    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {}
    if (xhr.status >= 200 && xhr.status < 300) cb(null, data, xhr.status);
    else cb((data && data.message) || ('http ' + xhr.status), data, xhr.status);
  };
  xhr.onerror = function () { cb('network', null, 0); };
  xhr.timeout = 20000;
  xhr.ontimeout = function () { cb('timeout', null, 0); };
  xhr.send(body != null ? JSON.stringify(body) : null);
}

// Fetch the raw content of a gist file, following GitHub's truncation: files over
// ~1 MB come back with content omitted and a raw_url to fetch instead.
function fileContent(file, cb) {
  if (!file) { cb('missing-file'); return; }
  if (!file.truncated && file.content != null) { cb(null, file.content); return; }
  var xhr = new XMLHttpRequest();
  xhr.open('GET', file.raw_url, true);
  xhr.setRequestHeader('Authorization', 'token ' + get(K.token));
  try { xhr.setRequestHeader('User-Agent', 'molkky-pebble'); } catch (e) {}
  xhr.onload = function () { cb(xhr.status === 200 ? null : ('http ' + xhr.status), xhr.responseText); };
  xhr.onerror = function () { cb('network'); };
  xhr.send();
}

// ---- auth --------------------------------------------------------------------
function setToken(token) {
  set(K.token, token);
  // Cache the login for the settings page; non-fatal if it fails.
  api('GET', '/user', null, function (err, u) { if (!err && u) set(K.login, u.login || ''); });
}

function signOut() {
  set(K.token, null); set(K.login, null); set(K.gist, null);
  set(K.last, null); set(K.list, null);
}

function hasToken() { return !!get(K.token); }

// Synchronous snapshot of backup state for the settings page (no network).
function status() {
  var listed = [];
  try { listed = JSON.parse(get(K.list) || '[]'); } catch (e) { listed = []; }
  return {
    signedIn: hasToken(),
    login: get(K.login) || '',
    lastBackup: get(K.last) || '',
    backups: listed
  };
}

// ---- backup ------------------------------------------------------------------
function gistBody(history) {
  var files = {};
  files[FILE] = { content: JSON.stringify(history.snapshot()) };
  return { description: MARKER, files: files };
}

// Refresh the cached login + revision list after a backup, so the settings page
// shows a current "restore" list next time it opens. Best-effort.
function refreshMeta(cb) {
  var id = get(K.gist);
  if (!id) { if (cb) cb(); return; }
  api('GET', '/gists/' + id + '/commits?per_page=20', null, function (err, commits) {
    if (!err && commits && commits.length) {
      var out = [];
      for (var i = 0; i < commits.length; i++) {
        out.push({ version: commits[i].version, date: commits[i].committed_at });
      }
      set(K.list, JSON.stringify(out));
    }
    if (cb) cb();
  });
}

// Mirror the whole archive to the gist. Creates the gist on first use, rediscovers
// it (by the MARKER description) if we know the token but not the id — e.g. after a
// reinstall or signing in on a new phone. cb(err) when done.
function backup(history, cb) {
  cb = cb || function () {};
  if (!hasToken()) { cb('not-signed-in'); return; }
  var id = get(K.gist);
  if (id) { patch(id); return; }
  // No known gist — look for an existing one before creating a duplicate.
  api('GET', '/gists?per_page=100', null, function (err, list) {
    if (!err && list) {
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        if ((g.description === MARKER) || (g.files && g.files[FILE])) { set(K.gist, g.id); patch(g.id); return; }
      }
    }
    create();
  });

  function create() {
    var body = gistBody(history);
    body.public = false;
    api('POST', '/gists', body, function (err, g) {
      if (err) { cb(err); return; }
      set(K.gist, g.id);
      finish();
    });
  }
  function patch(gid) {
    api('PATCH', '/gists/' + gid, gistBody(history), function (err) {
      if (err) { cb(err); return; }
      finish();
    });
  }
  function finish() {
    set(K.last, new Date().toISOString());
    refreshMeta(function () { cb(null); });
  }
}

// ---- restore -----------------------------------------------------------------
// Fetch one revision and replace the local archive with it. `version` is a gist
// commit sha from status().backups; omitted/falsy means the latest revision.
function restoreRevision(history, version, cb) {
  cb = cb || function () {};
  var id = get(K.gist);
  if (!id) { cb('no-backup'); return; }
  var path = '/gists/' + id + (version ? ('/' + version) : '');
  api('GET', path, null, function (err, g) {
    if (err) { cb(err); return; }
    fileContent(g && g.files && g.files[FILE], function (ferr, text) {
      if (ferr) { cb(ferr); return; }
      var snap;
      try { snap = JSON.parse(text); } catch (e) { cb('bad-backup'); return; }
      try {
        history.restore(snap);          // full replace + RELOAD/AUX to the watch (storage.js)
        cb(null);
      } catch (e) { cb(e.message || 'restore-failed'); }
    });
  });
}

module.exports = {
  setToken: setToken,
  signOut: signOut,
  hasToken: hasToken,
  status: status,
  backup: backup,
  restoreRevision: restoreRevision
};
