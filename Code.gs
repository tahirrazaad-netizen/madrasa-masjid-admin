/**
 * Madrasa + Masjid Admin Panel — Backend (Google Apps Script Web App)
 * =====================================================================
 * SETUP (see SETUP-GUIDE.md for full steps):
 *   1. Create a Google Sheet, paste its ID on the SHEET_ID line below.
 *   2. In Apps Script: Extensions > Apps Script, paste this whole file,
 *      Deploy > New deployment > Web app, Execute as: Me,
 *      Who has access: Anyone (or Anyone with Google account).
 *   3. Copy the Web App URL (/exec) into admin.js (API_URL line).
 *   4. After ANY change to this file, redeploy as a NEW version,
 *      otherwise the old code keeps running.
 *
 * FRONTEND: GitHub Pages static site (index.html + admin.js + order.js).
 * It calls this backend with fetch() POST/GET JSON — no google.script.run
 * here, because GitHub Pages is not hosted inside Apps Script.
 *
 * DATA: one Sheet, one tab per collection. Tabs + columns are created
 * automatically on first run. Demo rows are seeded ONLY ONCE (a script
 * property flag records that seeding happened), so deleting all real
 * rows will NEVER bring the demos back.
 */

// >>> PASTE YOUR GOOGLE SHEET ID HERE (between the quotes) <<<
const SHEET_ID = '1s3w0Z7xSPOXnsY7F0H7CKwTndoXRPmXqCewjr6JZixc'; // Live Sheet "Madrasa Masjid Admin" — created 2026-11-17 via connected Google Sheets

// v3 seed flag (v2 flag mm_seeded_v2 is superseded — v3 seeds the new Users email columns too).
const SEED_FLAG = 'mm_seeded_v3';

// SECURITY NOTE (read this): the Users tab stores a plain PIN/password
// for DEMO login only. This is NOT secure production auth — anyone who
// can read the Sheet can read it. It is a demo / small-trust-circle login
// so the panel is not open to everyone. Real auth (Google sign-in check
// in Apps Script) comes later. Never put a real Google/bank password here.
// Reset/verification codes are 6 digits, valid 15 minutes, stored in the
// Users tab (ResetCode / ResetExpiry) and cleared after use. In live mode
// the code is emailed with MailApp and NEVER returned to the browser.
// Exact tab names and columns — do not rename, the frontend depends on them.
const TABS = {
  Students: ['StudentID','Name','FatherName','Age','Class','Session1','Session2','NightSession','AdmissionDate','MonthlyFee','Status','FatherPhone','GuardianPhone','Address','AdmissionFeeAmount','AdmissionFeePaid','AdmissionFeeDate','AdmissionFeeReceiptNo','ClassHistory','PhotoURL','InCharge'],
  Teachers: ['TeacherID','Name','Phone','Class','JoinDate','LeaveDate','Status','MonthlySalary','PhotoURL'],
  Users: ['UserID','Name','Role','Username','Password','Phone','Status','Email','EmailVerified','VerifiedDate','ResetCode','ResetExpiry','TeacherID','Permissions'],
  Attendance: ['Date','Session','StudentID','Status','MarkedBy'],
  Sabaq: ['Date','StudentID','Sabaq','Amount','TeacherNote','MarkedBy','Recited'],
  Fees: ['ReceiptNo','Date','StudentID','Month','Amount','Status','Method'],
  StudentLedger: ['LedgerID','Date','StudentID','Type','Amount','Method','ReceiptNo','Note'],
  Accounts: ['Date','Fund','Type','Category','Item','Allocated','AllocatedAmount','SpentAmount','Amount','Description','ReceiptNo','EnteredBy','TeacherID','VehicleID'],
  Items: ['ItemID','ItemName','Fund','AllocatedAmount','SpentAmount','Status'],
  Vehicles: ['VehicleID','VehicleNo','Type','Driver','Route','Status'],
  Classes: ['ClassID','ClassName','Level','Description','Status'],
  Receipts: ['ReceiptNo','Date','Fund','StudentID','TeacherID','Amount','Purpose'],
  Settings: ['Key','Value']
};

// Role permissions enforced server-side (frontend also hides sections).
// Admin: everything. Editor: everything EXCEPT Settings + Users.
// Qari: only attendance, sabaq, and read-only views of his own class.
// Any other action from a Qari/Editor is rejected here.
const ROLE_DENY = {
  // Attendance marking is the assistant Qaris' job only. The Head Qari
  // (Admin) monitors and corrects, but never marks. Editor marks nothing.
  Editor: ['saveSettings', 'saveUser', 'saveClass', 'saveAttendance', 'correctAttendance', 'saveVehicle', 'restoreBackup', 'exportBackup'],
  Qari: ['saveStudent', 'saveTeacher', 'recordFee', 'recordTransaction', 'saveSettings', 'saveUser', 'saveItem', 'recordLedger', 'saveClass', 'correctAttendance', 'saveVehicle', 'restoreBackup', 'exportBackup']
};

function roleAllowed(role, action) {
  if (!role || role === 'Admin') return true;
  const denied = ROLE_DENY[role] || [];
  return denied.indexOf(action) === -1;
}

/* ---------- plumbing ---------- */

function getSheet() {
  if (!SHEET_ID || SHEET_ID === 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE') {
    throw new Error('SHEET_ID not set. Paste your Google Sheet ID in Code.gs (SHEET_ID line).');
  }
  return SpreadsheetApp.openById(SHEET_ID);
}

function getTab(name) {
  const ss = getSheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(TABS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureAllTabs() {
  Object.keys(TABS).forEach(function (name) { getTab(name); ensureTabHeaders(name); });
  seedDemoOnce();
  seedClassesOnce();
}

// v3 upgrade: if a tab already exists from v2 (e.g. Users without the new
// Email / ResetCode columns), append the missing columns instead of
// failing. New installs get the full header from getTab() above.
function ensureTabHeaders(name) {
  const sh = getTab(name);
  const lastCol = sh.getLastColumn();
  const headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].filter(function (h) { return h !== ''; }) : [];
  const missing = TABS[name].filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length) sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
}

function readRows(name) {
  const sh = getTab(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
}

function appendRow(name, obj) {
  const sh = getTab(name);
  sh.appendRow(TABS[name].map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function upsertRow(name, idCol, idVal, obj) {
  const sh = getTab(name);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idIdx = headers.indexOf(idCol);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]) === String(idVal)) {
      const row = headers.map(function (h) { return obj[h] === undefined ? values[i][headers.indexOf(h)] : obj[h]; });
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return 'updated';
    }
  }
  appendRow(name, obj);
  return 'created';
}

function upsertSetting(key, value) {
  upsertRow('Settings', 'Key', key, { Key: key, Value: value });
}

function getSettingsObj() {
  const rows = readRows('Settings');
  const o = {};
  rows.forEach(function (r) { o[r.Key] = r.Value; });
  return o;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    ensureAllTabs();
    var params = (e && e.parameter) || {};
    // v4: writes from a static site cannot rely on POST — browsers turn a
    // POST into a GET when following the Apps Script redirect, losing the
    // body. So the frontend sends writes as GET with a JSON `payload`
    // parameter. Parse it here and merge it into the params.
    if (params.payload) {
      try {
        var pl = JSON.parse(params.payload);
        Object.keys(pl).forEach(function (k) { params[k] = pl[k]; });
      } catch (pe) { return jsonOut({ ok: false, error: 'Bad payload JSON: ' + pe }); }
    }
    const action = params.action || 'getDashboard';
    return jsonOut(handleAction(action, params));
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    ensureAllTabs();
    const body = e.postData ? JSON.parse(e.postData.contents) : {};
    return jsonOut(handleAction(body.action || 'getDashboard', body));
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ---------- demo seed (ONCE ONLY — never re-seeds) ---------- */

function seedDemoOnce() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(SEED_FLAG)) return; // already seeded once — never again
  const students = readRows('Students');
  const users = readRows('Users');
  const today = new Date();
  const d = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (students.length === 0) {
    appendRow('Students', { StudentID: 'STU-DEMO-01', Name: 'DEMO طالب علم (Demo Student — delete me)', FatherName: 'DEMO والد', Age: 10, Class: 'ناظرہ', Session1: 'yes', Session2: 'yes', NightSession: 'no', AdmissionDate: d, MonthlyFee: 0, Status: 'Current', FatherPhone: '', GuardianPhone: '', Address: 'DEMO گاؤں (Demo village)', AdmissionFeeAmount: 0, AdmissionFeePaid: 'No', AdmissionFeeDate: '', AdmissionFeeReceiptNo: '', ClassHistory: 'ناظرہ', PhotoURL: '' });
    appendRow('Students', { StudentID: 'STU-DEMO-02', Name: 'DEMO حافظ طالب علم (Demo Hifz Completed — delete me)', FatherName: 'DEMO والد', Age: 14, Class: 'حفظ', Session1: 'yes', Session2: 'no', NightSession: 'yes', AdmissionDate: d, MonthlyFee: 0, Status: 'HifzCompleted', FatherPhone: '', GuardianPhone: '', Address: 'DEMO گاؤں (Demo village)', AdmissionFeeAmount: 0, AdmissionFeePaid: 'Yes', AdmissionFeeDate: d, AdmissionFeeReceiptNo: 'MSD-DEMO-ADM', ClassHistory: 'قاعدہ > ناظرہ > حفظ', PhotoURL: '' });
    appendRow('Teachers', { TeacherID: 'TCH-DEMO-01', Name: 'DEMO قاری صاحب (Demo Teacher — delete me)', Phone: '', Class: 'حفظ', JoinDate: d, LeaveDate: '', Status: 'Active', MonthlySalary: 0, PhotoURL: '' });
    appendRow('Accounts', { Date: d, Fund: 'Madrasa', Type: 'Income', Category: 'DEMO فیس', Item: '', Allocated: '', AllocatedAmount: 0, SpentAmount: 0, Amount: 0, Description: 'Demo row — delete me', ReceiptNo: '', EnteredBy: 'System', TeacherID: '' });
    appendRow('Accounts', { Date: d, Fund: 'Masjid', Type: 'Income', Category: 'DEMO چندہ', Item: '', Allocated: '', AllocatedAmount: 0, SpentAmount: 0, Amount: 0, Description: 'Demo row — delete me', ReceiptNo: '', EnteredBy: 'System', TeacherID: '' });
  }
  if (users.length === 0) {
    // DEMO logins — change the passwords in Settings > Users after first login.
    appendRow('Users', { UserID: 'USR-DEMO-ADMIN', Name: 'DEMO ایڈمن (Demo Admin)', Role: 'Admin', Username: 'admin', Password: 'admin123', Phone: '', Status: 'Active', Email: '', EmailVerified: 'No', VerifiedDate: '', ResetCode: '', ResetExpiry: '' });
    appendRow('Users', { UserID: 'USR-DEMO-EDITOR', Name: 'DEMO ایڈیٹر (Demo Editor)', Role: 'Editor', Username: 'editor', Password: 'editor123', Phone: '', Status: 'Active', Email: '', EmailVerified: 'No', VerifiedDate: '', ResetCode: '', ResetExpiry: '' });
    appendRow('Users', { UserID: 'USR-DEMO-QARI', Name: 'DEMO قاری صاحب (Demo Qari)', Role: 'Qari', Username: 'qari', Password: 'qari123', Phone: '', Status: 'Active', Email: '', EmailVerified: 'No', VerifiedDate: '', ResetCode: '', ResetExpiry: '' });
  }
  // Default (white-label) Settings — Admin edits these in Settings; no Madrasa name is hard-coded in the HTML.
  const settings = getSettingsObj();
  if (!settings.MadrasaName) {
    upsertSetting('MadrasaName', 'مدرسہ (Madrasa Name — change in Settings)');
    upsertSetting('MasjidName', 'مسجد (Masjid Name — change in Settings)');
    upsertSetting('AdminName', 'ایڈمن (Admin Name)');
    upsertSetting('AdminPhone', '');
    upsertSetting('AdminWhatsApp', '');
    upsertSetting('Address', '');
    upsertSetting('LogoURL', '');
    upsertSetting('ThemeColor', '#0e7a5f');
  }
  props.setProperty(SEED_FLAG, 'done');
}

/* ---------- actions (every fetch() call in admin.js / order.js maps to one of these) ---------- */

function handleAction(action, p) {
  const role = p.role || p.Role || 'Admin';
  // Login does not need a role yet; everything else is role-checked.
  if (action === 'login') return login(p.username || p.Username, p.password || p.Password);
  // v3 public flows (no login yet): forgot-password + email verification.
  if (action === 'requestPasswordReset') return requestPasswordReset(p.identifier || p.username || p.Username || p.email || p.Email);
  if (action === 'verifyResetCode') return verifyResetCode(p.identifier || p.username || p.Username || p.email || p.Email, p.code || p.Code);
  if (action === 'resetPassword') return resetPassword(p.identifier || p.username || p.Username || p.email || p.Email, p.code || p.Code, p.newPassword || p.password || p.Password);
  if (action === 'requestEmailVerification') return requestEmailVerification(p.userId || p.UserID);
  if (action === 'verifyEmail') return verifyEmail(p.userId || p.UserID, p.code || p.Code);
  if (!roleAllowed(role, action)) {
    return { ok: false, error: 'Not allowed for role ' + role + ': ' + action };
  }
  switch (action) {
    case 'getDashboard': return getDashboard();
    case 'getStudents': return { ok: true, students: readRows('Students') };
    case 'saveStudent': return saveStudent(p.student || p);
    case 'getTeachers': return { ok: true, teachers: readRows('Teachers') };
    case 'saveTeacher': return saveTeacher(p.teacher || p);
    case 'getUsers': return { ok: true, users: readRows('Users').map(function (u) { const c = {}; Object.keys(u).forEach(function (k) { if (k !== 'Password' && k !== 'ResetCode') c[k] = u[k]; }); return c; }) };
    case 'saveUser': return saveUser(p.user || p);
    case 'saveUserEmail': return saveUserEmail(p);
    case 'getSettings': return { ok: true, settings: getSettingsObj() };
    case 'saveSettings': return saveSettings(p.settings || p);
    case 'saveAttendance': return saveAttendance(p);
    case 'correctAttendance': return correctAttendance(p);
    case 'getAttendance': return { ok: true, attendance: readRows('Attendance') };
    case 'getVehicles': return { ok: true, vehicles: readRows('Vehicles') };
    case 'saveVehicle': return saveVehicle(p.vehicle || p);
    case 'exportBackup': return exportBackup();
    case 'restoreBackup': return restoreBackup(p.backup || p);
    case 'saveSabaq': return saveSabaq(p.sabaq || p);
    case 'getSabaq': return { ok: true, sabaq: readRows('Sabaq') };
    case 'recordFee': return recordFee(p.fee || p);
    case 'getFees': return { ok: true, fees: readRows('Fees') };
    case 'getLedger': return { ok: true, ledger: readRows('StudentLedger').filter(function (r) { return !p.studentId || String(r.StudentID) === String(p.studentId); }) };
    case 'recordLedger': return recordLedger(p.entry || p);
    case 'recordTransaction': return recordTransaction(p.transaction || p);
    case 'getAccounts': return getAccounts();
    case 'getItems': return { ok: true, items: readRows('Items') };
    case 'saveItem': return saveItem(p.item || p);
    case 'getClasses': return { ok: true, classes: readRows('Classes') };
    case 'saveClass': return saveClass(p.classObj || p);
    case 'getHistory': return getHistory(p);
    case 'getReceipts': return { ok: true, receipts: readRows('Receipts') };
    default: return { ok: false, error: 'Unknown action: ' + action };
  }
}

/* ---------- v3: forgot password + add/verify email ---------- */

function gen6DigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function findUserByIdentifier(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return null;
  const users = readRows('Users');
  return users.filter(function (x) {
    return String(x.Username || '').toLowerCase() === id || String(x.Email || '').toLowerCase() === id;
  })[0] || null;
}

function findUserById(userId) {
  const users = readRows('Users');
  return users.filter(function (x) { return String(x.UserID) === String(userId); })[0] || null;
}

function codeStillValid(user, code) {
  if (!user || !user.ResetCode) return false;
  if (String(user.ResetCode) !== String(code).trim()) return false;
  const exp = user.ResetExpiry ? new Date(user.ResetExpiry).getTime() : 0;
  return exp > new Date().getTime();
}

function storeResetCode(user) {
  const code = gen6DigitCode();
  const expiry = new Date(new Date().getTime() + 15 * 60 * 1000); // 15 minutes
  upsertRow('Users', 'UserID', user.UserID, Object.assign({}, user, { ResetCode: code, ResetExpiry: expiry.toISOString() }));
  return { code: code, expiry: expiry };
}

// Try to email the code. Returns true only if MailApp accepted it.
// MailApp.sendEmail needs the script to run as a Google account with
// mail permission; if it throws (no email, no permission, quota), we
// return false and the caller must NOT claim an email was sent.
function sendCodeEmail(to, name, code, purpose) {
  if (!to) return false;
  try {
    const settings = getSettingsObj();
    const brand = settings.MadrasaName || 'Madrasa + Masjid';
    MailApp.sendEmail({
      to: String(to),
      subject: brand + ' — ' + purpose + ' code: ' + code,
      body: 'Assalam-o-Alaikum ' + (name || '') + ',\n\nYour ' + purpose + ' code for ' + brand + ' is: ' + code + '\n\nThis code expires in 15 minutes. Do not share it with anyone.\n\n— ' + brand
    });
    return true;
  } catch (e) { return false; }
}

function requestPasswordReset(identifier) {
  const user = findUserByIdentifier(identifier);
  if (!user) return { ok: false, error: 'No account found with that username or email.' };
  const stored = storeResetCode(user);
  if (!user.Email) {
    // No email saved: the Admin must reset it from Settings > Users.
    return { ok: true, emailed: false, delivery: 'code_pending_admin', message: 'No email is saved on this account. Ask the Admin to reset the password from Settings > Users.' };
  }
  const emailed = sendCodeEmail(user.Email, user.Name, stored.code, 'Password reset');
  if (!emailed) return { ok: true, emailed: false, delivery: 'code_pending_admin', message: 'Email could not be sent (check MailApp permission / email address). Ask the Admin to reset the password from Settings > Users.' };
  return { ok: true, emailed: true, delivery: 'emailed', message: 'A 6-digit reset code was emailed to ' + user.Email + '. It expires in 15 minutes.' };
}

function verifyResetCode(identifier, code) {
  const user = findUserByIdentifier(identifier);
  if (!user) return { ok: false, error: 'No account found.' };
  if (!codeStillValid(user, code)) return { ok: false, error: 'Wrong code, or the code has expired (15 minutes). Request a new code.' };
  return { ok: true };
}

function resetPassword(identifier, code, newPassword) {
  const user = findUserByIdentifier(identifier);
  if (!user) return { ok: false, error: 'No account found.' };
  if (!codeStillValid(user, code)) return { ok: false, error: 'Wrong code, or the code has expired (15 minutes). Request a new code.' };
  if (!newPassword || String(newPassword).length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
  upsertRow('Users', 'UserID', user.UserID, Object.assign({}, user, { Password: String(newPassword), ResetCode: '', ResetExpiry: '' }));
  return { ok: true, message: 'Password changed. Please log in with your new password.' };
}

function saveUserEmail(p) {
  // p: { userId, email, requesterUserId, role }
  const target = findUserById(p.userId || p.UserID);
  if (!target) return { ok: false, error: 'User not found.' };
  const requesterId = p.requesterUserId || p.requesterId || '';
  const role = p.role || p.Role || 'Admin';
  // Admin can change any user's email; Editor/Qari can only change their OWN.
  if (role !== 'Admin' && String(requesterId) !== String(target.UserID)) {
    return { ok: false, error: 'You can only change your own email.' };
  }
  const email = String(p.email || p.Email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
  // Email must be unique across users.
  const clash = readRows('Users').filter(function (x) { return String(x.UserID) !== String(target.UserID) && String(x.Email || '').toLowerCase() === email.toLowerCase(); })[0];
  if (clash) return { ok: false, error: 'That email is already used by another user.' };
  const changed = email.toLowerCase() !== String(target.Email || '').toLowerCase();
  upsertRow('Users', 'UserID', target.UserID, Object.assign({}, target, { Email: email, EmailVerified: changed ? 'No' : (target.EmailVerified || 'No'), VerifiedDate: changed ? '' : (target.VerifiedDate || '') }));
  return { ok: true, email: email, emailVerified: changed ? 'No' : (target.EmailVerified || 'No'), message: changed ? 'Email saved. Please verify it with the 6-digit code.' : 'Email saved.' };
}

function requestEmailVerification(userId) {
  const user = findUserById(userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (!user.Email) return { ok: false, error: 'No email saved on this account yet. Add an email first.' };
  const stored = storeResetCode(user);
  const emailed = sendCodeEmail(user.Email, user.Name, stored.code, 'Email verification');
  if (!emailed) return { ok: true, emailed: false, delivery: 'code_pending_admin', message: 'Email could not be sent (check MailApp permission). Ask the Admin for help.' };
  return { ok: true, emailed: true, delivery: 'emailed', message: 'A 6-digit verification code was emailed to ' + user.Email + '. It expires in 15 minutes.' };
}

function verifyEmail(userId, code) {
  const user = findUserById(userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (!codeStillValid(user, code)) return { ok: false, error: 'Wrong code, or the code has expired (15 minutes). Request a new code.' };
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  upsertRow('Users', 'UserID', user.UserID, Object.assign({}, user, { EmailVerified: 'Yes', VerifiedDate: today, ResetCode: '', ResetExpiry: '' }));
  return { ok: true, message: 'Email verified.' };
}

function login(username, password) {
  const users = readRows('Users');
  const u = users.filter(function (x) { return String(x.Username) === String(username) && String(x.Password) === String(password) && x.Status === 'Active'; })[0];
  if (!u) return { ok: false, error: 'Wrong username or password, or account disabled.' };
  return { ok: true, user: { UserID: u.UserID, Name: u.Name, Role: u.Role, Username: u.Username, Phone: u.Phone, Email: u.Email || '', EmailVerified: u.EmailVerified || 'No', TeacherID: u.TeacherID || '', Permissions: u.Permissions || '' } };
}

function nextReceiptNo() {
  const receipts = readRows('Receipts');
  const y = new Date().getFullYear();
  const n = receipts.filter(function (r) { return String(r.ReceiptNo || '').indexOf('MSD-' + y + '-') === 0; }).length + 1;
  return 'MSD-' + y + '-' + String(n).padStart(4, '0'); // e.g. MSD-2026-0001
}

function getDashboard() {
  const students = readRows('Students');
  const teachers = readRows('Teachers');
  const fees = readRows('Fees');
  const accounts = getAccounts().accounts;
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const bal = { Madrasa: 0, Masjid: 0 };
  accounts.forEach(function (a) {
    const amt = Number(a.Amount) || 0;
    if (a.Type === 'Income') bal[a.Fund] = (bal[a.Fund] || 0) + amt;
    if (a.Type === 'Expense') bal[a.Fund] = (bal[a.Fund] || 0) - amt;
  });
  return {
    ok: true,
    dashboard: {
      currentStudents: students.filter(function (s) { return s.Status === 'Current'; }).length,
      hifzCompleted: students.filter(function (s) { return s.Status === 'HifzCompleted'; }).length,
      leftStudents: students.filter(function (s) { return s.Status === 'Left'; }).length,
      totalJoinedEver: students.length,
      newAdmissionsThisMonth: students.filter(function (s) { return String(s.AdmissionDate || '').indexOf(ym) === 0; }).length,
      admissionFeePendingCount: students.filter(function (s) { return String(s.AdmissionFeePaid) !== 'Yes' && s.Status === 'Current'; }).length,
      admissionFeePendingAmount: students.filter(function (s) { return String(s.AdmissionFeePaid) !== 'Yes' && s.Status === 'Current'; }).reduce(function (sum, s) { return sum + (Number(s.AdmissionFeeAmount) || 0); }, 0),
      teachersActive: teachers.filter(function (t) { return t.Status === 'Active'; }).length,
      teachersTotal: teachers.length,
      teachersLeft: teachers.filter(function (t) { return t.Status === 'Left'; }).length,
      madrasaBalance: bal.Madrasa || 0,
      masjidBalance: bal.Masjid || 0,
      feesCollectedThisMonth: fees.filter(function (f) { return f.Status === 'Paid' && String(f.Date || '').indexOf(ym) === 0; })
        .reduce(function (sum, f) { return sum + (Number(f.Amount) || 0); }, 0),
      feesPendingCount: fees.filter(function (f) { return f.Status === 'Unpaid'; }).length,
      feesPendingAmount: fees.filter(function (f) { return f.Status === 'Unpaid'; })
        .reduce(function (sum, f) { return sum + (Number(f.Amount) || 0); }, 0)
    }
  };
}

function getHistory(p) {
  p = p || {};
  const students = readRows('Students');
  const teachers = readRows('Teachers');
  const filterYear = p.year || '';
  const filterLoc = (p.location || '').toLowerCase();
  const match = function (r) {
    const y = String(r.AdmissionDate || r.JoinDate || '').slice(0, 4);
    const loc = String(r.Address || '').toLowerCase();
    return (!filterYear || y === filterYear) && (!filterLoc || loc.indexOf(filterLoc) !== -1);
  };
  const st = students.filter(match);
  const locations = [];
  students.forEach(function (s) { if (s.Address && locations.indexOf(s.Address) === -1) locations.push(s.Address); });
  return {
    ok: true,
    history: {
      totalJoinedEver: st.length,
      totalLeft: st.filter(function (s) { return s.Status === 'Left'; }).length,
      totalHifzCompleted: st.filter(function (s) { return s.Status === 'HifzCompleted'; }).length,
      totalCurrent: st.filter(function (s) { return s.Status === 'Current'; }).length,
      teachersJoinedEver: teachers.length,
      teachersLeft: teachers.filter(function (t) { return t.Status === 'Left'; }).length,
      locations: locations,
      students: st.map(function (s) { return { StudentID: s.StudentID, Name: s.Name, FatherName: s.FatherName, FatherPhone: s.FatherPhone, GuardianPhone: s.GuardianPhone, Address: s.Address, Class: s.Class, Status: s.Status, AdmissionDate: s.AdmissionDate }; }),
      teachers: teachers.map(function (t) { return { TeacherID: t.TeacherID, Name: t.Name, Phone: t.Phone, Class: t.Class, Status: t.Status, JoinDate: t.JoinDate, LeaveDate: t.LeaveDate }; })
    }
  };
}

function saveStudent(s) {
  if (!s.StudentID) s.StudentID = 'STU-' + new Date().getTime();
  if (!s.Name) return { ok: false, error: 'Student Name is required.' };
  // NEVER delete a student — status change only (Current / HifzCompleted / Left).
  if (!s.Status) s.Status = 'Current';
  // Class history: append the new class when it changes.
  const existing = readRows('Students').filter(function (x) { return String(x.StudentID) === String(s.StudentID); })[0];
  if (existing && existing.Class && s.Class && existing.Class !== s.Class) {
    s.ClassHistory = (existing.ClassHistory ? existing.ClassHistory + ' > ' : '') + s.Class;
    if (!s.ClassHistory) s.ClassHistory = existing.Class + ' > ' + s.Class;
  }
  if (s.AdmissionFeePaid === 'Yes' && !s.AdmissionFeeReceiptNo) s.AdmissionFeeReceiptNo = nextReceiptNo();
  upsertRow('Students', 'StudentID', s.StudentID, s);
  return { ok: true, student: s };
}

function saveTeacher(t) {
  if (!t.TeacherID) t.TeacherID = 'TCH-' + new Date().getTime();
  if (!t.Name) return { ok: false, error: 'Teacher Name is required.' };
  if (!t.Status) t.Status = 'Active';
  upsertRow('Teachers', 'TeacherID', t.TeacherID, t);
  return { ok: true, teacher: t };
}

function saveUser(u) {
  if (!u.UserID) u.UserID = 'USR-' + new Date().getTime();
  if (!u.Username || !u.Role) return { ok: false, error: 'Username and Role are required.' };
  if (['Admin', 'Editor', 'Qari'].indexOf(u.Role) === -1) return { ok: false, error: 'Role must be Admin, Editor or Qari.' };
  if (!u.Status) u.Status = 'Active';
  // Password: only overwrite when a new one is supplied (edit form may leave it blank).
  const existing = readRows('Users').filter(function (x) { return String(x.UserID) === String(u.UserID); })[0];
  if (existing && !u.Password) u.Password = existing.Password;
  if (!u.Password) return { ok: false, error: 'Password is required for a new user.' };
  // v3: keep email / verification / reset-code fields when the caller did not send them.
  if (existing) { ['Email', 'EmailVerified', 'VerifiedDate', 'ResetCode', 'ResetExpiry'].forEach(function (k) { if (u[k] === undefined || u[k] === null) u[k] = existing[k] || ''; }); }
  if (u.EmailVerified === undefined) u.EmailVerified = 'No';
  upsertRow('Users', 'UserID', u.UserID, u);
  return { ok: true, user: { UserID: u.UserID, Name: u.Name, Role: u.Role, Username: u.Username, Phone: u.Phone, Status: u.Status, Email: u.Email || '', EmailVerified: u.EmailVerified || 'No' } };
}

function saveSettings(settings) {
  const allowed = ['MadrasaName', 'MasjidName', 'AdminName', 'AdminPhone', 'AdminWhatsApp', 'Address', 'LogoURL', 'ThemeColor'];
  Object.keys(settings).forEach(function (k) {
    if (allowed.indexOf(k) !== -1) upsertSetting(k, settings[k]);
  });
  return { ok: true, settings: getSettingsObj() };
}

function saveAttendance(p) {
  // p: { date, session ('1st'|'2nd'|'Night'), markedBy, absent:[StudentID], leave:[StudentID] }
  // Everyone in the session is Present by default — ONLY absences/leaves are written.
  // RULES (user's model): the Head Qari (Admin) monitors but NEVER marks
  // attendance — only assistant Qaris mark it. Once a date+session is
  // marked it is FINAL: re-marking is rejected; only the Admin can correct
  // it with correctAttendance().
  if ((p.role || p.Role) === 'Admin') return { ok: false, error: 'Admin (Head Qari) monitors attendance but does not mark it. Attendance is marked by assistant Qaris.' };
  const sh = getTab('Attendance');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const dIdx = headers.indexOf('Date'), sIdx = headers.indexOf('Session'), stuIdx = headers.indexOf('StudentID');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][dIdx]) === String(p.date) && String(values[i][sIdx]) === String(p.session) && String(values[i][stuIdx]) === 'SUMMARY') {
      return { ok: false, error: 'Attendance for ' + p.date + ' (' + p.session + ') is already marked and final. Only the Admin (Head Qari) can correct it.' };
    }
  }
  const absent = p.absent || [];
  const leave = p.leave || [];
  absent.forEach(function (id) {
    appendRow('Attendance', { Date: p.date, Session: p.session, StudentID: id, Status: 'Absent', MarkedBy: p.markedBy || '' });
  });
  leave.forEach(function (id) {
    appendRow('Attendance', { Date: p.date, Session: p.session, StudentID: id, Status: 'Leave', MarkedBy: p.markedBy || '' });
  });
  // Summary row (StudentID = SUMMARY) so the sheet itself shows the day's totals.
  const present = Math.max(0, (Number(p.totalInSession) || 0) - absent.length - leave.length);
  appendRow('Attendance', { Date: p.date, Session: p.session, StudentID: 'SUMMARY', Status: 'Present: ' + present + ' | Absent: ' + absent.length + ' | Leave: ' + leave.length, MarkedBy: p.markedBy || '' });
  return { ok: true, present: present, absent: absent.length, leave: leave.length };
}

// Admin-only correction of a FINALISED attendance record.
// p: { date, session, studentId, status: 'Present'|'Absent'|'Leave', markedBy }
// Present = delete the Absent/Leave row; Absent/Leave = upsert the row.
// The SUMMARY row is recomputed from the Students tab (session membership).
function correctAttendance(p) {
  const sh = getTab('Attendance');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const dIdx = headers.indexOf('Date'), sIdx = headers.indexOf('Session'), stuIdx = headers.indexOf('StudentID'), stIdx = headers.indexOf('Status');
  var targetRow = -1, summaryRow = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][dIdx]) !== String(p.date) || String(values[i][sIdx]) !== String(p.session)) continue;
    if (String(values[i][stuIdx]) === String(p.studentId)) targetRow = i + 1;
    if (String(values[i][stuIdx]) === 'SUMMARY') summaryRow = i + 1;
  }
  if (p.status === 'Present') {
    if (targetRow !== -1) sh.deleteRow(targetRow);
  } else {
    if (targetRow !== -1) {
      sh.getRange(targetRow, stIdx + 1).setValue(p.status);
    } else {
      appendRow('Attendance', { Date: p.date, Session: p.session, StudentID: p.studentId, Status: p.status, MarkedBy: p.markedBy || '' });
    }
  }
  // Recompute the SUMMARY counts.
  var rows = readRows('Attendance').filter(function (a) { return a.Date === p.date && a.Session === p.session && a.StudentID !== 'SUMMARY'; });
  var absent = rows.filter(function (a) { return a.Status === 'Absent'; }).length;
  var leave = rows.filter(function (a) { return a.Status === 'Leave'; }).length;
  var students = readRows('Students').filter(function (s) { return s.Status === 'Current'; });
  var total = students.filter(function (s) {
    return p.session === '1st' ? s.Session1 === 'yes' : p.session === '2nd' ? s.Session2 === 'yes' : s.NightSession === 'yes';
  }).length;
  var present = Math.max(0, total - absent - leave);
  var summary = 'Present: ' + present + ' | Absent: ' + absent + ' | Leave: ' + leave;
  if (summaryRow !== -1) sh.getRange(summaryRow, stIdx + 1).setValue(summary);
  else appendRow('Attendance', { Date: p.date, Session: p.session, StudentID: 'SUMMARY', Status: summary, MarkedBy: p.markedBy || '' });
  return { ok: true, present: present, absent: absent, leave: leave };
}

function saveVehicle(v) {
  if (!v.VehicleID) v.VehicleID = 'VEH-' + new Date().getTime();
  if (!v.VehicleNo) return { ok: false, error: 'Vehicle number is required.' };
  if (!v.Status) v.Status = 'Active';
  upsertRow('Vehicles', 'VehicleID', v.VehicleID, v);
  return { ok: true, vehicle: v };
}

// Full backup: every tab's rows as JSON (Admin only — see ROLE_DENY).
function exportBackup() {
  var backup = { exportedAt: new Date().toISOString(), tabs: {} };
  Object.keys(TABS).forEach(function (name) { backup.tabs[name] = readRows(name); });
  return { ok: true, backup: backup };
}
function restoreBackup(backup) {
  if (!backup || !backup.tabs) return { ok: false, error: 'No backup data.' };
  Object.keys(backup.tabs).forEach(function (name) {
    if (!TABS[name]) return;
    var sh = getTab(name);
    var rows = backup.tabs[name] || [];
    var lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, TABS[name].length).clearContent();
    if (rows.length) {
      var values = rows.map(function (r) { return TABS[name].map(function (h) { return r[h] === undefined ? '' : r[h]; }); });
      sh.getRange(2, 1, values.length, TABS[name].length).setValues(values);
    }
  });
  return { ok: true, restored: true };
}

function saveSabaq(s) {
  if (!s.StudentID) return { ok: false, error: 'Student is required.' };
  if (!s.Sabaq && String(s.Recited || 'Yes') !== 'No') return { ok: false, error: 'Student and Sabaq are required.' };
  // One row per student per day — update it if it already exists.
  var date = s.Date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var sh = getTab('Sabaq');
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var dateIdx = headers.indexOf('Date'), stuIdx = headers.indexOf('StudentID');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][dateIdx]) === String(date) && String(values[i][stuIdx]) === String(s.StudentID)) {
      var row = { Date: date, StudentID: s.StudentID, Sabaq: s.Sabaq || '', Amount: s.Amount || '', TeacherNote: s.TeacherNote || '', MarkedBy: s.MarkedBy || '', Recited: s.Recited || 'Yes' };
      sh.getRange(i + 1, 1, 1, headers.length).setValues([headers.map(function (h) { return row[h] === undefined ? values[i][headers.indexOf(h)] : row[h]; })]);
      return { ok: true, updated: true };
    }
  }
  appendRow('Sabaq', { Date: date, StudentID: s.StudentID, Sabaq: s.Sabaq || '', Amount: s.Amount || '', TeacherNote: s.TeacherNote || '', MarkedBy: s.MarkedBy || '', Recited: s.Recited || 'Yes' });
  return { ok: true };
}

function saveClass(c) {
  // c: { ClassID, ClassName, Level, Description, Status } — Admin only.
  if (!c.ClassID) c.ClassID = 'CLS-' + new Date().getTime();
  if (!c.ClassName) return { ok: false, error: 'Class name is required.' };
  if (!c.Level) c.Level = '—';
  if (!c.Status) c.Status = 'Active';
  upsertRow('Classes', 'ClassID', c.ClassID, c);
  return { ok: true, classObj: c };
}

// Default classes, seeded whenever the Classes tab is empty (independent of
// the one-time demo flag, so existing installs get them too).
function seedClassesOnce() {
  var rows = readRows('Classes');
  if (rows.length) return;
  var defaults = [
    ['Qaida', '—', 'Basic reading (Qaida)'],
    ['Nazra', '—', 'Nazra Quran reading'],
    ['Hifz', '—', 'Hifz (Quran memorisation)'],
    ['Tajweed', '—', 'Tajweed rules'],
    ['Alim-e-Deen', 'Level 1', 'Alim course — year 1'],
    ['Alim-e-Deen', 'Level 2', 'Alim course — year 2'],
    ['Alim-e-Deen', 'Level 3', 'Alim course — year 3'],
    ['Alim-e-Deen', 'Level 4', 'Alim course — year 4'],
    ['Alim-e-Deen', 'Level 5', 'Alim course — year 5'],
    ['Alim-e-Deen', 'Level 6', 'Alim course — year 6'],
    ['Alim-e-Deen', 'Level 7', 'Alim course — year 7'],
    ['Alim-e-Deen', 'Level 8', 'Alim course — year 8'],
    ['Fazil', '—', 'Fazil (advanced) class']
  ];
  defaults.forEach(function (d, i) {
    appendRow('Classes', { ClassID: 'CLS-DEF-' + (i + 1), ClassName: d[0], Level: d[1], Description: d[2], Status: 'Active' });
  });
}

function recordFee(f) {
  // f: { studentId, month 'YYYY-MM', amount, method, date, fund 'Madrasa' }
  // Recording a payment auto-generates a ReceiptNo and a Receipts row.
  if (!f.studentId && !f.StudentID) return { ok: false, error: 'StudentID is required.' };
  const receiptNo = nextReceiptNo();
  const date = f.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const feeRow = { ReceiptNo: receiptNo, Date: date, StudentID: f.studentId || f.StudentID, Month: f.month || f.Month, Amount: Number(f.amount || f.Amount || 0), Status: 'Paid', Method: f.method || f.Method || 'Cash' };
  appendRow('Fees', feeRow);
  appendRow('Receipts', { ReceiptNo: receiptNo, Date: date, Fund: 'Madrasa', StudentID: feeRow.StudentID, TeacherID: '', Amount: feeRow.Amount, Purpose: 'Monthly fee ' + feeRow.Month });
  appendRow('Accounts', { Date: date, Fund: 'Madrasa', Type: 'Income', Category: 'فیس', Item: '', Allocated: '', AllocatedAmount: 0, SpentAmount: 0, Amount: feeRow.Amount, Description: 'Fee ' + feeRow.Month + ' — ' + feeRow.StudentID, ReceiptNo: receiptNo, EnteredBy: f.enteredBy || '', TeacherID: '' });
  // Also mirror into the per-student ledger.
  appendRow('StudentLedger', { LedgerID: 'LED-' + new Date().getTime(), Date: date, StudentID: feeRow.StudentID, Type: 'Fee', Amount: feeRow.Amount, Method: feeRow.Method, ReceiptNo: receiptNo, Note: 'Monthly fee ' + feeRow.Month });
  // Qari notification is a LOG entry only — real push notification comes later. Do not treat as sent.
  return { ok: true, receiptNo: receiptNo, fee: feeRow, qariNotification: 'LOG ONLY — Fee received, notify Qari Sahib (push notification not built yet)' };
}

function recordLedger(e) {
  // e: { studentId, type 'PaymentFromHome'|'Fee'|'Advance'|'Refund', amount, method, date, note }
  if (!e.studentId && !e.StudentID) return { ok: false, error: 'StudentID is required.' };
  if (!e.amount) return { ok: false, error: 'Amount is required.' };
  const receiptNo = nextReceiptNo();
  const date = e.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const row = { LedgerID: 'LED-' + new Date().getTime(), Date: date, StudentID: e.studentId || e.StudentID, Type: e.type || e.Type || 'PaymentFromHome', Amount: Number(e.amount || e.Amount || 0), Method: e.method || e.Method || 'Cash', ReceiptNo: receiptNo, Note: e.note || e.Note || '' };
  appendRow('StudentLedger', row);
  if (row.Type === 'PaymentFromHome') {
    appendRow('Receipts', { ReceiptNo: receiptNo, Date: date, Fund: 'Madrasa', StudentID: row.StudentID, TeacherID: '', Amount: row.Amount, Purpose: 'Payment from home — ' + row.Note });
    appendRow('Accounts', { Date: date, Fund: 'Madrasa', Type: 'Income', Category: 'گھر سے وصولی', Item: '', Allocated: '', AllocatedAmount: 0, SpentAmount: 0, Amount: row.Amount, Description: 'Payment from home — ' + row.StudentID, ReceiptNo: receiptNo, EnteredBy: '', TeacherID: '' });
  }
  return { ok: true, receiptNo: receiptNo, entry: row };
}

function saveItem(item) {
  if (!item.ItemID) item.ItemID = 'ITM-' + new Date().getTime();
  if (!item.ItemName) return { ok: false, error: 'Item name is required.' };
  if (!item.Fund) item.Fund = 'Madrasa';
  if (!item.Status) item.Status = 'Active';
  upsertRow('Items', 'ItemID', item.ItemID, item);
  return { ok: true, item: item };
}

function recordTransaction(t) {
  // t: { date, fund 'Madrasa'|'Masjid', type 'Income'|'Expense', category, item, allocated, allocatedAmount, amount, description, receiptNo, enteredBy, teacherId }
  // Madrasa and Masjid funds are SEPARATE — never mix them.
  if (t.fund !== 'Madrasa' && t.fund !== 'Masjid') return { ok: false, error: 'Fund must be Madrasa or Masjid.' };
  if (!t.amount && t.amount !== 0) return { ok: false, error: 'Amount is required.' };
  let receiptNo = t.receiptNo || t.ReceiptNo || '';
  if (t.type === 'Income' && !receiptNo) receiptNo = nextReceiptNo();
  const row = { Date: t.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), Fund: t.fund, Type: t.type, Category: t.category || '', Item: t.item || '', Allocated: t.allocated || '', AllocatedAmount: Number(t.allocatedAmount || 0), SpentAmount: Number(t.type === 'Expense' ? t.amount : 0), Amount: Number(t.amount), Description: t.description || '', ReceiptNo: receiptNo, EnteredBy: t.enteredBy || '', TeacherID: t.teacherId || t.TeacherID || '', VehicleID: t.vehicleId || t.VehicleID || '' };
  appendRow('Accounts', row);
  // Keep the Items/Budget sheet in sync when an expense names an item.
  if (row.Type === 'Expense' && row.Item) {
    const items = readRows('Items');
    const it = items.filter(function (x) { return x.ItemName === row.Item && x.Fund === row.Fund; })[0];
    if (it) {
      it.SpentAmount = (Number(it.SpentAmount) || 0) + row.Amount;
      upsertRow('Items', 'ItemID', it.ItemID, it);
    }
  }
  if (receiptNo) {
    appendRow('Receipts', { ReceiptNo: receiptNo, Date: row.Date, Fund: row.Fund, StudentID: '', TeacherID: row.TeacherID, Amount: row.Amount, Purpose: row.Category + ' — ' + row.Description });
  }
  return { ok: true, receiptNo: receiptNo, transaction: row };
}

function getAccounts() {
  const accounts = readRows('Accounts');
  const bal = { Madrasa: 0, Masjid: 0 };
  accounts.forEach(function (a) {
    const amt = Number(a.Amount) || 0;
    if (a.Type === 'Income') bal[a.Fund] = (bal[a.Fund] || 0) + amt;
    if (a.Type === 'Expense') bal[a.Fund] = (bal[a.Fund] || 0) - amt;
  });
  return { ok: true, accounts: accounts, balances: bal };
}
