/**
 * admin.js — Madrasa + Masjid Admin Panel (frontend logic)
 * ========================================================
 * Offline-first: every save goes to order.js (localStorage) FIRST,
 * then is queued for the Google Sheet backend (Code.gs Web App).
 * Every fetch() here matches an action in Code.gs handleAction():
 *   getDashboard, getStudents, saveStudent, getTeachers, saveTeacher,
 *   saveAttendance, getAttendance, recordFee, getFees,
 *   recordTransaction, getAccounts, getReceipts
 * v3 actions (also in Code.gs handleAction): requestPasswordReset,
 * verifyResetCode, resetPassword, saveUserEmail, requestEmailVerification,
 * verifyEmail. Forgot-password + email flows call the Sheet directly when
 * an API URL is set, and fall back to MMLocal *Local demo helpers (which
 * SHOW the 6-digit code on screen, labelled DEMO CODE) when it is not.
 * If no API URL is set (Settings), the panel works fully locally
 * and shows "Saved locally / Pending".
 */
(function () {
  'use strict';

  // >>> PASTE YOUR APPS SCRIPT WEB APP URL HERE (or set it in Settings — Settings wins) <<<
  // Example: https://script.google.com/macros/s/AKfyc.../exec
  var API_URL = '';

  // v2 actions (also in Code.gs handleAction): login, getUsers, saveUser,
  // getSettings, saveSettings, getLedger, recordLedger, getItems, saveItem,
  // getHistory, saveSabaq, getSabaq. Role is sent with every queued change
  // and Code.gs rejects actions the role may not do (see ROLE_DENY there).
  // DEMO LOGIN ONLY: admin/admin123, editor/editor123, qari/qari123.
  // Change these in Settings > Users after first login. This is NOT
  // secure production auth — see SETUP-GUIDE.md.

  var students = [], teachers = [], fees = [], accounts = [], receipts = [], attendance = [];
  var users = [], ledger = [], items = [], sabaq = [];
  var settings = {};
  var currentUser = null; // { UserID, Name, Role, Username, Phone }
  var attMarks = {};
  var attSessionList = [];
  var pendingPhoto = null;
  var profileStudentId = null, profileTeacherId = null;

  function $(id) { return document.getElementById(id); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function thisMonth() { return today().slice(0, 7); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rs(n) { return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK'); }
  function studentName(id) { var s = students.find(function (x) { return String(x.StudentID) === String(id); }); return s ? s.Name : id; }
  function teacherName(id) { var t = teachers.find(function (x) { return String(x.TeacherID) === String(id); }); return t ? t.Name : id; }
  function role() { return currentUser ? currentUser.Role : 'Admin'; }
  function can(action) {
    if (role() === 'Admin') return true;
    if (role() === 'Editor') return ['saveSettings', 'saveUser'].indexOf(action) === -1;
    if (role() === 'Qari') return ['saveAttendance', 'saveSabaq'].indexOf(action) !== -1 || action.indexOf('get') === 0;
    return false;
  }
  function requireRole(action) {
    if (!can(action)) { alert('یہ کام آپ کے رول کے لیے نہیں ہے — Not allowed for role ' + role() + '.'); return false; }
    return true;
  }

  /* ---------- login (screen FIRST, panel after) ---------- */
  function showLogin() {
    var l = $('loginScreen'), a = $('appScreen');
    if (l) l.style.display = 'flex';
    if (a) a.style.display = 'none';
    applyBranding();
  }
  function showApp() {
    var l = $('loginScreen'), a = $('appScreen');
    if (l) l.style.display = 'none';
    if (a) a.style.display = 'block';
    var w = $('whoami');
    if (w && currentUser) w.textContent = currentUser.Name + ' (' + currentUser.Role + ')';
    applyRole();
    applyBranding();
  }
  window.doLoginUI = function (e) {
    e.preventDefault();
    var fs = $('forgotSuccess'); if (fs) fs.textContent = '';
    var u = $('loginUser').value.trim(), p = $('loginPass').value;
    var found = users.filter(function (x) { return String(x.Username) === u && String(x.Password) === p && x.Status === 'Active'; })[0];
    if (found) { loginSuccess(found); return; }
    // Try the server when an API URL is set (local demo users are the fallback).
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('login', { username: u, password: p }).then(function (d) {
        if (d && d.ok && d.user) loginSuccess(d.user);
        else { $('loginError').textContent = 'غلط یوزر نیم یا پاس ورڈ (Wrong username or password).'; }
      }).catch(function () { $('loginError').textContent = 'غلط یوزر نیم یا پاس ورڈ (Wrong username or password).'; });
    } else {
      $('loginError').textContent = 'غلط یوزر نیم یا پاس ورڈ (Wrong username or password).';
    }
  };
  function loginSuccess(u) {
    currentUser = { UserID: u.UserID, Name: u.Name, Role: u.Role, Username: u.Username, Phone: u.Phone || '', Email: u.Email || '', EmailVerified: u.EmailVerified || 'No' };
    try { sessionStorage.setItem('mm_v2_session', JSON.stringify(currentUser)); } catch (e) {}
    $('loginError').textContent = '';
    showApp();
    renderDashboard(); renderStudents(); renderTeachers(); renderFees(); renderAccounts(); renderReceipts(); renderHistory(); renderUsers(); renderItems(); fillMyAccount();
  }
  window.logoutUI = function () {
    currentUser = null;
    try { sessionStorage.removeItem('mm_v2_session'); } catch (e) {}
    var f = $('loginForm'); if (f) f.reset();
    showLogin();
  };
  function restoreSession() {
    try {
      var raw = sessionStorage.getItem('mm_v2_session');
      if (raw) currentUser = JSON.parse(raw);
    } catch (e) {}
  }

  /* ---------- v3: forgot password (3 screens) ---------- */
  var forgotIdentifier = '', forgotVerified = false;
  function showForgotStep(n) {
    ['forgotStep1', 'forgotStep2', 'forgotStep3'].forEach(function (id, i) {
      var el = $(id); if (el) el.style.display = (i + 1 === n) ? 'block' : 'none';
    });
  }
  window.showForgotUI = function () {
    forgotIdentifier = ''; forgotVerified = false;
    var fs = $('forgotSuccess'); if (fs) fs.textContent = '';
    $('loginForm').style.display = 'none';
    var link = $('forgotLinkRow'); if (link) link.style.display = 'none';
    $('forgotScreen').style.display = 'block';
    $('forgotMsg').textContent = ''; $('forgotMsg2').textContent = ''; $('forgotMsg3').textContent = '';
    showForgotStep(1);
  };
  window.backToLoginUI = function () {
    $('forgotScreen').style.display = 'none';
    $('loginForm').style.display = 'block';
    var link = $('forgotLinkRow'); if (link) link.style.display = '';
    $('loginError').textContent = '';
  };
  window.askAdminResetUI = function () {
    $('forgotMsg').innerHTML = 'ایڈمن سے رابطہ کریں (Ask the Admin to reset it from Settings &gt; Users): ' +
      esc(settings.AdminName || 'Admin') + ' — <span dir="ltr">' + esc(settings.AdminPhone || '—') + '</span>' +
      (settings.AdminWhatsApp ? ' · WhatsApp: <span dir="ltr">' + esc(settings.AdminWhatsApp) + '</span>' : '');
  };
  window.requestResetUI = function (e) {
    e.preventDefault();
    var id = $('forgotIdentifierInput').value.trim();
    if (!id) { $('forgotMsg').textContent = 'یوزر نیم یا ای میل لکھیں (Enter your username or email).'; return; }
    forgotIdentifier = id;
    $('forgotMsg').textContent = '…';
    var done = function (d) {
      if (!d || !d.ok) { $('forgotMsg').textContent = (d && d.error) || 'Request failed.'; return; }
      var box = $('forgotStep2Body');
      var html = '';
      if (d.delivery === 'emailed') {
        html = '<p>✅ 6 ہندسوں والا کوڈ آپ کی ای میل پر بھیج دیا گیا: <b dir="ltr">' + esc(d.email || '') + '</b> — 15 منٹ میں ختم ہو جائے گا۔</p>';
      } else if (d.delivery === 'demo' && d.demoCode) {
        html = '<p class="demo-code">DEMO CODE — live mode میں یہ کوڈ ای میل سے آتا ہے، اسکرین پر نہیں دکھایا جاتا۔<br><span class="big-code" dir="ltr">' + esc(d.demoCode) + '</span><br>15 منٹ میں ختم ہو جائے گا۔</p>';
      } else {
        html = '<p>⚠️ ' + esc(d.message || 'No email is saved on this account.') + '</p>' +
          '<p>ایڈمن: ' + esc(settings.AdminName || 'Admin') + ' — <span dir="ltr">' + esc(settings.AdminPhone || '—') + '</span></p>' +
          (d.demoCode ? '<p class="demo-code">DEMO CODE — صرف جانچ کے لیے: <b dir="ltr">' + esc(d.demoCode) + '</b></p>' : '');
      }
      box.innerHTML = html;
      $('forgotMsg').textContent = '';
      showForgotStep(2);
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('requestPasswordReset', { identifier: id }).then(done).catch(function (err) { $('forgotMsg').textContent = err.message; });
    } else {
      done(MMLocal.requestPasswordResetLocal(id));
    }
  };
  window.verifyResetCodeUI = function (e) {
    e.preventDefault();
    var code = $('forgotCodeInput').value.trim();
    var done = function (d) {
      if (!d || !d.ok) { $('forgotMsg2').textContent = (d && d.error) || 'Wrong code.'; return; }
      forgotVerified = true;
      $('forgotMsg2').textContent = '';
      showForgotStep(3);
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('verifyResetCode', { identifier: forgotIdentifier, code: code }).then(done).catch(function (err) { $('forgotMsg2').textContent = err.message; });
    } else {
      done(MMLocal.verifyResetCodeLocal(forgotIdentifier, code));
    }
  };
  window.resetPasswordUI = function (e) {
    e.preventDefault();
    var p1 = $('forgotNewPass').value, p2 = $('forgotNewPass2').value;
    if (p1 !== p2) { $('forgotMsg3').textContent = 'دونوں پاس ورڈ ایک جیسے نہیں ہیں (Passwords do not match).'; return; }
    if (p1.length < 4) { $('forgotMsg3').textContent = 'پاس ورڈ کم از کم 4 حروف کا ہو۔'; return; }
    if (!forgotVerified) { $('forgotMsg3').textContent = 'پہلے کوڈ کی تصدیق کریں (Verify the code first).'; return; }
    var code = $('forgotCodeInput').value.trim();
    var done = function (d) {
      if (!d || !d.ok) { $('forgotMsg3').textContent = (d && d.error) || 'Reset failed.'; return; }
      // Old password stops working: update the local users copy too.
      var u = users.filter(function (x) { return String(x.Username).toLowerCase() === String(forgotIdentifier).toLowerCase() || String(x.Email || '').toLowerCase() === String(forgotIdentifier).toLowerCase(); })[0];
      if (u) { u.Password = p1; u.ResetCode = ''; u.ResetExpiry = ''; MMLocal.saveLocal('users', users); }
      backToLoginUI();
      var fs = $('forgotSuccess'); if (fs) fs.textContent = '✅ پاس ورڈ بدل گیا — نئے پاس ورڈ سے لاگ ان کریں (Password changed — log in with your new password).';
      var f = $('loginForm'); if (f) f.reset();
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('resetPassword', { identifier: forgotIdentifier, code: code, newPassword: p1 }).then(done).catch(function (err) { $('forgotMsg3').textContent = err.message; });
    } else {
      done(MMLocal.resetPasswordLocal(forgotIdentifier, code, p1));
    }
  };

  /* ---------- v3: add / verify email ---------- */
  function myUserRecord() {
    if (!currentUser) return null;
    return users.filter(function (x) { return String(x.UserID) === String(currentUser.UserID); })[0] || null;
  }
  function fillMyAccount() {
    if (!$('myEmailInput') || !currentUser) return;
    var u = myUserRecord() || currentUser;
    $('myEmailInput').value = u.Email || '';
    var st = $('myEmailStatus');
    if (st) {
      st.innerHTML = u.Email
        ? 'Email: <span dir="ltr">' + esc(u.Email) + '</span> — تصدیق (Verified): <b>' + esc(u.EmailVerified || 'No') + '</b>' + (u.VerifiedDate ? ' (' + esc(u.VerifiedDate) + ')' : '') + (String(u.EmailVerified) === 'Yes' ? ' ✅' : ' — نیچے کوڈ سے تصدیق کریں۔')
        : 'ابھی کوئی ای میل نہیں ہے۔ نیچے ای میل شامل کریں — یہ پاس ورڈ ری سیٹ اور فیس نوٹیفکیشن کے لیے استعمال ہوگی۔';
    }
    var box = $('emailVerifyBox'); if (box) box.style.display = u.Email ? 'block' : 'none';
  }
  window.saveMyEmailUI = function (e) {
    e.preventDefault();
    var email = $('myEmailInput').value.trim();
    var done = function (d) {
      if (!d || !d.ok) { alert((d && d.error) || 'Could not save email.'); return; }
      var u = myUserRecord();
      if (u) { u.Email = email; u.EmailVerified = d.emailVerified || 'No'; if (d.emailVerified === 'No') u.VerifiedDate = ''; MMLocal.saveLocal('users', users); }
      currentUser.Email = email; currentUser.EmailVerified = d.emailVerified || 'No';
      fillMyAccount(); renderUsers(); refreshSyncPill();
      alert(d.message || 'Email saved. Please verify it with the 6-digit code.');
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('saveUserEmail', { userId: currentUser.UserID, email: email, requesterUserId: currentUser.UserID, role: role() }).then(done).catch(function (err) { alert(err.message); });
    } else {
      var r = MMLocal.saveUserEmailLocal(currentUser.UserID, email);
      if (r.ok) MMLocal.queueChange('saveUserEmail', { userId: currentUser.UserID, email: email, requesterUserId: currentUser.UserID, role: role() });
      done(r.ok ? { ok: true, emailVerified: r.emailVerified, message: 'Email saved locally. Please verify it with the 6-digit code.' } : r);
    }
  };
  window.requestEmailVerificationUI = function () {
    var msg = $('emailVerifyMsg'); if (msg) msg.textContent = '…';
    var done = function (d) {
      if (!d || !d.ok) { if (msg) msg.textContent = (d && d.error) || 'Request failed.'; return; }
      if (msg) {
        if (d.delivery === 'emailed') msg.innerHTML = '✅ تصدیقی کوڈ ای میل پر بھیج دیا گیا: <b dir="ltr">' + esc(d.email || '') + '</b> — 15 منٹ میں ختم ہو جائے گا۔ نیچے کوڈ لکھیں۔';
        else if (d.demoCode) msg.innerHTML = '<span class="demo-code">DEMO CODE — live mode میں یہ کوڈ ای میل سے آتا ہے، اسکرین پر نہیں دکھایا جاتا: <b dir="ltr">' + esc(d.demoCode) + '</b></span>';
        else msg.textContent = d.message || '';
      }
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('requestEmailVerification', { userId: currentUser.UserID }).then(done).catch(function (err) { if (msg) msg.textContent = err.message; });
    } else {
      done(MMLocal.requestEmailVerificationLocal(currentUser.UserID));
    }
  };
  window.verifyEmailUI = function (e) {
    e.preventDefault();
    var code = $('emailVerifyCode').value.trim();
    var done = function (d) {
      if (!d || !d.ok) { $('emailVerifyMsg').textContent = (d && d.error) || 'Wrong code.'; return; }
      var u = myUserRecord();
      if (u) { u.EmailVerified = 'Yes'; u.VerifiedDate = today(); u.ResetCode = ''; u.ResetExpiry = ''; MMLocal.saveLocal('users', users); }
      currentUser.EmailVerified = 'Yes';
      fillMyAccount(); renderUsers();
      $('emailVerifyMsg').textContent = '✅ ای میل کی تصدیق ہو گئی (Email verified).';
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('verifyEmail', { userId: currentUser.UserID, code: code }).then(done).catch(function (err) { $('emailVerifyMsg').textContent = err.message; });
    } else {
      done(MMLocal.verifyEmailLocal(currentUser.UserID, code));
    }
  };
  // Admin sets any user's email from Settings > Users.
  window.saveAdminEmailUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveUser')) return;
    var userId = $('adminEmailUser').value;
    var email = $('adminEmailInput').value.trim();
    var done = function (d) {
      var note = $('adminEmailNote');
      if (!d || !d.ok) { if (note) note.textContent = (d && d.error) || 'Could not save email.'; return; }
      var u = users.filter(function (x) { return String(x.UserID) === String(userId); })[0];
      if (u) { u.Email = email; u.EmailVerified = d.emailVerified || 'No'; if (d.emailVerified === 'No') u.VerifiedDate = ''; MMLocal.saveLocal('users', users); }
      renderUsers();
      if (note) note.textContent = '✅ ' + (d.message || 'Email saved.');
    };
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('saveUserEmail', { userId: userId, email: email, requesterUserId: currentUser.UserID, role: role() }).then(done).catch(function (err) { var note = $('adminEmailNote'); if (note) note.textContent = err.message; });
    } else {
      var r = MMLocal.saveUserEmailLocal(userId, email);
      if (r.ok) MMLocal.queueChange('saveUserEmail', { userId: userId, email: email, requesterUserId: currentUser.UserID, role: role() });
      done(r.ok ? { ok: true, emailVerified: r.emailVerified, message: 'Email saved locally for this user.' } : r);
    }
  };
  function fillAdminEmailUsers() {
    var sel = $('adminEmailUser'); if (!sel) return;
    sel.innerHTML = users.map(function (u) { return '<option value="' + esc(u.UserID) + '">' + esc(u.Name) + ' (' + esc(u.Username) + ' — ' + esc(u.Role) + ')</option>'; }).join('');
  }

  /* ---------- role enforcement in the UI (server also enforces) ---------- */
  function applyRole() {
    var r = role();
    var hideFor = { Qari: ['accounts', 'fees', 'receipts', 'settings', 'history', 'users'], Editor: ['settings'] };
    var hide = hideFor[r] || [];
    document.querySelectorAll('#sidebar button').forEach(function (b) {
      var show = hide.indexOf(b.dataset.section) === -1;
      b.style.display = show ? '' : 'none';
      if (!show && b.classList.contains('active')) { b.classList.remove('active'); showSection('dashboard'); }
    });
    // Qari sees only his own class in Students/Attendance; Editor cannot open Settings.
    var setBtn = $('sidebarSettingsBtn'); if (setBtn) setBtn.style.display = (r === 'Admin' || r === 'Editor') ? '' : 'none';
    var usersPanel = $('usersPanel'); if (usersPanel) usersPanel.style.display = (r === 'Admin') ? '' : 'none';
    var adminContactNote = $('adminContactNote');
    if (adminContactNote) adminContactNote.textContent = r === 'Admin' ? '' : 'صرف ایڈمن رابطہ نمبر بدل سکتا ہے۔ (Only Admin can change the contact number.)';
    ['setMadrasaName', 'setMasjidName', 'setAdminName', 'setAdminPhone', 'setAdminWhatsApp', 'setAddress', 'setLogoURL', 'setThemeColor'].forEach(function (id) {
      var el = $(id); if (el) el.disabled = (r !== 'Admin');
    });
    var saveBtn = $('saveSettingsBtn'); if (saveBtn) saveBtn.style.display = (r === 'Admin') ? '' : 'none';
  }

  /* ---------- navigation ---------- */
  window.showSection = function (name) {
    if (name === 'settings' && role() !== 'Admin') { alert('Settings صرف ایڈمن کے لیے ہے۔ (Settings is Admin only.)'); return; }
    if (name === 'accounts' && role() === 'Qari') { alert('حسابات قاری کے لیے نہیں ہیں۔ (Accounts are not for Qari.)'); return; }
    document.querySelectorAll('.section').forEach(function (el) { el.classList.remove('active'); });
    var sec = $('section-' + name);
    if (sec) sec.classList.add('active');
    document.querySelectorAll('#sidebar button').forEach(function (b) { b.classList.toggle('active', b.dataset.section === name); });
    if (name === 'dashboard') renderDashboard();
    if (name === 'fees') { renderFees(); fillFeeStudents(); }
    if (name === 'accounts') { renderAccounts(); renderItems(); }
    if (name === 'receipts') renderReceipts();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderUsers();
    if (name === 'my-account') fillMyAccount();
  };

  /* ---------- sync status pill ---------- */
  function refreshSyncPill() {
    var st = MMLocal.getSyncStatus();
    var pill = $('syncPill');
    if (!pill) return;
    if (!st.apiConfigured) {
      pill.textContent = st.pending ? '💾 Saved locally · Pending (' + st.pending + ') — no API URL yet' : '💾 Saved locally (no API URL yet)';
      pill.classList.add('pending');
    } else if (st.pending) {
      pill.textContent = '⏳ Pending (' + st.pending + ') — tap to sync';
      pill.classList.add('pending');
    } else {
      pill.textContent = '✅ Synced' + (st.lastSync ? ' · ' + new Date(st.lastSync).toLocaleString() : '');
      pill.classList.remove('pending');
    }
    var info = $('localInfo');
    if (info) info.textContent = 'Students: ' + students.length + ' · Teachers: ' + teachers.length + ' · Fees: ' + fees.length + ' · Accounts: ' + accounts.length + ' · Receipts: ' + receipts.length + ' · Ledger: ' + ledger.length + ' · Users: ' + users.length + '\nPending in outbox: ' + st.pending + ' · Last sync: ' + (st.lastSync || 'never') + ' · Online: ' + (st.online ? 'yes' : 'no');
  }

  window.syncNowUI = function () {
    var pill = $('syncPill');
    if (pill) pill.textContent = '🔄 Syncing…';
    MMLocal.syncNow().then(function (r) {
      if (r.ok) { refreshFromServer(); }
      refreshSyncPill();
      if (!r.ok && r.error) alert('Sync: ' + r.error + ' — data is still saved locally.');
    }).catch(function (e) { refreshSyncPill(); alert('Sync failed: ' + e.message + ' — data is still saved locally.'); });
  };

  /* ---------- settings / branding (white-label: nothing hard-coded) ---------- */
  function defaultSettings() {
    return { MadrasaName: 'مدرسہ (Madrasa Name — change in Settings)', MasjidName: 'مسجد (Masjid Name — change in Settings)', AdminName: 'ایڈمن (Admin Name)', AdminPhone: '', AdminWhatsApp: '', Address: '', LogoURL: '', ThemeColor: '#0e7a5f' };
  }
  function loadSettingsLocal() {
    var s = MMLocal.getLocal('settings');
    settings = Object.assign(defaultSettings(), (Array.isArray(s) ? {} : s) || {});
    // settings may be stored as an object (v2) or as key/value rows from the Sheet.
    if (Array.isArray(s)) {
      s.forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
    }
  }
  function applyBranding() {
    var name = settings.MadrasaName || defaultSettings().MadrasaName;
    var masjid = settings.MasjidName || '';
    ['brandName', 'loginBrandName'].forEach(function (id) { var el = $(id); if (el) el.textContent = name; });
    var sub = $('brandSub'); if (sub) sub.textContent = masjid + (settings.Address ? ' — ' + settings.Address : '');
    var phone = $('brandAdminPhone'); if (phone) phone.textContent = settings.AdminPhone ? ('ایڈمن فون (Admin phone): ' + settings.AdminPhone) : '';
    var logo = $('brandLogo'); if (logo) { if (settings.LogoURL) { logo.src = settings.LogoURL; logo.style.display = 'block'; } else logo.style.display = 'none'; }
    var loginLogo = $('loginLogo'); if (loginLogo) { if (settings.LogoURL) { loginLogo.src = settings.LogoURL; loginLogo.style.display = 'block'; } else loginLogo.style.display = 'none'; }
    if (settings.ThemeColor) document.documentElement.style.setProperty('--green', settings.ThemeColor);
  }
  function fillSettingsForm() {
    if (!$('setMadrasaName')) return;
    $('setMadrasaName').value = settings.MadrasaName || '';
    $('setMasjidName').value = settings.MasjidName || '';
    $('setAdminName').value = settings.AdminName || '';
    $('setAdminPhone').value = settings.AdminPhone || '';
    $('setAdminWhatsApp').value = settings.AdminWhatsApp || '';
    $('setAddress').value = settings.Address || '';
    $('setLogoURL').value = settings.LogoURL || '';
    $('setThemeColor').value = settings.ThemeColor || '#0e7a5f';
  }

  /* ---------- load: local first, then server ---------- */
  function loadLocal() {
    MMLocal.seedDemoLocal();
    students = MMLocal.getLocal('students');
    teachers = MMLocal.getLocal('teachers');
    fees = MMLocal.getLocal('fees');
    accounts = MMLocal.getLocal('accounts');
    receipts = MMLocal.getLocal('receipts');
    attendance = MMLocal.getLocal('attendance');
    users = MMLocal.getLocal('users');
    // v3: old local stores (seeded by v1/v2) lack the new email fields — normalise.
    users.forEach(function (u) {
      if (u.Email === undefined) u.Email = '';
      if (!u.EmailVerified) u.EmailVerified = 'No';
      if (u.VerifiedDate === undefined) u.VerifiedDate = '';
      if (u.ResetCode === undefined) u.ResetCode = '';
      if (u.ResetExpiry === undefined) u.ResetExpiry = '';
    });
    ledger = MMLocal.getLocal('ledger');
    items = MMLocal.getLocal('items');
    sabaq = MMLocal.getLocal('sabaq');
    loadSettingsLocal();
  }

  function refreshFromServer() {
    if (!MMLocal.getApiUrl()) return;
    MMLocal.apiGet('getStudents').then(function (d) { if (d.students) { students = d.students; MMLocal.saveLocal('students', students); renderStudents(); renderDashboard(); } }).catch(function () {});
    MMLocal.apiGet('getTeachers').then(function (d) { if (d.teachers) { teachers = d.teachers; MMLocal.saveLocal('teachers', teachers); renderTeachers(); } }).catch(function () {});
    MMLocal.apiGet('getFees').then(function (d) { if (d.fees) { fees = d.fees; MMLocal.saveLocal('fees', fees); renderFees(); } }).catch(function () {});
    MMLocal.apiGet('getAccounts').then(function (d) { if (d.accounts) { accounts = d.accounts; MMLocal.saveLocal('accounts', accounts); renderAccounts(); renderDashboard(); } }).catch(function () {});
    MMLocal.apiGet('getReceipts').then(function (d) { if (d.receipts) { receipts = d.receipts; MMLocal.saveLocal('receipts', receipts); renderReceipts(); } }).catch(function () {});
    MMLocal.apiGet('getDashboard').then(function (d) { if (d.dashboard) renderDashboard(d.dashboard); }).catch(function () {});
    MMLocal.apiGet('getSettings').then(function (d) { if (d.settings) { settings = Object.assign(defaultSettings(), d.settings); MMLocal.saveLocal('settings', settings); applyBranding(); fillSettingsForm(); } }).catch(function () {});
    MMLocal.apiGet('getUsers').then(function (d) { if (d.users) { users = d.users; MMLocal.saveLocal('users', users); renderUsers(); } }).catch(function () {});
    MMLocal.apiGet('getItems').then(function (d) { if (d.items) { items = d.items; MMLocal.saveLocal('items', items); renderItems(); } }).catch(function () {});
  }

  /* ---------- dashboard ---------- */
  function renderDashboard(serverDash) {
    var d = serverDash || computeDashboard();
    var el = $('dashCards');
    if (!el) return;
    el.innerHTML =
      card('موجودہ طلبہ (Current students)', d.currentStudents, 'green') +
      card('کبھی داخل ہوئے (Total joined ever)', d.totalJoinedEver, '') +
      card('حفظ مکمل (Hifz completed)', d.hifzCompleted, '') +
      card('چھوڑ گئے (Left)', d.leftStudents, 'red') +
      card('اس مہینے نئے داخلے (New admissions)', d.newAdmissionsThisMonth, 'green') +
      card('داخلہ فیس باقی (Admission fee pending)', d.admissionFeePendingCount + ' طلبہ · ' + rs(d.admissionFeePendingAmount), 'amber') +
      card('اساتذہ (Teachers active)', d.teachersActive + ' / ' + d.teachersTotal, '') +
      '<div class="card madrasa"><div class="label">مدرسہ بیلنس (Madrasa balance)</div><div class="value green">' + rs(d.madrasaBalance) + '</div></div>' +
      '<div class="card masjid"><div class="label">مسجد بیلنس (Masjid balance)</div><div class="value green">' + rs(d.masjidBalance) + '</div></div>' +
      card('اس مہینے فیس وصول (Fees collected)', rs(d.feesCollectedThisMonth), 'green') +
      card('فیس باقی (Fees pending)', d.feesPendingCount + ' طلبہ · ' + rs(d.feesPendingAmount), 'amber');
    var att = attendance.filter(function (a) { return a.Date === today(); });
    $('dashAttendance').textContent = att.length
      ? att.map(function (a) { return a.Date + ' · ' + a.Session + ' · ' + (a.StudentID === 'SUMMARY' ? a.Status : a.StudentID + ' — ' + a.Status); }).join('\n')
      : 'آج کی حاضری ابھی درج نہیں ہوئی۔ (No attendance recorded today yet.)';
    var hc = $('dashHistory');
    if (hc) hc.textContent = 'کل داخل: ' + d.totalJoinedEver + ' · موجودہ: ' + d.currentStudents + ' · حفظ مکمل: ' + d.hifzCompleted + ' · چھوڑ گئے: ' + d.leftStudents + ' · اساتذہ: ' + d.teachersActive + ' فعال / ' + d.teachersLeft + ' چھوڑ گئے۔ تفصیل History سیکشن میں دیکھیں۔';
    var ac = $('dashAdminContact');
    if (ac) ac.textContent = settings.AdminName && settings.AdminPhone ? (settings.AdminName + ' — ' + settings.AdminPhone) : 'ایڈمن رابطہ نمبر Settings میں درج کریں۔ (Set the admin contact number in Settings.)';
    renderNotifLog();
  }
  function card(label, value, cls) { return '<div class="card"><div class="label">' + label + '</div><div class="value ' + (cls || '') + '">' + value + '</div></div>'; }
  function computeDashboard() {
    var ym = thisMonth();
    var bal = { Madrasa: 0, Masjid: 0 };
    accounts.forEach(function (a) { var amt = Number(a.Amount) || 0; if (a.Type === 'Income') bal[a.Fund] = (bal[a.Fund] || 0) + amt; if (a.Type === 'Expense') bal[a.Fund] = (bal[a.Fund] || 0) - amt; });
    return {
      currentStudents: students.filter(function (s) { return s.Status === 'Current'; }).length,
      totalJoinedEver: students.length,
      hifzCompleted: students.filter(function (s) { return s.Status === 'HifzCompleted'; }).length,
      leftStudents: students.filter(function (s) { return s.Status === 'Left'; }).length,
      newAdmissionsThisMonth: students.filter(function (s) { return String(s.AdmissionDate || '').indexOf(ym) === 0; }).length,
      admissionFeePendingCount: students.filter(function (s) { return String(s.AdmissionFeePaid) !== 'Yes' && s.Status === 'Current'; }).length,
      admissionFeePendingAmount: students.filter(function (s) { return String(s.AdmissionFeePaid) !== 'Yes' && s.Status === 'Current'; }).reduce(function (sum, s) { return sum + (Number(s.AdmissionFeeAmount) || 0); }, 0),
      teachersActive: teachers.filter(function (t) { return t.Status === 'Active'; }).length,
      teachersTotal: teachers.length,
      teachersLeft: teachers.filter(function (t) { return t.Status === 'Left'; }).length,
      madrasaBalance: bal.Madrasa || 0, masjidBalance: bal.Masjid || 0,
      feesCollectedThisMonth: fees.filter(function (f) { return f.Status === 'Paid' && String(f.Date || '').indexOf(ym) === 0; }).reduce(function (s, f) { return s + (Number(f.Amount) || 0); }, 0),
      feesPendingCount: fees.filter(function (f) { return f.Status === 'Unpaid'; }).length,
      feesPendingAmount: fees.filter(function (f) { return f.Status === 'Unpaid'; }).reduce(function (s, f) { return s + (Number(f.Amount) || 0); }, 0)
    };
  }

  /* ---------- Qari notification LOG (log only — NOT a sent push) ---------- */
  function logQariNotification(text) {
    var log = [];
    try { log = JSON.parse(localStorage.getItem('mm_v1_notiflog') || '[]'); } catch (e) {}
    log.unshift(new Date().toLocaleString() + ' — ' + text + '  [LOG ONLY — push notification not built yet]');
    try { localStorage.setItem('mm_v1_notiflog', JSON.stringify(log.slice(0, 50))); } catch (e) {}
    renderNotifLog();
  }
  function renderNotifLog() {
    var el = $('notifLog'); if (!el) return;
    var log = [];
    try { log = JSON.parse(localStorage.getItem('mm_v1_notiflog') || '[]'); } catch (e) {}
    el.textContent = log.length ? log.join('\n') : 'ابھی کوئی نوٹیفکیشن نہیں۔ (No notifications yet.)';
  }

  /* ---------- students ---------- */
  function visibleStudents() {
    // Qari sees only his own class (his teacher record's Class, matched by name/phone where possible).
    if (role() !== 'Qari') return students;
    var me = teachers.filter(function (t) { return t.Name === currentUser.Name; })[0];
    if (!me) return students;
    return students.filter(function (s) { return s.Class === me.Class; });
  }
  window.renderStudents = function () {
    var q = ($('stSearch').value || '').toLowerCase();
    var fs = $('stFilterStatus').value, fc = $('stFilterClass').value;
    var rows = visibleStudents().filter(function (s) {
      return (!fs || s.Status === fs) && (!fc || s.Class === fc) &&
        (!q || (s.Name + ' ' + s.FatherName + ' ' + s.Class + ' ' + (s.Address || '')).toLowerCase().indexOf(q) !== -1);
    });
    $('studentsTable').innerHTML = rows.length ? rows.map(function (s) {
      var sessions = [s.Session1 === 'yes' ? '1st' : '', s.Session2 === 'yes' ? '2nd' : '', s.NightSession === 'yes' ? 'Night' : ''].filter(Boolean).join(', ') || '—';
      var adm = String(s.AdmissionFeePaid) === 'Yes' ? '<span class="badge paid">Admission ✓</span>' : '<span class="badge unpaid">Admission باقی ' + rs(s.AdmissionFeeAmount) + '</span>';
      return '<tr><td>' + (s.PhotoURL ? '<img src="' + esc(s.PhotoURL) + '" style="width:36px;height:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-inline-end:6px" alt="">' : '') + esc(s.Name) + '</td>' +
        '<td>' + esc(s.FatherName) + '</td><td>' + esc(s.Class) + '</td><td>' + sessions + '</td><td>' + rs(s.MonthlyFee) + '</td>' +
        '<td>' + adm + '</td>' +
        '<td><span class="badge ' + (s.Status === 'Current' ? 'current' : s.Status === 'HifzCompleted' ? 'hifz' : 'left') + '">' + esc(s.Status) + '</span></td>' +
        '<td><button class="btn small secondary" onclick="showStudentProfile(\'' + esc(s.StudentID) + '\')">👤 پروفائل</button> ' +
        '<button class="btn small secondary" onclick="editStudent(\'' + esc(s.StudentID) + '\')">✏️ ترمیم</button> ' +
        '<button class="btn small secondary" onclick="changeStudentStatus(\'' + esc(s.StudentID) + '\')">🔁 اسٹیٹس</button></td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">کوئی طالب علم نہیں ملا۔ (No students found — add one above.)</td></tr>';
  };

  window.editStudent = function (id) {
    if (!requireRole('saveStudent')) return;
    var s = students.find(function (x) { return String(x.StudentID) === String(id); });
    if (!s) return;
    $('stId').value = s.StudentID; $('stName').value = s.Name || ''; $('stFather').value = s.FatherName || '';
    $('stAge').value = s.Age || ''; $('stClass').value = s.Class || 'ناظرہ'; $('stAdmission').value = s.AdmissionDate || '';
    $('stFee').value = s.MonthlyFee || 0; $('stPhone').value = s.FatherPhone || ''; $('stStatus').value = s.Status || 'Current';
    $('stS1').value = s.Session1 || 'yes'; $('stS2').value = s.Session2 || 'yes'; $('stNight').value = s.NightSession || 'no';
    $('stPhotoURL').value = s.PhotoURL || '';
    if ($('stAddress')) $('stAddress').value = s.Address || '';
    if ($('stGuardian')) $('stGuardian').value = s.GuardianPhone || '';
    if ($('stAdmFee')) $('stAdmFee').value = s.AdmissionFeeAmount || 0;
    if ($('stAdmPaid')) $('stAdmPaid').value = s.AdmissionFeePaid || 'No';
    if ($('stAdmDate')) $('stAdmDate').value = s.AdmissionFeeDate || '';
    $('studentFormTitle').textContent = 'طالب علم میں ترمیم (Edit student)';
    window.scrollTo(0, 0);
  };

  window.changeStudentStatus = function (id) {
    if (!requireRole('saveStudent')) return;
    var s = students.find(function (x) { return String(x.StudentID) === String(id); });
    if (!s) return;
    var next = s.Status === 'Current' ? 'HifzCompleted' : s.Status === 'HifzCompleted' ? 'Left' : 'Current';
    if (!confirm(s.Name + ' — اسٹیٹس ' + s.Status + ' سے ' + next + ' کریں؟')) return;
    s.Status = next;
    persistStudent(s);
  };

  window.resetStudentForm = function () {
    $('studentForm').reset(); $('stId').value = ''; $('stPhotoURL').value = '';
    $('photoPreview').style.display = 'none'; $('photoSizeNote').textContent = ''; pendingPhoto = null;
    $('studentFormTitle').textContent = 'نیا طالب علم شامل کریں (Add student)';
  };

  function persistStudent(s) {
    MMLocal.upsertLocal('students', 'StudentID', s);
    MMLocal.queueChange('saveStudent', { student: s, role: role() });
    renderStudents(); renderDashboard(); refreshSyncPill();
    if (profileStudentId === s.StudentID) renderStudentProfile();
  }

  window.saveStudentUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveStudent')) return;
    var s = {
      StudentID: $('stId').value || ('STU-' + Date.now()),
      Name: $('stName').value.trim(), FatherName: $('stFather').value.trim(),
      Age: Number($('stAge').value) || '', Class: $('stClass').value,
      Session1: $('stS1').value, Session2: $('stS2').value, NightSession: $('stNight').value,
      AdmissionDate: $('stAdmission').value || today(), MonthlyFee: Number($('stFee').value) || 0,
      Status: $('stStatus').value, FatherPhone: $('stPhone').value.trim(),
      GuardianPhone: $('stGuardian') ? $('stGuardian').value.trim() : '',
      Address: $('stAddress') ? $('stAddress').value.trim() : '',
      AdmissionFeeAmount: $('stAdmFee') ? Number($('stAdmFee').value) || 0 : 0,
      AdmissionFeePaid: $('stAdmPaid') ? $('stAdmPaid').value : 'No',
      AdmissionFeeDate: $('stAdmDate') ? $('stAdmDate').value : '',
      AdmissionFeeReceiptNo: '',
      ClassHistory: '',
      PhotoURL: pendingPhoto ? pendingPhoto.url : ($('stPhotoURL').value || '')
    };
    if (!s.Name) { alert('نام ضروری ہے (Name is required).'); return; }
    var old = students.find(function (x) { return String(x.StudentID) === String(s.StudentID); });
    if (old) { s.ClassHistory = old.ClassHistory || old.Class || ''; if (old.Class && old.Class !== s.Class) s.ClassHistory = (s.ClassHistory ? s.ClassHistory + ' > ' : '') + s.Class; s.AdmissionFeeReceiptNo = old.AdmissionFeeReceiptNo || ''; }
    else s.ClassHistory = s.Class;
    if (s.AdmissionFeePaid === 'Yes' && !s.AdmissionFeeReceiptNo) s.AdmissionFeeReceiptNo = 'MSD-ADM-' + Date.now().toString().slice(-6);
    persistStudent(s);
    resetStudentForm();
    alert('محفوظ ہو گیا — Saved locally' + (MMLocal.getApiUrl() ? ' and queued for sync.' : ' (no API URL yet — set it in Settings to sync to the Sheet).'));
  };

  /* ---------- student profile + per-student ledger ---------- */
  window.showStudentProfile = function (id) {
    profileStudentId = id;
    renderStudentProfile();
    showSection('student-profile');
  };
  window.backToStudents = function () { profileStudentId = null; showSection('students'); };
  function renderStudentProfile() {
    var s = students.find(function (x) { return String(x.StudentID) === String(profileStudentId); });
    var el = $('studentProfileView'); if (!el || !s) return;
    var rows = ledger.filter(function (r) { return String(r.StudentID) === String(s.StudentID); });
    var balance = 0;
    rows.forEach(function (r) { var a = Number(r.Amount) || 0; if (r.Type === 'PaymentFromHome') balance += a; else if (r.Type === 'Fee') balance -= a; else if (r.Type === 'Refund') balance -= a; else balance += a; });
    var sabaqRows = sabaq.filter(function (r) { return String(r.StudentID) === String(s.StudentID); }).slice(-5).reverse();
    el.innerHTML =
      '<div class="profile-head">' + (s.PhotoURL ? '<img src="' + esc(s.PhotoURL) + '" class="profile-photo" alt="">' : '<div class="profile-photo placeholder">👤</div>') +
      '<div><h3>' + esc(s.Name) + '</h3><p>والد: ' + esc(s.FatherName) + ' · جماعت: ' + esc(s.Class) + ' · اسٹیٹس: ' + esc(s.Status) + '</p>' +
      '<p>عمر: ' + esc(s.Age) + ' · داخلہ: ' + esc(s.AdmissionDate) + ' · ماہانہ فیس: ' + rs(s.MonthlyFee) + '</p>' +
      '<p>پتہ / مقام (Address/Location): ' + esc(s.Address || '—') + '</p>' +
      '<p>والد کا فون: <span dir="ltr">' + esc(s.FatherPhone || '—') + '</span> · سرپرست فون: <span dir="ltr">' + esc(s.GuardianPhone || '—') + '</span></p>' +
      '<p>جماعت کی تاریخ (Class history): ' + esc(s.ClassHistory || s.Class || '—') + '</p>' +
      '<p>داخلہ فیس (Admission fee): ' + rs(s.AdmissionFeeAmount) + ' — ' + (String(s.AdmissionFeePaid) === 'Yes' ? 'وصول ✓ (' + esc(s.AdmissionFeeDate || '') + ' · ' + esc(s.AdmissionFeeReceiptNo || '') + ')' : 'باقی (Not collected)') + '</p></div></div>' +
      '<h4>گھر سے وصولی — الگ کھاتہ (Per-student ledger) · بیلنس: ' + rs(balance) + '</h4>' +
      '<div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>قسم</th><th>رقم</th><th>طریقہ</th><th>رسید</th><th>نوٹ</th></tr></thead><tbody>' +
      (rows.length ? rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(r.Date) + '</td><td>' + esc(r.Type) + '</td><td>' + rs(r.Amount) + '</td><td>' + esc(r.Method) + '</td><td>' + esc(r.ReceiptNo) + '</td><td>' + esc(r.Note) + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">کھاتے میں کوئی لین دین نہیں۔ (No ledger entries yet.)</td></tr>') +
      '</tbody></table></div>' +
      '<h4>سبق (Sabaq — recent)</h4><div class="log">' + (sabaqRows.length ? sabaqRows.map(function (r) { return r.Date + ' — ' + r.Sabaq + ' (' + (r.Amount || '') + ') ' + (r.TeacherNote || ''); }).join('\n') : '—') + '</div>';
    var sel = $('ledgerStudent'); if (sel) sel.value = s.StudentID;
  }
  window.recordLedgerUI = function (e) {
    e.preventDefault();
    if (!requireRole('recordLedger')) return;
    var entry = {
      LedgerID: 'LED-' + Date.now(), Date: $('ledgerDate').value || today(),
      StudentID: $('ledgerStudent').value, Type: $('ledgerType').value,
      Amount: Number($('ledgerAmount').value) || 0, Method: $('ledgerMethod').value,
      ReceiptNo: 'MSD-' + new Date().getFullYear() + '-' + String(receipts.length + ledger.length + 1).padStart(4, '0'),
      Note: $('ledgerNote').value.trim()
    };
    if (!entry.StudentID || !entry.Amount) { alert('طالب علم اور رقم ضروری ہیں۔'); return; }
    ledger.push(entry); MMLocal.saveLocal('ledger', ledger);
    receipts.push({ ReceiptNo: entry.ReceiptNo, Date: entry.Date, Fund: 'Madrasa', StudentID: entry.StudentID, TeacherID: '', Amount: entry.Amount, Purpose: entry.Type + ' — ' + entry.Note });
    MMLocal.saveLocal('receipts', receipts);
    MMLocal.queueChange('recordLedger', { entry: entry, role: role() });
    renderStudentProfile(); renderReceipts(); renderDashboard(); refreshSyncPill();
    alert('کھاتے میں درج ہو گیا — رسید نمبر: ' + entry.ReceiptNo);
  };
  function fillLedgerStudents() {
    var sel = $('ledgerStudent'); if (!sel) return;
    sel.innerHTML = students.filter(function (s) { return s.Status === 'Current'; }).map(function (s) { return '<option value="' + esc(s.StudentID) + '">' + esc(s.Name) + ' — ' + esc(s.Class) + '</option>'; }).join('');
  }

  /* ---------- photo ---------- */
  window.photoPicked = function (input) {
    var file = input.files && input.files[0];
    if (!file) return;
    $('photoSizeNote').textContent = 'Compressing…';
    MMImage.compressImage(file).then(function (c) {
      $('photoSizeNote').textContent = 'اصل سائز (Before): ' + MMImage.formatSize(c.originalSize) + ' → کمپریس شدہ (After): ' + MMImage.formatSize(c.compressedSize) + ' (' + c.width + '×' + c.height + 'px, JPEG 0.75)';
      var prev = $('photoPreview'); prev.src = c.dataUrl; prev.style.display = 'block';
      pendingPhoto = null;
      return MMImage.uploadImage(file).then(function (u) {
        pendingPhoto = u;
        $('stPhotoURL').value = u.url;
        $('photoSizeNote').textContent += ' ✅ Uploaded — URL saved (base64 NOT stored in Sheet).';
      }).catch(function (err) {
        $('photoSizeNote').textContent += ' ⚠️ ' + err.message + ' — photo preview only; URL not saved yet.';
      });
    }).catch(function (err) { $('photoSizeNote').textContent = '⚠️ ' + err.message; });
  };

  /* ---------- teachers + Qari profile ---------- */
  window.renderTeachers = function () {
    var list = teachers;
    if (role() === 'Qari') list = teachers.filter(function (t) { return t.Name === currentUser.Name; });
    $('teachersTable').innerHTML = list.length ? list.map(function (t) {
      return '<tr><td>' + esc(t.Name) + '</td><td dir="ltr">' + esc(t.Phone) + '</td><td>' + esc(t.Class) + '</td><td>' + esc(t.JoinDate) + '</td><td>' + rs(t.MonthlySalary) + '</td>' +
        '<td><span class="badge ' + (t.Status === 'Active' ? 'active' : 'left') + '">' + esc(t.Status) + '</span></td>' +
        '<td><button class="btn small secondary" onclick="showTeacherProfile(\'' + esc(t.TeacherID) + '\')">👤 پروفائل</button> ' +
        '<button class="btn small secondary" onclick="editTeacher(\'' + esc(t.TeacherID) + '\')">✏️ ترمیم</button> ' +
        '<button class="btn small secondary" onclick="changeTeacherStatus(\'' + esc(t.TeacherID) + '\')">🔁 اسٹیٹس</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">کوئی استاد نہیں۔ (No teachers yet.)</td></tr>';
  };
  window.editTeacher = function (id) {
    if (!requireRole('saveTeacher')) return;
    var t = teachers.find(function (x) { return String(x.TeacherID) === String(id); });
    if (!t) return;
    $('tId').value = t.TeacherID; $('tName').value = t.Name || ''; $('tPhone').value = t.Phone || '';
    $('tClass').value = t.Class || ''; $('tJoin').value = t.JoinDate || ''; $('tSalary').value = t.MonthlySalary || 0; $('tStatus').value = t.Status || 'Active';
  };
  window.changeTeacherStatus = function (id) {
    if (!requireRole('saveTeacher')) return;
    var t = teachers.find(function (x) { return String(x.TeacherID) === String(id); });
    if (!t) return;
    t.Status = t.Status === 'Active' ? 'Left' : 'Active';
    if (t.Status === 'Left') t.LeaveDate = today();
    persistTeacher(t);
  };
  window.resetTeacherForm = function () { $('teacherForm').reset(); $('tId').value = ''; };
  function persistTeacher(t) {
    MMLocal.upsertLocal('teachers', 'TeacherID', t);
    MMLocal.queueChange('saveTeacher', { teacher: t, role: role() });
    renderTeachers(); renderDashboard(); refreshSyncPill();
    if (profileTeacherId === t.TeacherID) renderTeacherProfile();
  }
  window.saveTeacherUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveTeacher')) return;
    var t = { TeacherID: $('tId').value || ('TCH-' + Date.now()), Name: $('tName').value.trim(), Phone: $('tPhone').value.trim(), Class: $('tClass').value.trim(), JoinDate: $('tJoin').value || today(), LeaveDate: '', Status: $('tStatus').value, MonthlySalary: Number($('tSalary').value) || 0, PhotoURL: '' };
    if (!t.Name) { alert('نام ضروری ہے (Name is required).'); return; }
    persistTeacher(t); resetTeacherForm();
    alert('استاد محفوظ ہو گیا — Teacher saved locally.');
  };
  window.showTeacherProfile = function (id) {
    profileTeacherId = id;
    renderTeacherProfile();
    showSection('teacher-profile');
  };
  window.backToTeachers = function () { profileTeacherId = null; showSection('teachers'); };
  function renderTeacherProfile() {
    var t = teachers.find(function (x) { return String(x.TeacherID) === String(profileTeacherId); });
    var el = $('teacherProfileView'); if (!el || !t) return;
    var myStudents = students.filter(function (s) { return s.Class === t.Class; });
    var salaryRows = receipts.filter(function (r) { return String(r.TeacherID) === String(t.TeacherID); });
    var advanceRows = accounts.filter(function (a) { return String(a.TeacherID) === String(t.TeacherID) && String(a.Category).indexOf('ایڈوانس') !== -1; });
    var salaryPaid = salaryRows.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0);
    var advances = advanceRows.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0);
    var marked = attendance.filter(function (a) { return a.MarkedBy === t.Name; });
    el.innerHTML =
      '<div class="profile-head"><div class="profile-photo placeholder">👳</div><div><h3>' + esc(t.Name) + ' — قاری صاحب</h3>' +
      '<p>فون: <span dir="ltr">' + esc(t.Phone || '—') + '</span> · جماعت: ' + esc(t.Class) + ' · تقرری: ' + esc(t.JoinDate) + ' · اسٹیٹس: ' + esc(t.Status) + (t.LeaveDate ? ' (چھوڑنے کی تاریخ: ' + esc(t.LeaveDate) + ')' : '') + '</p>' +
      '<p>ماہانہ تنخواہ: ' + rs(t.MonthlySalary) + ' · تنخواہ ادا شدہ (Salary paid): ' + rs(salaryPaid) + ' · ایڈوانس لیا (Advances taken): ' + rs(advances) + '</p>' +
      '<p>اس کی جماعت کے طلبہ: ' + myStudents.filter(function (s) { return s.Status === 'Current'; }).length + ' موجودہ / ' + myStudents.length + ' کل</p>' +
      '<p>حاضری لگائی (Attendance marked): ' + marked.length + ' ریکارڈ</p></div></div>' +
      '<h4>اس کی جماعت کے طلبہ (Students in his class)</h4><div class="log">' + (myStudents.length ? myStudents.map(function (s) { return s.Name + ' — ' + s.Class + ' (' + s.Status + ')'; }).join('\n') : '—') + '</div>' +
      '<h4>تنخواہ / ایڈوانس کی تاریخ (Salary &amp; advance history)</h4><div class="log">' +
      (salaryRows.length ? salaryRows.map(function (r) { return r.Date + ' — ' + r.Purpose + ' — ' + rs(r.Amount) + ' (' + r.ReceiptNo + ')'; }).join('\n') : 'تنخواہ کا کوئی ریکارڈ نہیں۔') + '\n' +
      (advanceRows.length ? advanceRows.map(function (a) { return a.Date + ' — Advance — ' + rs(a.Amount) + ' — ' + a.Description; }).join('\n') : '') + '</div>';
  }

  /* ---------- attendance ---------- */
  window.renderAttendanceList = function () {
    var session = $('attSession').value;
    var current = students.filter(function (s) { return s.Status === 'Current'; });
    if (role() === 'Qari') {
      var me = teachers.filter(function (t) { return t.Name === currentUser.Name; })[0];
      if (me) current = current.filter(function (s) { return s.Class === me.Class; });
    }
    if (session === '1st') attSessionList = current.filter(function (s) { return s.Session1 === 'yes'; });
    else if (session === '2nd') attSessionList = current.filter(function (s) { return s.Session2 === 'yes'; });
    else attSessionList = current.filter(function (s) { return s.NightSession === 'yes'; });
    attMarks = {};
    $('attCount').textContent = 'سیشن: ' + session + ' — ' + attSessionList.length + ' طلبہ (all Present by default — صرف Absent / Leave پر ٹیپ کریں)';
    $('attList').innerHTML = attSessionList.length ? attSessionList.map(function (s) {
      return '<div class="att-row" id="att-' + esc(s.StudentID) + '"><span class="name">' + esc(s.Name) + '</span><span class="cls">' + esc(s.Class) + '</span>' +
        '<button class="toggle" onclick="toggleAtt(\'' + esc(s.StudentID) + '\',\'Absent\',this)">❌ Absent</button>' +
        '<button class="toggle" onclick="toggleAtt(\'' + esc(s.StudentID) + '\',\'Leave\',this)">🟡 Leave</button></div>';
    }).join('') : '<div class="empty">اس سیشن میں کوئی طالب علم نہیں۔ (No students in this session.)</div>';
  };
  window.toggleAtt = function (id, kind, btn) {
    var row = $('att-' + id);
    if (attMarks[id] === kind) { delete attMarks[id]; }
    else attMarks[id] = kind;
    if (row) {
      row.classList.toggle('marked-absent', attMarks[id] === 'Absent');
      row.classList.toggle('marked-leave', attMarks[id] === 'Leave');
      row.querySelectorAll('.toggle').forEach(function (b) { b.classList.remove('absent-on', 'leave-on'); });
      if (attMarks[id] === 'Absent') btn.classList.add('absent-on');
      if (attMarks[id] === 'Leave') btn.classList.add('leave-on');
    }
  };
  window.saveAttendanceUI = function () {
    if (!requireRole('saveAttendance')) return;
    if (!attSessionList.length) { alert('پہلے فہرست دکھائیں (Show the list first).'); return; }
    var date = $('attDate').value || today();
    var session = $('attSession').value;
    var absent = [], leave = [];
    Object.keys(attMarks).forEach(function (id) { if (attMarks[id] === 'Absent') absent.push(id); else leave.push(id); });
    var present = attSessionList.length - absent.length - leave.length;
    absent.forEach(function (id) { attendance.push({ Date: date, Session: session, StudentID: id, Status: 'Absent', MarkedBy: $('attBy').value || (currentUser ? currentUser.Name : '') }); });
    leave.forEach(function (id) { attendance.push({ Date: date, Session: session, StudentID: id, Status: 'Leave', MarkedBy: $('attBy').value || (currentUser ? currentUser.Name : '') }); });
    attendance.push({ Date: date, Session: session, StudentID: 'SUMMARY', Status: 'Present: ' + present + ' | Absent: ' + absent.length + ' | Leave: ' + leave.length, MarkedBy: $('attBy').value || (currentUser ? currentUser.Name : '') });
    MMLocal.saveLocal('attendance', attendance);
    MMLocal.queueChange('saveAttendance', { date: date, session: session, markedBy: $('attBy').value || (currentUser ? currentUser.Name : ''), absent: absent, leave: leave, totalInSession: attSessionList.length, role: role() });
    $('attSavedNote').textContent = '✅ محفوظ — Present: ' + present + ' · Absent: ' + absent.length + ' · Leave: ' + leave.length;
    renderDashboard(); refreshSyncPill();
  };
  window.saveSabaqUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveSabaq')) return;
    var s = { Date: $('sabaqDate').value || today(), StudentID: $('sabaqStudent').value, Sabaq: $('sabaqText').value.trim(), Amount: $('sabaqAmount').value.trim(), TeacherNote: $('sabaqNote').value.trim(), MarkedBy: currentUser ? currentUser.Name : '' };
    if (!s.StudentID || !s.Sabaq) { alert('طالب علم اور سبق ضروری ہیں۔'); return; }
    sabaq.push(s); MMLocal.saveLocal('sabaq', sabaq);
    MMLocal.queueChange('saveSabaq', { sabaq: s, role: role() });
    e.target.reset();
    alert('سبق محفوظ ہو گیا — Sabaq saved.');
    refreshSyncPill();
  };
  function fillSabaqStudents() {
    var sel = $('sabaqStudent'); if (!sel) return;
    sel.innerHTML = visibleStudents().filter(function (s) { return s.Status === 'Current'; }).map(function (s) { return '<option value="' + esc(s.StudentID) + '">' + esc(s.Name) + ' — ' + esc(s.Class) + '</option>'; }).join('');
  }

  /* ---------- fees + receipts ---------- */
  function fillFeeStudents() {
    var sel = $('feeStudent');
    sel.innerHTML = students.filter(function (s) { return s.Status === 'Current'; }).map(function (s) {
      return '<option value="' + esc(s.StudentID) + '">' + esc(s.Name) + ' — ' + esc(s.Class) + ' (' + rs(s.MonthlyFee) + '/month)</option>';
    }).join('');
  }
  function nextReceiptNoLocal() {
    var y = new Date().getFullYear();
    var n = receipts.filter(function (r) { return String(r.ReceiptNo || '').indexOf('MSD-' + y + '-') === 0; }).length + 1;
    return 'MSD-' + y + '-' + String(n).padStart(4, '0');
  }
  window.recordFeeUI = function (e) {
    e.preventDefault();
    if (!requireRole('recordFee')) return;
    var fee = {
      studentId: $('feeStudent').value, month: $('feeMonth').value, amount: Number($('feeAmount').value) || 0,
      method: $('feeMethod').value, date: $('feeDate').value || today()
    };
    if (!fee.studentId || !fee.month || !fee.amount) { alert('طالب علم، مہینہ اور رقم ضروری ہیں۔'); return; }
    var receiptNo = nextReceiptNoLocal();
    var feeRow = { ReceiptNo: receiptNo, Date: fee.date, StudentID: fee.studentId, Month: fee.month, Amount: fee.amount, Status: 'Paid', Method: fee.method };
    fees.push(feeRow); MMLocal.saveLocal('fees', fees);
    var rec = { ReceiptNo: receiptNo, Date: fee.date, Fund: 'Madrasa', StudentID: fee.studentId, TeacherID: '', Amount: fee.amount, Purpose: 'Monthly fee ' + fee.month };
    receipts.push(rec); MMLocal.saveLocal('receipts', receipts);
    accounts.push({ Date: fee.date, Fund: 'Madrasa', Type: 'Income', Category: 'فیس', Item: '', Allocated: '', AllocatedAmount: 0, SpentAmount: 0, Amount: fee.amount, Description: 'Fee ' + fee.month + ' — ' + studentName(fee.studentId), ReceiptNo: receiptNo, EnteredBy: currentUser ? currentUser.Name : '', TeacherID: '' });
    MMLocal.saveLocal('accounts', accounts);
    ledger.push({ LedgerID: 'LED-' + Date.now(), Date: fee.date, StudentID: fee.studentId, Type: 'Fee', Amount: fee.amount, Method: fee.method, ReceiptNo: receiptNo, Note: 'Monthly fee ' + fee.month });
    MMLocal.saveLocal('ledger', ledger);
    MMLocal.queueChange('recordFee', { fee: fee, role: role() });
    var qariEmails = users.filter(function (x) { return x.Role === 'Qari' && x.Email; }).map(function (x) { return x.Email; }).join(', ');
    logQariNotification('Fee received — ' + studentName(fee.studentId) + ' · ' + fee.month + ' · ' + rs(fee.amount) + ' · Receipt ' + receiptNo + ' — notify Qari Sahib' + (qariEmails ? ' (email: ' + qariEmails + ')' : ' (no Qari email saved yet)'));
    showReceipt(rec, studentName(fee.studentId));
    renderFees(); renderReceipts(); renderDashboard(); refreshSyncPill();
  };
  function showReceipt(rec, name) {
    $('receiptPanel').style.display = 'block';
    $('receiptView').innerHTML = '<h3>🕌 ' + esc(settings.MadrasaName || 'مدرسہ') + ' — رسید (Receipt)</h3><table>' +
      '<tr><td>رسید نمبر (Receipt No.)</td><td><b>' + esc(rec.ReceiptNo) + '</b></td></tr>' +
      '<tr><td>تاریخ (Date)</td><td>' + esc(rec.Date) + '</td></tr>' +
      '<tr><td>طالب علم (Student)</td><td>' + esc(name) + '</td></tr>' +
      '<tr><td>مقصد (Purpose)</td><td>' + esc(rec.Purpose) + '</td></tr>' +
      '<tr><td>رقم (Amount)</td><td><b>' + rs(rec.Amount) + '</b></td></tr></table>' +
      '<p style="text-align:center;color:#6b7d76;font-size:13px">جزاک اللہ خیراً — Thank you</p>';
  }
  window.renderFees = function () {
    $('feesTable').innerHTML = fees.length ? fees.slice().reverse().map(function (f) {
      return '<tr><td>' + esc(f.ReceiptNo) + '</td><td>' + esc(f.Date) + '</td><td>' + esc(studentName(f.StudentID)) + '</td><td>' + esc(f.Month) + '</td><td>' + rs(f.Amount) + '</td><td><span class="badge ' + (f.Status === 'Paid' ? 'paid' : 'unpaid') + '">' + esc(f.Status) + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">کوئی فیس درج نہیں۔ (No fees recorded yet.)</td></tr>';
  };

  /* ---------- accounts + expenses by item ---------- */
  window.recordTransactionUI = function (e) {
    e.preventDefault();
    if (!requireRole('recordTransaction')) return;
    var tx = { fund: $('txFund').value, type: $('txType').value, category: $('txCategory').value.trim(), item: $('txItem') ? $('txItem').value.trim() : '', allocated: $('txAllocated') ? $('txAllocated').value : '', allocatedAmount: $('txAllocAmount') ? Number($('txAllocAmount').value) || 0 : 0, amount: Number($('txAmount').value) || 0, description: $('txDesc').value.trim(), date: $('txDate').value || today(), receiptNo: '', enteredBy: currentUser ? currentUser.Name : '', teacherId: $('txTeacher') ? $('txTeacher').value : '' };
    if (!tx.amount) { alert('رقم ضروری ہے (Amount is required).'); return; }
    if (tx.type === 'Income') tx.receiptNo = nextReceiptNoLocal();
    accounts.push({ Date: tx.date, Fund: tx.fund, Type: tx.type, Category: tx.category, Item: tx.item, Allocated: tx.allocated, AllocatedAmount: tx.allocatedAmount, SpentAmount: tx.type === 'Expense' ? tx.amount : 0, Amount: tx.amount, Description: tx.description, ReceiptNo: tx.receiptNo, EnteredBy: tx.enteredBy, TeacherID: tx.teacherId });
    MMLocal.saveLocal('accounts', accounts);
    if (tx.receiptNo) { receipts.push({ ReceiptNo: tx.receiptNo, Date: tx.date, Fund: tx.fund, StudentID: '', TeacherID: tx.teacherId, Amount: tx.amount, Purpose: tx.category + ' — ' + tx.description }); MMLocal.saveLocal('receipts', receipts); }
    if (tx.type === 'Expense' && tx.item) {
      var it = items.filter(function (x) { return x.ItemName === tx.item && x.Fund === tx.fund; })[0];
      if (it) { it.SpentAmount = (Number(it.SpentAmount) || 0) + tx.amount; MMLocal.upsertLocal('items', 'ItemID', it); }
    }
    MMLocal.queueChange('recordTransaction', { transaction: tx, role: role() });
    e.target.reset();
    renderAccounts(); renderItems(); renderDashboard(); refreshSyncPill();
    alert('لین دین محفوظ ہو گیا' + (tx.receiptNo ? ' — رسید نمبر: ' + tx.receiptNo : ''));
  };
  window.renderAccounts = function () {
    var fund = $('txFilterFund') ? $('txFilterFund').value : '';
    var rows = accounts.filter(function (a) { return !fund || a.Fund === fund; });
    var bal = { Madrasa: 0, Masjid: 0 };
    accounts.forEach(function (a) { var amt = Number(a.Amount) || 0; if (a.Type === 'Income') bal[a.Fund] = (bal[a.Fund] || 0) + amt; if (a.Type === 'Expense') bal[a.Fund] = (bal[a.Fund] || 0) - amt; });
    $('balMadrasa').textContent = rs(bal.Madrasa || 0);
    $('balMasjid').textContent = rs(bal.Masjid || 0);
    $('accountsTable').innerHTML = rows.length ? rows.slice().reverse().map(function (a) {
      return '<tr><td>' + esc(a.Date) + '</td><td>' + esc(a.Fund) + '</td><td>' + esc(a.Type) + '</td><td>' + esc(a.Category) + '</td><td>' + esc(a.Item || '—') + '</td><td>' + esc(a.Allocated || '—') + '</td><td>' + rs(a.Amount) + '</td><td>' + esc(a.Description) + '</td><td>' + esc(a.ReceiptNo) + '</td></tr>';
    }).join('') : '<tr><td colspan="9" class="empty">کوئی لین دین نہیں۔ (No transactions yet.)</td></tr>';
    var ts = $('txTeacher'); if (ts) ts.innerHTML = '<option value="">—</option>' + teachers.map(function (t) { return '<option value="' + esc(t.TeacherID) + '">' + esc(t.Name) + '</option>'; }).join('');
  };
  window.saveItemUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveItem')) return;
    var it = { ItemID: $('itemId').value || ('ITM-' + Date.now()), ItemName: $('itemName').value.trim(), Fund: $('itemFund').value, AllocatedAmount: Number($('itemAllocated').value) || 0, SpentAmount: Number($('itemSpent').value) || 0, Status: $('itemStatus').value };
    if (!it.ItemName) { alert('آئٹم کا نام ضروری ہے۔'); return; }
    MMLocal.upsertLocal('items', 'ItemID', it);
    MMLocal.queueChange('saveItem', { item: it, role: role() });
    e.target.reset(); $('itemId').value = '';
    renderItems(); refreshSyncPill();
  };
  window.renderItems = function () {
    var el = $('itemsTable'); if (!el) return;
    el.innerHTML = items.length ? items.map(function (it) {
      var remaining = (Number(it.AllocatedAmount) || 0) - (Number(it.SpentAmount) || 0);
      return '<tr><td>' + esc(it.ItemName) + '</td><td>' + esc(it.Fund) + '</td><td>' + rs(it.AllocatedAmount) + '</td><td>' + rs(it.SpentAmount) + '</td><td>' + rs(remaining) + '</td><td>' + esc(it.Status) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">کوئی آئٹم نہیں — اوپر سے شامل کریں۔ (No budget items yet.)</td></tr>';
  };

  /* ---------- receipts ---------- */
  window.renderReceipts = function () {
    $('receiptsTable').innerHTML = receipts.length ? receipts.slice().reverse().map(function (r) {
      return '<tr><td>' + esc(r.ReceiptNo) + '</td><td>' + esc(r.Date) + '</td><td>' + esc(r.Fund) + '</td><td>' + rs(r.Amount) + '</td><td>' + esc(r.Purpose) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">کوئی رسید نہیں۔ (No receipts yet.)</td></tr>';
  };

  /* ---------- history ---------- */
  window.renderHistory = function () {
    var y = $('histYear') ? $('histYear').value : '';
    var loc = $('histLocation') ? $('histLocation').value.toLowerCase() : '';
    var st = students.filter(function (s) {
      return (!y || String(s.AdmissionDate || '').indexOf(y) === 0) && (!loc || String(s.Address || '').toLowerCase().indexOf(loc) !== -1);
    });
    var tc = $('histCounts'); if (!tc) return;
    tc.innerHTML =
      card('کل داخل (Total joined ever)', st.length, '') +
      card('موجودہ (Current)', st.filter(function (s) { return s.Status === 'Current'; }).length, 'green') +
      card('حفظ مکمل (Hifz completed)', st.filter(function (s) { return s.Status === 'HifzCompleted'; }).length, '') +
      card('چھوڑ گئے (Left)', st.filter(function (s) { return s.Status === 'Left'; }).length, 'red') +
      card('اساتذہ کل (Teachers ever)', teachers.length, '') +
      card('اساتذہ چھوڑ گئے (Teachers left)', teachers.filter(function (t) { return t.Status === 'Left'; }).length, 'red');
    $('historyTable').innerHTML = st.length ? st.map(function (s) {
      return '<tr><td>' + esc(s.Name) + '</td><td>' + esc(s.FatherName) + '</td><td dir="ltr">' + esc(s.FatherPhone || '') + '</td><td dir="ltr">' + esc(s.GuardianPhone || '') + '</td><td>' + esc(s.Address || '—') + '</td><td>' + esc(s.Class) + '</td><td>' + esc(s.AdmissionDate) + '</td><td>' + esc(s.Status) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">اس فلٹر میں کوئی ریکارڈ نہیں۔ (No history records for this filter.)</td></tr>';
    var locs = [];
    students.forEach(function (s) { if (s.Address && locs.indexOf(s.Address) === -1) locs.push(s.Address); });
    var dl = $('histLocations'); if (dl) dl.innerHTML = locs.length ? locs.map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') : '';
  };

  /* ---------- users (Admin only, in Settings) ---------- */
  window.renderUsers = function () {
    var el = $('usersTable'); if (!el) return;
    el.innerHTML = users.length ? users.map(function (u) {
      var ver = String(u.EmailVerified) === 'Yes' ? '<span class="badge verified">Verified ✓' + (u.VerifiedDate ? ' ' + esc(u.VerifiedDate) : '') + '</span>' : '<span class="badge not-verified">Not verified</span>';
      return '<tr><td>' + esc(u.Name) + '</td><td>' + esc(u.Username) + '</td><td>' + esc(u.Role) + '</td><td dir="ltr">' + esc(u.Phone || '') + '</td>' +
        '<td dir="ltr">' + esc(u.Email || '—') + '</td><td>' + ver + '</td><td>' + esc(u.Status) + '</td>' +
        '<td><button class="btn small secondary" onclick="toggleUser(\'' + esc(u.UserID) + '\')">' + (u.Status === 'Active' ? 'Disable' : 'Enable') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">کوئی یوزر نہیں۔ (No users yet.)</td></tr>';
    fillAdminEmailUsers();
  };
  window.toggleUser = function (id) {
    if (!requireRole('saveUser')) return;
    var u = users.find(function (x) { return String(x.UserID) === String(id); });
    if (!u) return;
    u.Status = u.Status === 'Active' ? 'Disabled' : 'Active';
    persistUser(u);
  };
  function persistUser(u) {
    MMLocal.upsertLocal('users', 'UserID', u);
    MMLocal.queueChange('saveUser', { user: u, role: role() });
    renderUsers(); refreshSyncPill();
  }
  window.saveUserUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveUser')) return;
    var u = { UserID: 'USR-' + Date.now(), Name: $('newUserName').value.trim(), Username: $('newUserUsername').value.trim(), Password: $('newUserPassword').value, Role: $('newUserRole').value, Phone: $('newUserPhone').value.trim(), Status: 'Active', Email: $('newUserEmail') ? $('newUserEmail').value.trim() : '', EmailVerified: 'No', VerifiedDate: '', ResetCode: '', ResetExpiry: '' };
    if (!u.Name || !u.Username || !u.Password) { alert('نام، یوزر نیم اور پاس ورڈ ضروری ہیں۔'); return; }
    if (users.some(function (x) { return String(x.Username) === u.Username; })) { alert('یہ یوزر نیم پہلے سے موجود ہے۔ (Username already exists.)'); return; }
    users.push(u); MMLocal.saveLocal('users', users);
    MMLocal.queueChange('saveUser', { user: u, role: role() });
    e.target.reset();
    renderUsers(); refreshSyncPill();
    alert('یوزر بن گیا — User created (' + u.Role + ').');
  };

  /* ---------- settings (Admin only — saved via order.js queue) ---------- */
  window.saveSettingsUI = function () {
    if (!requireRole('saveSettings')) return;
    var url = $('setApiUrl').value.trim();
    var key = $('setImgbb').value.trim();
    if (url) MMLocal.setApiUrl(url);
    if (key) MMImage.setKey(key);
    // Branding + admin contact — saved locally FIRST, then queued to the Sheet.
    settings = Object.assign(settings, {
      MadrasaName: $('setMadrasaName').value.trim(),
      MasjidName: $('setMasjidName').value.trim(),
      AdminName: $('setAdminName').value.trim(),
      AdminPhone: $('setAdminPhone').value.trim(),
      AdminWhatsApp: $('setAdminWhatsApp').value.trim(),
      Address: $('setAddress').value.trim(),
      LogoURL: $('setLogoURL').value.trim(),
      ThemeColor: $('setThemeColor').value
    });
    MMLocal.saveLocal('settings', settings);
    MMLocal.queueChange('saveSettings', { settings: settings, role: role() });
    applyBranding();
    $('settingsNote').textContent = 'محفوظ ہو گیا (Saved) — ایڈمن فون: ' + (settings.AdminPhone || '—') + '. ' + (url ? 'API URL set — syncing…' : 'API URL خالی ہے — panel works locally only.');
    refreshSyncPill();
    if (url) refreshFromServer();
  };

  /* ---------- init ---------- */
  function init() {
    if (API_URL) MMLocal.setApiUrl(API_URL); // file placeholder; Settings value wins if already saved
    loadLocal();
    restoreSession();
    $('attDate').value = today(); $('feeDate').value = today(); $('txDate').value = today();
    $('feeMonth').value = thisMonth(); $('stAdmission').value = today(); $('tJoin').value = today();
    if ($('ledgerDate')) $('ledgerDate').value = today();
    if ($('sabaqDate')) $('sabaqDate').value = today();
    $('setApiUrl').value = MMLocal.getApiUrl();
    $('setImgbb').value = MMImage.getKey() || '';
    fillSettingsForm(); applyBranding();
    renderDashboard(); renderStudents(); renderTeachers(); renderFees(); renderAccounts(); renderReceipts(); fillFeeStudents(); fillLedgerStudents(); fillSabaqStudents(); renderNotifLog(); renderHistory(); renderUsers(); renderItems(); fillMyAccount(); refreshSyncPill();
    refreshFromServer();
    if (currentUser) showApp(); else showLogin();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
