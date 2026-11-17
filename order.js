/**
 * order.js — Local data layer for Madrasa + Masjid Admin Panel
 * ============================================================
 * WHY THIS FILE EXISTS (user requirement):
 * If this HTML is later converted to an Electron desktop app or a
 * mobile app, data must still be saved LOCALLY first. So every record
 * is written to localStorage BEFORE any network call, and every
 * change is queued in an offline outbox and synced when online.
 *
 * Framework-free vanilla JS — no library, no build step — so the
 * same file works unchanged in the browser, in Electron, and in a
 * mobile WebView later.
 *
 * Public functions (used by admin.js):
 *   setApiUrl(url)        — set the Apps Script Web App URL (from Settings)
 *   getApiUrl()           — read it back
 *   getLocal(collection)  — read rows saved locally (array, [] if none)
 *   saveLocal(collection, rows) — replace a whole collection locally
 *   upsertLocal(collection, idField, row) — insert/update one row locally
 *   queueChange(action, payload) — save locally + add to offline outbox
 *   syncNow()             — send queued changes to the Sheet, oldest first
 *   getSyncStatus()       — { pending, lastSync, online, apiConfigured }
 *   getOutbox() / clearOutbox()
 *   seedDemoLocal()       — demo rows ONLY if local store is completely empty
 *
 * Sync status shown in the UI:
 *   "Saved locally" = written to this device, not yet sent
 *   "Synced"        = confirmed by the Google Sheet backend
 *   "Pending (n)"   = n changes waiting in the outbox (offline / no API URL)
 *
 * Collections: students, teachers, attendance, fees, accounts, receipts,
 *   users, ledger, items, sabaq, settings (v2)
 */
(function (global) {
  'use strict';

  var LS_PREFIX = 'mm_v1_';
  var OUTBOX_KEY = LS_PREFIX + 'outbox';
  var META_KEY = LS_PREFIX + 'meta';

  var API_URL = ''; // set by admin.js from Settings; '' = local-only mode

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/blocked — data still in memory */ }
  }

  function getMeta() { return readJSON(META_KEY, { lastSync: null, apiUrl: '' }); }
  function setMeta(patch) {
    var m = getMeta();
    Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
    writeJSON(META_KEY, m);
    return m;
  }

  function setApiUrl(url) {
    API_URL = (url || '').trim();
    setMeta({ apiUrl: API_URL });
    return API_URL;
  }
  function getApiUrl() {
    if (!API_URL) API_URL = getMeta().apiUrl || '';
    return API_URL;
  }

  function getLocal(collection) {
    return readJSON(LS_PREFIX + collection, []);
  }
  function saveLocal(collection, rows) {
    writeJSON(LS_PREFIX + collection, Array.isArray(rows) ? rows : []);
    return getLocal(collection);
  }

  function upsertLocal(collection, idField, row) {
    var rows = getLocal(collection);
    var found = false;
    rows = rows.map(function (r) {
      if (String(r[idField]) === String(row[idField])) { found = true; return row; }
      return r;
    });
    if (!found) rows.push(row);
    saveLocal(collection, rows);
    return row;
  }

  function getOutbox() { return readJSON(OUTBOX_KEY, []); }

  // Save locally FIRST, then queue the change for the Sheet. Returns the queue entry.
  function queueChange(action, payload) {
    var entry = { id: 'q' + Date.now() + Math.floor(Math.random() * 1000), action: action, payload: payload || {}, queuedAt: new Date().toISOString(), attempts: 0 };
    var box = getOutbox();
    box.push(entry);
    writeJSON(OUTBOX_KEY, box);
    return entry;
  }

  function clearOutbox() { writeJSON(OUTBOX_KEY, []); }

  // v4: writes go through GET with a JSON `payload` parameter. A plain
  // fetch POST to an Apps Script Web App is turned into a GET when the
  // browser follows Google's redirect, which drops the body — the write
  // would silently never happen (verified: curl POST lost the body with
  // "411 Length Required", while --post302 worked). Code.gs doGet parses
  // `payload` and routes the same handleAction as doPost.
  function apiPost(action, payload) {
    var url = getApiUrl();
    if (!url) return Promise.reject(new Error('No API URL configured (Settings). Working locally only.'));
    var body = Object.assign({ action: action }, payload || {});
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return fetch(url + sep + 'action=' + encodeURIComponent(action) + '&payload=' + encodeURIComponent(JSON.stringify(body)))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok === false) throw new Error(data.error || 'Server error');
        return data;
      });
  }

  function apiGet(action) {
    var url = getApiUrl();
    if (!url) return Promise.reject(new Error('No API URL configured (Settings). Working locally only.'));
    return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=' + encodeURIComponent(action))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok === false) throw new Error(data.error || 'Server error');
        return data;
      });
  }

  // Send queued changes oldest-first. A failed entry stays in the outbox for the next try.
  function syncNow() {
    var box = getOutbox();
    if (!box.length) return Promise.resolve({ ok: true, synced: 0, pending: 0 });
    if (!getApiUrl()) return Promise.resolve({ ok: false, synced: 0, pending: box.length, error: 'No API URL configured' });
    var chain = Promise.resolve(0);
    var remaining = [];
    box.forEach(function (entry) {
      chain = chain.then(function (count) {
        return apiPost(entry.action, entry.payload).then(function () { return count + 1; })
          .catch(function () { remaining.push(entry); return count; });
      });
    });
    return chain.then(function (synced) {
      writeJSON(OUTBOX_KEY, remaining);
      if (synced > 0) setMeta({ lastSync: new Date().toISOString() });
      return { ok: remaining.length === 0, synced: synced, pending: remaining.length };
    });
  }

  function getSyncStatus() {
    return {
      pending: getOutbox().length,
      lastSync: getMeta().lastSync,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      apiConfigured: !!getApiUrl()
    };
  }

  // v5: NO demo rows and NO demo logins anywhere. The Sheet is the source
  // of truth; local storage starts empty and fills from the server. The
  // Admin account is created by the Admin in the Sheet (Settings > Users).
  // Default classes are seeded locally so the class lists work offline.
  function seedDemoLocal() {
    if (getLocal('students').length || getLocal('teachers').length || getLocal('users').length) return false;
    var today = new Date().toISOString().slice(0, 10);
    var ym = today.slice(0, 7);
    saveLocal('students', []);
    saveLocal('teachers', []);
    saveLocal('users', []);
    saveLocal('settings', { MadrasaName: 'Madrasa', MasjidName: 'Masjid', AdminName: '', AdminPhone: '', AdminWhatsApp: '', Address: '', LogoURL: '', ThemeColor: '#4f46e5' });
    saveLocal('ledger', []);
    saveLocal('items', []);
    saveLocal('classes', [
      { ClassID: 'CLS-DEF-1', ClassName: 'Qaida', Level: '\u2014', Description: 'Basic reading (Qaida)', Status: 'Active' },
      { ClassID: 'CLS-DEF-2', ClassName: 'Nazra', Level: '\u2014', Description: 'Nazra Quran reading', Status: 'Active' },
      { ClassID: 'CLS-DEF-3', ClassName: 'Hifz', Level: '\u2014', Description: 'Hifz (Quran memorisation)', Status: 'Active' },
      { ClassID: 'CLS-DEF-4', ClassName: 'Tajweed', Level: '\u2014', Description: 'Tajweed rules', Status: 'Active' },
      { ClassID: 'CLS-DEF-5', ClassName: 'Alim-e-Deen', Level: 'Level 1', Description: 'Alim course \u2014 year 1', Status: 'Active' },
      { ClassID: 'CLS-DEF-6', ClassName: 'Alim-e-Deen', Level: 'Level 2', Description: 'Alim course \u2014 year 2', Status: 'Active' },
      { ClassID: 'CLS-DEF-7', ClassName: 'Alim-e-Deen', Level: 'Level 3', Description: 'Alim course \u2014 year 3', Status: 'Active' },
      { ClassID: 'CLS-DEF-8', ClassName: 'Alim-e-Deen', Level: 'Level 4', Description: 'Alim course \u2014 year 4', Status: 'Active' },
      { ClassID: 'CLS-DEF-9', ClassName: 'Alim-e-Deen', Level: 'Level 5', Description: 'Alim course \u2014 year 5', Status: 'Active' },
      { ClassID: 'CLS-DEF-10', ClassName: 'Alim-e-Deen', Level: 'Level 6', Description: 'Alim course \u2014 year 6', Status: 'Active' },
      { ClassID: 'CLS-DEF-11', ClassName: 'Alim-e-Deen', Level: 'Level 7', Description: 'Alim course \u2014 year 7', Status: 'Active' },
      { ClassID: 'CLS-DEF-12', ClassName: 'Alim-e-Deen', Level: 'Level 8', Description: 'Alim course \u2014 year 8', Status: 'Active' },
      { ClassID: 'CLS-DEF-13', ClassName: 'Fazil', Level: '\u2014', Description: 'Fazil (advanced) class', Status: 'Active' }
    ]);
    saveLocal('sabaq', []);
    saveLocal('fees', []);
    saveLocal('accounts', []);
    saveLocal('attendance', []);
    saveLocal('receipts', []);
    return true;
  }

  // ---- v3 (local/demo): forgot password + email verification ----
  // In live mode these flows go through the Sheet (Code.gs). In local
  // mode there is no Sheet/email, so the 6-digit code is stored locally
  // and RETURNED to the caller — admin.js SHOWS it on screen labelled
  // "DEMO CODE". Never show the code in live mode.
  function genLocalCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
  function findLocalUser(identifier) {
    var id = String(identifier || '').trim().toLowerCase();
    if (!id) return null;
    var list = getLocal('users');
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].Username || '').toLowerCase() === id || String(list[i].Email || '').toLowerCase() === id) return list[i];
    }
    return null;
  }
  function findLocalUserById(userId) {
    var list = getLocal('users');
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].UserID) === String(userId)) return list[i];
    }
    return null;
  }
  function localCodeValid(u, code) {
    if (!u || !u.ResetCode) return false;
    if (String(u.ResetCode) !== String(code).trim()) return false;
    if (!u.ResetExpiry) return false;
    return new Date(u.ResetExpiry).getTime() > Date.now();
  }
  function requestPasswordResetLocal(identifier) {
    var u = findLocalUser(identifier);
    if (!u) return { ok: false, error: 'No account found with that username or email.' };
    var code = genLocalCode();
    u.ResetCode = code; u.ResetExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    upsertLocal('users', 'UserID', u);
    if (!u.Email) return { ok: true, emailed: false, delivery: 'code_pending_admin', demoCode: code, email: '', message: 'No email is saved on this account. Ask the Admin to reset the password from Settings > Users. (Demo code is shown below for testing.)' };
    return { ok: true, emailed: false, delivery: 'demo', demoCode: code, email: u.Email, message: 'DEMO MODE — no email was sent. Your 6-digit code is shown on screen.' };
  }
  function verifyResetCodeLocal(identifier, code) {
    var u = findLocalUser(identifier);
    if (!u) return { ok: false, error: 'No account found.' };
    if (!localCodeValid(u, code)) return { ok: false, error: 'Wrong code, or the code has expired (15 minutes). Request a new code.' };
    return { ok: true };
  }
  function resetPasswordLocal(identifier, code, newPassword) {
    var v = verifyResetCodeLocal(identifier, code);
    if (!v.ok) return v;
    if (!newPassword || String(newPassword).length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
    var u = findLocalUser(identifier);
    u.Password = String(newPassword); u.ResetCode = ''; u.ResetExpiry = '';
    upsertLocal('users', 'UserID', u);
    return { ok: true, message: 'Password changed. Please log in with your new password.' };
  }
  function saveUserEmailLocal(userId, email) {
    var u = findLocalUserById(userId);
    if (!u) return { ok: false, error: 'User not found.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) return { ok: false, error: 'Please enter a valid email address.' };
    var list = getLocal('users');
    var clash = null;
    list.forEach(function (x) { if (String(x.UserID) !== String(userId) && String(x.Email || '').toLowerCase() === String(email).trim().toLowerCase()) clash = x; });
    if (clash) return { ok: false, error: 'That email is already used by another user.' };
    var changed = String(email).trim().toLowerCase() !== String(u.Email || '').toLowerCase();
    u.Email = String(email).trim();
    if (changed) { u.EmailVerified = 'No'; u.VerifiedDate = ''; }
    if (!u.EmailVerified) u.EmailVerified = 'No';
    upsertLocal('users', 'UserID', u);
    return { ok: true, email: u.Email, emailVerified: u.EmailVerified };
  }
  function requestEmailVerificationLocal(userId) {
    var u = findLocalUserById(userId);
    if (!u) return { ok: false, error: 'User not found.' };
    if (!u.Email) return { ok: false, error: 'No email saved on this account yet. Add an email first.' };
    var code = genLocalCode();
    u.ResetCode = code; u.ResetExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    upsertLocal('users', 'UserID', u);
    return { ok: true, emailed: false, delivery: 'demo', demoCode: code, email: u.Email, message: 'DEMO MODE — no email was sent. Your 6-digit code is shown on screen.' };
  }
  function verifyEmailLocal(userId, code) {
    var u = findLocalUserById(userId);
    if (!u) return { ok: false, error: 'User not found.' };
    if (!localCodeValid(u, code)) return { ok: false, error: 'Wrong code, or the code has expired (15 minutes). Request a new code.' };
    u.EmailVerified = 'Yes'; u.VerifiedDate = new Date().toISOString().slice(0, 10); u.ResetCode = ''; u.ResetExpiry = '';
    upsertLocal('users', 'UserID', u);
    return { ok: true, message: 'Email verified.' };
  }

  // Auto-sync when the browser comes back online.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function () { syncNow().catch(function () {}); });
  }

  global.MMLocal = {
    setApiUrl: setApiUrl, getApiUrl: getApiUrl,
    getLocal: getLocal, saveLocal: saveLocal, upsertLocal: upsertLocal,
    queueChange: queueChange, syncNow: syncNow, getSyncStatus: getSyncStatus,
    getOutbox: getOutbox, clearOutbox: clearOutbox,
    apiPost: apiPost, apiGet: apiGet, seedDemoLocal: seedDemoLocal,
    requestPasswordResetLocal: requestPasswordResetLocal, verifyResetCodeLocal: verifyResetCodeLocal,
    resetPasswordLocal: resetPasswordLocal, saveUserEmailLocal: saveUserEmailLocal,
    requestEmailVerificationLocal: requestEmailVerificationLocal, verifyEmailLocal: verifyEmailLocal
  };
})(typeof window !== 'undefined' ? window : globalThis);
