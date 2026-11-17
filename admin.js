/**
 * admin.js — Madrasa + Masjid Admin Panel (frontend logic) — v4
 * ============================================================
 * Offline-first: every save goes to order.js (localStorage) FIRST,
 * then is queued for the Google Sheet backend (Code.gs Web App).
 * v4: writes go through GET with a JSON `payload` param (order.js
 * apiPost) — a plain fetch POST loses its body on the Apps Script
 * redirect, so writes would silently never reach the Sheet.
 * Every fetch() here matches an action in Code.gs handleAction():
 *   getDashboard, getStudents, saveStudent, getTeachers, saveTeacher,
 *   saveAttendance, getAttendance, recordFee, getFees,
 *   recordTransaction, getAccounts, getReceipts, getClasses, saveClass
 * Language: English by default, Urdu toggle at the top (no mixed UI).
 * Passwords: ONLY the main Admin creates / resets passwords (Settings >
 * Users). There is no self-service forgot/change password anywhere.
 * Qari access: a Qari user is linked to one Teacher record (TeacherID);
 * he sees only the students assigned to him (Student.InCharge) or, when
 * no InCharge is set, the students of his Class.
 */
(function () {
  'use strict';

  // >>> PASTE YOUR APPS SCRIPT WEB APP URL HERE (or set it in Settings — Settings wins) <<<
  // Example: https://script.google.com/macros/s/AKfyc.../exec
  var API_URL = 'https://script.google.com/macros/s/AKfycbykWpFT5SZs92uaee0F8uJAWJ_mueCoafcfD_Rw09mkjhNQKATfd_1nPpgF8rM4ADq_Pg/exec'; // Live Web App URL — deployed by user 2026-11-17, tested getDashboard/getSettings OK

  // v2 actions (also in Code.gs handleAction): login, getUsers, saveUser,
  // getSettings, saveSettings, getLedger, recordLedger, getItems, saveItem,
  // getHistory, saveSabaq, getSabaq. Role is sent with every queued change
  // and Code.gs rejects actions the role may not do (see ROLE_DENY there).
  // DEMO LOGIN ONLY: admin/admin123, editor/editor123, qari/qari123.
  // Change these in Settings > Users after first login. This is NOT
  // secure production auth — see SETUP-GUIDE.md.

  var students = [], teachers = [], fees = [], accounts = [], receipts = [], attendance = [];
  var users = [], ledger = [], items = [], sabaq = [], classes = [], vehicles = [];
  var settings = {};
  var currentUser = null; // { UserID, Name, Role, Username, Phone, TeacherID }
  var attMarks = {};
  var attSessionList = [];
  var pendingPhoto = null;
  var profileStudentId = null, profileTeacherId = null;
  var calYear = null, calMonth = null;
  var charts = {}; // Chart.js instances, by canvas id

  /* ---------- language: English default, Urdu toggle (no mixed UI) ---------- */
  var LANG = 'en';
  try { LANG = localStorage.getItem('mm_lang') || 'en'; } catch (e) {}
  var I18N = {
    en: {
      loginHint: 'Log in to continue', username: 'Username', password: 'Password', login: 'Log in',
      forgotNote: 'Forgot your password? Only the main Admin can reset it. Please contact the Admin.',
      demoLoginTitle: 'DEMO LOGIN — for testing only (change in Settings > Users):',
      demoLoginNote: 'This is a demo login, not a secure production login — see SETUP-GUIDE.md.',
      logout: 'Log out', new: 'New', newStudent: 'New Student', newTeacher: 'New Teacher', newFee: 'New Fee Payment',
      newTransaction: 'New Transaction', newItem: 'New Budget Item', newClass: 'New Class', newUser: 'New User',
      searchPh: 'Search students — name, father, class…', allClasses: 'All classes', allStatuses: 'All statuses',
      navDashboard: 'Dashboard', navMyClass: 'My Class', navStudents: 'Students', navTeachers: 'Teachers',
      navAttendance: 'Attendance', navSabaq: 'Sabaq & Daily Report', navFees: 'Fees', navAccounts: 'Accounts',
      navReceipts: 'Receipts', navHistory: 'History', navReports: 'Reports & Graphs', navSettings: 'Settings',
      dashHint: 'Madrasa and Masjid funds are separate — both balances are shown separately below.',
      dashHistoryTitle: 'History — summary', dashAdminTitle: 'Admin contact', dashAttTitle: "Today's attendance — summary",
      dashNotifTitle: 'Fee notification log (LOG ONLY)', dashNotifHint: 'Real push notifications will be added later. This is only a log — do not treat it as "sent".',
      myClassTitle: 'My Class', myClassHint: 'Your class only — your students, today\'s attendance, Sabaq and your class graph.',
      myClassAttChart: 'My class — attendance, last 14 days', myClassToday: "Today's attendance — quick mark",
      myClassStudents: 'My students', session: 'Session', session1: '1st Session', session2: '2nd Session', sessionNight: 'Night Session',
      saveAttendance: 'Save attendance', studentsHint: 'A student is never deleted — only the status changes: Current / Hifz Completed / Left. Click a name to open the profile.',
      addStudent: 'Add student', fName: 'Name *', fFather: "Father's name", fAge: 'Age', fClass: 'Class', fInCharge: 'In-charge (Qari Sahab)',
      fAdmission: 'Admission date', fMonthlyFee: 'Monthly fee (Rs)', fFatherPhone: "Father's phone", fGuardianPhone: 'Guardian phone',
      fAddress: 'Address / Location — village / city', fAdmFee: 'Admission fee (Rs)', fAdmPaid: 'Admission fee collected?',
      fAdmDate: 'Admission fee date', fStatus: 'Status', fS1: '1st session', fS2: '2nd session', fNight: 'Night session',
      fPhoto: 'Student photo (compressed to max 800px, JPEG 0.75)', save: 'Save', clear: 'Clear',
      stSearchPh: 'Search — name / father / class / location',
      thName: 'Name', thFather: 'Father', thClass: 'Class', thSessions: 'Sessions', thFee: 'Fee', thAdmFee: 'Admission fee',
      thStatus: 'Status', thAction: 'Action', thPhone: 'Phone', thJoin: 'Join date', thSalary: 'Salary', thDate: 'Date',
      thMonth: 'Month', thAmount: 'Amount', thReceipt: 'Receipt No.', thItem: 'Item', thAllocated: 'Allocated', thSpent: 'Spent',
      thRemaining: 'Remaining', thPurpose: 'Purpose', thRecited: 'Recited?', thWhat: 'What was recited', thVerified: 'Verified',
      thFatherPhone: "Father's phone", thGuardianPhone: 'Guardian phone', thLocation: 'Location', thAdmission: 'Admission',
      studentProfile: 'Student Profile', backToStudents: '← Back to students', attCalendarTitle: 'Attendance history — calendar',
      present: 'Present', absent: 'Absent', leave: 'Leave', noRecord: 'No record', sabaqHistoryTitle: 'Sabaq history — did the student recite?',
      ledgerTitle: 'Add payment received from home', fStudent: 'Student', fType: 'Type', fAmount: 'Amount (Rs) *',
      fMethod: 'Method', fDate: 'Date', fNote: 'Note', saveLedger: 'Save to ledger & receipt',
      teachersHint: 'A teacher is never deleted — only the status changes: Active / Left. Click a name to open the profile.',
      addTeacher: 'Add teacher', fPhone: 'Phone', fJoin: 'Join date', fSalary: 'Monthly salary (Rs)',
      teacherProfile: 'Qari / Teacher Profile', backToTeachers: '← Back to teachers',
      attHow: 'How it works: first pick a date + session. All students in that session are counted Present by default — the Qari only taps Absent or Leave. The Night session lists only students with Night Session = Yes.',
      attBy: 'Marked by', showList: 'Show list', sabaqHint: 'Record each day whether the student recited the lesson (Sabaq) or not. The daily report below shows who recited and who did not.',
      sabaqTodayTitle: "Today's Sabaq report", sabaqAddTitle: 'Record Sabaq', sabaqWhat: 'What was recited',
      sabaqAmount: 'Amount / pages', sabaqNote: 'Teacher note', saveSabaq: 'Save Sabaq',
      feesHint: 'When a fee is paid, a receipt number is generated automatically (e.g. MSD-2026-0001) and the receipt can be printed.',
      feeAddTitle: 'Record fee payment', fMonth: 'Month', saveFee: 'Save fee & receipt', receiptTitle: 'Receipt — print it',
      print: 'Print', feesListTitle: 'Fees list',
      accountsTitle: 'Accounts — Madrasa and Masjid separate',
      accountsHint: 'Every transaction gets a receipt. Never mix the Madrasa fund with the Masjid fund. Income = money coming in (fees, donations/chanda, payment from home). Expense = money going out (salary, electricity, books, food, construction). Advances to teachers are recorded here too, linked to the teacher.',
      balMadrasa: 'Madrasa balance', balMasjid: 'Masjid balance', itemsTitle: 'Items & Budget — which item was the fund spent on?',
      fItem: 'Item *', fFund: 'Fund', fAllocated: 'Allocated amount (Rs)', fSpent: 'Spent (Rs)', saveItem: 'Save item',
      txAddTitle: 'Add transaction — income / expense / advance', fCategory: 'Category', fAllocatedQ: 'Allocated to this item?',
      fTeacher: 'Teacher — for salary / advance', fDesc: 'Description', saveTx: 'Save transaction', bothFunds: 'Both funds',
      receiptsHint: 'Every transaction / fee receipt is saved here.',
      historyHint: 'No record is ever deleted — only the status changes, so the full history stays here.',
      fYear: 'Year', fLocation: 'Location', reportsHint: 'Live graphs from the Google Sheet data.',
      chAtt: 'Attendance — last 14 days (Present / Absent / Leave)', chClass: 'Students by class',
      chFees: 'Fees collected by month', chFunds: 'Income vs Expense by fund', chAdm: 'New admissions by month',
      settingsTitle: 'Settings — Admin only', brandTitle: 'Madrasa / Masjid details (white-label)',
      brandHint: 'This name, logo and contact are shown everywhere. To sell to another Madrasa, only change these — no name is hard-coded in the code.',
      fMadrasaName: 'Madrasa name *', fMasjidName: 'Masjid name', fAdminName: 'Admin name', fAdminPhone: 'Admin phone *',
      fAdminWhats: 'Admin WhatsApp', fAddress: 'Address', fLogo: 'Logo URL (ImgBB / hosted image link)', fTheme: 'Theme colour',
      classesTitle: 'Classes — define class names & levels',
      classesHint: 'Define each class once, e.g. Qaida, Nazra, Hifz, Alim-e-Deen Level 1–8, Fazil. Each level is a separate class, so Alim-e-Deen Level 1 and Level 2 never mix.',
      fClassName: 'Class name *', fLevel: 'Level', fDesc: 'Description', saveClass: 'Save class',
      navVehicles: 'Vehicles', newVehicle: 'New Vehicle',
      attFinal: 'Attendance for this date and session is already marked and final. Only the Admin (Head Qari) can correct it.',
      attAdminNoMark: 'Admin (Head Qari) monitors attendance but does not mark it. Attendance is marked by assistant Qaris.',
      attTodayTitle: "Today's attendance", attRecordsTitle: 'Attendance records — correct (Admin only)',
      attRecordsHint: 'Pick a date and session. To correct a mistake, change the status in the list — only the Admin can do this.',
      vehiclesTitle: 'Vehicles', vehiclesHint: 'Vehicle expenses are tracked separately from other expenses — pick a vehicle when adding a transaction.',
      vehicleNo: 'Vehicle number *', vehicleType: 'Type', vehicleDriver: 'Driver', vehicleRoute: 'Route',
      vehicleExpenses: 'Vehicle expenses', noVehicles: 'No vehicles yet.', vehicleNoRequired: 'Vehicle number is required.',
      fVehicle: 'Vehicle — for vehicle expenses', printSlip: 'Print slip', printProfile: 'Print profile',
      downloadProfile: 'Save (download)', shareProfile: 'Share', copiedLabel: 'Copied to clipboard.',
      backupTitle: 'Backup — download / restore', backupHint: 'Download the whole dataset (all tabs) as one file, and upload it back any time to restore it. Admin only.',
      downloadBackup: 'Download backup', uploadBackup: 'Upload backup (restore)',
      backupRestoreConfirm: 'Restore this backup? It will REPLACE all current data in the Sheet.', backupRestored: 'Backup restored.',
      changeMyPassword: 'Change my password', newPassword: 'New password', confirmPassword: 'Confirm new password',
      passwordChanged: 'Password changed.', passMin6: 'Password must be at least 6 characters.', passNoMatch: 'The two passwords do not match.',
      permissionsTitle: 'Access permissions (Editor only)', permHint: 'Tick what this Editor may EDIT. Anything unticked is view-only.',
      permStudents: 'Students — can edit', permFees: 'Fees — can edit', permAccounts: 'Accounts — can edit', permAttendance: 'Attendance — can edit',
      fullAccess: 'Full Editor access', thPermissions: 'Permissions', thVehicle: 'Vehicle', thPrint: 'Print',
      connTitle: 'Connection', fApiUrl: 'Apps Script Web App URL (paste after deploying Code.gs)',
      fImgbb: 'ImgBB API Key (for hosting photos — free key at https://api.imgbb.com/)',
      saveSettings: 'Save settings', syncNow: 'Sync now',
      usersTitle: 'Users & Roles — Admin only',
      usersHint: 'Only the main Admin creates users, gives access and sets or resets passwords. Users cannot change their own password. For a Qari, link the teacher record so he sees only his own class.',
      fRole: 'Role', fLinkedTeacher: 'Linked teacher (Qari record)', fEmail: 'Email', createUser: 'Create user',
      genPassword: 'Generate password', adminEmailTitle: "Set a user's email (Admin only)", fUser: 'User', saveEmail: 'Save email',
      localTitle: 'Local data (order.js)', localHint: 'All data is saved on this device first, then synced to the Sheet. The same file will work in the Electron / mobile app later.',
      clearLocal: 'Clear local data', profile: 'Profile', edit: 'Edit', statusBtn: 'Status', resetPass: 'Reset password',
      disable: 'Disable', enable: 'Enable', chartsUnavailable: 'Graphs need an internet connection (Chart.js could not load). The numbers below are still live.',
      yes: 'Yes', no: 'No', notMarked: 'Not marked', didNotRecite: 'Did not recite',
      notAllowed: 'Not allowed for this role:', wrongLogin: 'Wrong username or password.',
      adminPhoneLabel: 'Admin phone: ', editStudent: 'Edit student', nameRequired: 'Name is required.',
      saved: 'Saved.', savedLocal: 'Saved locally and queued for sync.',
      studentAmountRequired: 'Student and amount are required.', ledgerSaved: 'Saved to ledger — receipt no.: ',
      photoBefore: 'Before: ', photoAfter: ' → After: ', showListFirst: 'Show the list first.',
      feeRequired: 'Student, month and amount are required.', amountRequired: 'Amount is required.',
      txSaved: 'Transaction saved', itemNameRequired: 'Item name is required.',
      settingsSaved: 'Saved — Admin phone: ', attDefaultNote: 'all Present by default — tap only Absent / Leave',
      fatherLabel: 'Father', ageLabel: 'Age', admissionLabel: 'Admission', monthlyFeeLabel: 'Monthly fee',
      addressLabel: 'Address / Location', fatherPhoneLabel: "Father's phone", guardianPhoneLabel: 'Guardian phone',
      classHistoryLabel: 'Class history', admissionFeeLabel: 'Admission fee', receivedLabel: 'Received',
      pendingLabel: 'Pending', ledgerHeading: 'Payments from home — per-student ledger', balanceLabel: 'Balance',
      sabaqRecent: 'Sabaq — recent', salaryLabel: 'Monthly salary', salaryPaidLabel: 'Salary paid',
      advancesLabel: 'Advances taken', studentsInClass: 'Students in his class', attMarkedLabel: 'Attendance marked',
      salaryHistory: 'Salary & advance history', joinLabel: 'Join date', phoneLabel: 'Phone',
      noSalaryRecord: 'No salary record.', purposeLabel: 'Purpose', thankYou: 'Thank you',
      changeStatusQ: 'Change status of ', changeStatusQ2: ' from ', changeStatusQ3: ' to ',
      totalJoinedLabel: 'Total joined', currentLabel: 'Current', teachersEverLabel: 'Teachers ever',
      teachersLeftLabel: 'Teachers left', noRecordLabel: 'No record'
    },
    ur: {
      loginHint: 'لاگ ان کریں', username: 'یوزر نیم', password: 'پاس ورڈ', login: 'لاگ ان',
      forgotNote: 'پاس ورڈ بھول گئے؟ صرف مین ایڈمن پاس ورڈ بدل سکتا ہے۔ ایڈمن سے رابطہ کریں۔',
      demoLoginTitle: 'ڈیمو لاگ ان — صرف جانچ کے لیے (Settings > Users میں بدلیں):',
      demoLoginNote: 'یہ ڈیمو لاگ ان ہے، محفوظ پروڈکشن لاگ ان نہیں — تفصیل SETUP-GUIDE میں دیکھیں۔',
      logout: 'لاگ آؤٹ', new: 'نیا', newStudent: 'نیا طالب علم', newTeacher: 'نیا استاد', newFee: 'نئی فیس',
      newTransaction: 'نیا لین دین', newItem: 'نیا بجٹ آئٹم', newClass: 'نئی جماعت', newUser: 'نیا یوزر',
      searchPh: 'طلبہ تلاش کریں — نام، والد، جماعت…', allClasses: 'تمام جماعتیں', allStatuses: 'تمام اسٹیٹس',
      navDashboard: 'ڈیش بورڈ', navMyClass: 'میری جماعت', navStudents: 'طلبہ', navTeachers: 'اساتذہ',
      navAttendance: 'حاضری', navSabaq: 'سبق اور روزانہ رپورٹ', navFees: 'فیس', navAccounts: 'حسابات',
      navReceipts: 'رسیدیں', navHistory: 'تاریخ', navReports: 'رپورٹس اور گراف', navSettings: 'سیٹنگز',
      dashHint: 'مدرسہ اور مسجد کے فنڈ الگ الگ ہیں — نیچے دونوں کا بیلنس الگ دکھایا گیا ہے۔',
      dashHistoryTitle: 'تاریخ — خلاصہ', dashAdminTitle: 'ایڈمن رابطہ', dashAttTitle: 'آج کی حاضری — خلاصہ',
      dashNotifTitle: 'فیس نوٹیفکیشن لاگ (صرف لاگ)', dashNotifHint: 'اصل push notification بعد میں بنے گی۔ یہاں صرف لاگ لکھا جاتا ہے — اسے "بھیج دیا گیا" نہ سمجھیں۔',
      myClassTitle: 'میری جماعت', myClassHint: 'صرف آپ کی جماعت — آپ کے طلبہ، آج کی حاضری، سبق اور آپ کی جماعت کا گراف۔',
      myClassAttChart: 'میری جماعت — حاضری، پچھلے 14 دن', myClassToday: 'آج کی حاضری — جلدی لگائیں',
      myClassStudents: 'میرے طلبہ', session: 'سیشن', session1: 'پہلا سیشن', session2: 'دوسرا سیشن', sessionNight: 'رات کا سیشن',
      saveAttendance: 'حاضری محفوظ کریں', studentsHint: 'طالب علم کبھی ڈیلیٹ نہیں ہوتا — صرف اسٹیٹس بدلیں: Current / Hifz Completed / Left۔ نام پر کلک کر کے پروفائل دیکھیں۔',
      addStudent: 'نیا طالب علم شامل کریں', fName: 'نام *', fFather: 'والد کا نام', fAge: 'عمر', fClass: 'جماعت', fInCharge: 'انچارج (قاری صاحب)',
      fAdmission: 'داخلہ تاریخ', fMonthlyFee: 'ماہانہ فیس (روپے)', fFatherPhone: 'والد کا فون', fGuardianPhone: 'سرپرست فون',
      fAddress: 'پتہ / مقام — گاؤں / شہر', fAdmFee: 'داخلہ فیس (روپے)', fAdmPaid: 'داخلہ فیس وصول؟',
      fAdmDate: 'داخلہ فیس تاریخ', fStatus: 'اسٹیٹس', fS1: 'پہلا سیشن', fS2: 'دوسرا سیشن', fNight: 'رات کا سیشن',
      fPhoto: 'طالب علم کی تصویر (زیادہ سے زیادہ 800px، JPEG 0.75)', save: 'محفوظ کریں', clear: 'نیا فارم',
      stSearchPh: 'تلاش — نام / والد / جماعت / مقام',
      thName: 'نام', thFather: 'والد', thClass: 'جماعت', thSessions: 'سیشن', thFee: 'فیس', thAdmFee: 'داخلہ فیس',
      thStatus: 'اسٹیٹس', thAction: 'عمل', thPhone: 'فون', thJoin: 'تقرری', thSalary: 'تنخواہ', thDate: 'تاریخ',
      thMonth: 'مہینہ', thAmount: 'رقم', thReceipt: 'رسید نمبر', thItem: 'آئٹم', thAllocated: 'مختص', thSpent: 'خرچ',
      thRemaining: 'باقی', thPurpose: 'مقصد', thRecited: 'سنایا؟', thWhat: 'کیا سنایا', thVerified: 'تصدیق',
      thFatherPhone: 'والد کا فون', thGuardianPhone: 'سرپرست فون', thLocation: 'مقام', thAdmission: 'داخلہ',
      studentProfile: 'طالب علم کی پروفائل', backToStudents: '← واپس طلبہ کی فہرست پر', attCalendarTitle: 'حاضری کی تاریخ — کیلنڈر',
      present: 'حاضر', absent: 'غیر حاضر', leave: 'چھٹی', noRecord: 'کوئی ریکارڈ نہیں', sabaqHistoryTitle: 'سبق کی تاریخ — کیا طالب علم نے سنایا؟',
      ledgerTitle: 'گھر سے وصولی درج کریں', fStudent: 'طالب علم', fType: 'قسم', fAmount: 'رقم (روپے) *',
      fMethod: 'طریقہ', fDate: 'تاریخ', fNote: 'نوٹ', saveLedger: 'کھاتے میں درج کریں + رسید',
      teachersHint: 'استاد کبھی ڈیلیٹ نہیں ہوتا — صرف اسٹیٹس بدلیں: Active / Left۔ نام پر کلک کر کے پروفائل دیکھیں۔',
      addTeacher: 'استاد شامل کریں', fPhone: 'فون', fJoin: 'تاریخِ تقرری', fSalary: 'ماہانہ تنخواہ (روپے)',
      teacherProfile: 'قاری صاحب کی پروفائل', backToTeachers: '← واپس اساتذہ کی فہرست پر',
      attHow: 'طریقہ: پہلے تاریخ + سیشن چنیں۔ اس سیشن کے تمام طلبہ پہلے سے حاضر مانے جائیں گے — قاری صاحب کو صرف غیر حاضر یا چھٹی والوں پر ٹیپ کرنا ہے۔ رات کے سیشن میں صرف وہ طلبہ آئیں گے جن کا Night Session = Yes ہے۔',
      attBy: 'حاضری لینے والا', showList: 'فہرست دکھائیں', sabaqHint: 'ہر دن درج کریں کہ طالب علم نے سبق سنایا یا نہیں۔ نیچے روزانہ رپورٹ میں دیکھیں کہ کس نے سنایا اور کس نے نہیں۔',
      sabaqTodayTitle: 'آج کی سبق رپورٹ', sabaqAddTitle: 'سبق درج کریں', sabaqWhat: 'آج کیا سنایا',
      sabaqAmount: 'مقدار', sabaqNote: 'استاد کی رائے', saveSabaq: 'سبق محفوظ کریں',
      feesHint: 'فیس ادا کرتے ہی رسید نمبر خود بنے گا (مثال: MSD-2026-0001) اور رسید پرنٹ ہو سکے گی۔',
      feeAddTitle: 'فیس وصول کریں', fMonth: 'مہینہ', saveFee: 'فیس + رسید محفوظ کریں', receiptTitle: 'رسید — پرنٹ کریں',
      print: 'پرنٹ', feesListTitle: 'فیس کی فہرست',
      accountsTitle: 'حسابات — مدرسہ اور مسجد الگ الگ',
      accountsHint: 'ہر لین دین کی رسید بنتی ہے۔ مدرسہ فنڈ اور مسجد فنڈ کبھی آپس میں نہ ملائیں۔ آمدنی = آنے والا پیسہ (فیس، چندہ، گھر سے وصولی)۔ خرچ = جانے والا پیسہ (تنخواہ، بجلی، کتابیں، کھانا، تعمیر)۔ اساتذہ کو ایڈوانس بھی یہیں درج ہوتا ہے۔',
      balMadrasa: 'مدرسہ بیلنس', balMasjid: 'مسجد بیلنس', itemsTitle: 'آئٹم / بجٹ — فنڈ کس آئٹم پر لگا؟',
      fItem: 'آئٹم *', fFund: 'فنڈ', fAllocated: 'مختص رقم (روپے)', fSpent: 'خرچ شدہ (روپے)', saveItem: 'آئٹم محفوظ کریں',
      txAddTitle: 'لین دین درج کریں — آمدنی / خرچ / ایڈوانس', fCategory: 'زمرہ', fAllocatedQ: 'فنڈ اس آئٹم پر مختص؟',
      fTeacher: 'استاد — تنخواہ / ایڈوانس کے لیے', fDesc: 'تفصیل', saveTx: 'لین دین محفوظ کریں', bothFunds: 'دونوں فنڈ',
      receiptsHint: 'ہر لین دین / فیس کی رسید یہاں محفوظ ہے۔',
      historyHint: 'کبھی کوئی ریکارڈ ڈیلیٹ نہیں ہوتا — صرف اسٹیٹس بدلتا ہے، اس لیے پوری تاریخ یہاں محفوظ رہتی ہے۔',
      fYear: 'سال', fLocation: 'مقام', reportsHint: 'Google Sheet کے ڈیٹا سے لائیو گراف۔',
      chAtt: 'حاضری — پچھلے 14 دن (حاضر / غیر حاضر / چھٹی)', chClass: 'جماعت کے حساب سے طلبہ',
      chFees: 'مہینے کے حساب سے وصول شدہ فیس', chFunds: 'فنڈ کے حساب سے آمدنی اور خرچ', chAdm: 'مہینے کے حساب سے نئے داخلے',
      settingsTitle: 'سیٹنگز — صرف ایڈمن', brandTitle: 'مدرسہ / مسجد کی معلومات',
      brandHint: 'یہی نام، لوگو اور رابطہ ہر جگہ دکھائی دیتا ہے۔ دوسرے مدرسے کو بیچتے وقت صرف یہی بدلنا ہے — کوڈ میں نام لکھا نہیں ہے۔',
      fMadrasaName: 'مدرسے کا نام *', fMasjidName: 'مسجد کا نام', fAdminName: 'ایڈمن کا نام', fAdminPhone: 'ایڈمن فون *',
      fAdminWhats: 'ایڈمن واٹس ایپ', fAddress: 'پتہ', fLogo: 'لوگو URL', fTheme: 'رنگ',
      classesTitle: 'جماعتیں — نام اور درجے طے کریں',
      classesHint: 'ہر جماعت ایک بار طے کریں، مثلاً قاعدہ، ناظرہ، حفظ، عالم دین لیول 1 تا 8، فاضل۔ ہر لیول الگ جماعت ہے، اس لیے عالم دین لیول 1 اور لیول 2 کبھی نہیں ملیں گے۔',
      fClassName: 'جماعت کا نام *', fLevel: 'لیول', fDesc: 'تفصیل', saveClass: 'جماعت محفوظ کریں',

      navVehicles: 'گاڑیاں', newVehicle: 'نئی گاڑی',
      attFinal: 'اس تاریخ اور سیشن کی حاضری لگ چکی ہے اور فائنل ہے۔ صرف ایڈمن (ہیڈ قاری صاحب) درست کر سکتے ہیں۔',
      attAdminNoMark: 'ایڈمن (ہیڈ قاری صاحب) حاضری دیکھتے ہیں، لگاتے نہیں۔ حاضری اسسٹنٹ قاری صاحب لگاتے ہیں۔',
      attTodayTitle: 'آج کی حاضری', attRecordsTitle: 'حاضری کا ریکارڈ — درستی (صرف ایڈمن)',
      attRecordsHint: 'تاریخ اور سیشن چنیں۔ غلطی درست کرنے کے لیے فہرست میں حیثیت بدلیں — یہ صرف ایڈمن کر سکتا ہے۔',
      vehiclesTitle: 'گاڑیاں', vehiclesHint: 'گاڑیوں کے اخراجات دوسرے اخراجات سے الگ رکھے جاتے ہیں — لین دین شامل کرتے وقت گاڑی چنیں۔',
      vehicleNo: 'گاڑی نمبر *', vehicleType: 'قسم', vehicleDriver: 'ڈرائیور', vehicleRoute: 'راستہ',
      vehicleExpenses: 'گاڑی کے اخراجات', noVehicles: 'ابھی کوئی گاڑی نہیں۔', vehicleNoRequired: 'گاڑی نمبر ضروری ہے۔',
      fVehicle: 'گاڑی — گاڑی کے خرچ کے لیے', printSlip: 'پرچی پرنٹ کریں', printProfile: 'پروفائل پرنٹ کریں',
      downloadProfile: 'محفوظ کریں (ڈاؤن لوڈ)', shareProfile: 'شیئر کریں', copiedLabel: 'کاپی ہو گیا۔',
      backupTitle: 'بیک اپ — ڈاؤن لوڈ / واپس لائیں', backupHint: 'پورا ڈیٹا ایک فائل میں ڈاؤن لوڈ کریں، اور جب چاہیں واپس اپ لوڈ کر کے بحال کریں۔ صرف ایڈمن۔',
      downloadBackup: 'بیک اپ ڈاؤن لوڈ کریں', uploadBackup: 'بیک اپ اپ لوڈ کریں (بحال کریں)',
      backupRestoreConfirm: 'کیا یہ بیک اپ بحال کریں؟ اس سے Sheet کا سارا موجودہ ڈیٹا بدل جائے گا۔', backupRestored: 'بیک اپ بحال ہو گیا۔',
      changeMyPassword: 'اپنا پاس ورڈ بدلیں', newPassword: 'نیا پاس ورڈ', confirmPassword: 'نیا پاس ورڈ دوبارہ لکھیں',
      passwordChanged: 'پاس ورڈ بدل گیا۔', passMin6: 'پاس ورڈ کم از کم 6 حروف کا ہو۔', passNoMatch: 'دونوں پاس ورڈ ایک جیسے نہیں۔',
      permissionsTitle: 'رسائی کی اجازتیں (صرف ایڈیٹر کے لیے)', permHint: 'جو کچھ ایڈیٹر بدل سکے، اس پر نشان لگائیں۔ جس پر نشان نہیں، وہ صرف دیکھ سکے گا۔',
      permStudents: 'طلبہ — بدل سکتا ہے', permFees: 'فیس — بدل سکتا ہے', permAccounts: 'اکاؤنٹس — بدل سکتا ہے', permAttendance: 'حاضری — بدل سکتا ہے',
      fullAccess: 'مکمل ایڈیٹر رسائی', thPermissions: 'اجازتیں', thVehicle: 'گاڑی', thPrint: 'پرنٹ',      connTitle: 'کنکشن', fApiUrl: 'Apps Script Web App URL (Code.gs deploy کرنے کے بعد یہاں پیسٹ کریں)',
      fImgbb: 'ImgBB API Key (تصاویر ہوسٹ کرنے کے لیے)',
      saveSettings: 'سیٹنگز محفوظ کریں', syncNow: 'ابھی Sync کریں',
      usersTitle: 'یوزرز / رول — صرف ایڈمن',
      usersHint: 'صرف مین ایڈمن یوزر بناتا ہے، رسائی دیتا ہے اور پاس ورڈ لگاتا یا بدلتا ہے۔ یوزر خود اپنا پاس ورڈ نہیں بدل سکتا۔ قاری کے لیے استاد کا ریکارڈ جوڑیں تاکہ وہ صرف اپنی جماعت دیکھے۔',
      fRole: 'رول', fLinkedTeacher: 'جوڑا ہوا استاد (قاری کا ریکارڈ)', fEmail: 'ای میل', createUser: 'یوزر بنائیں',
      genPassword: 'پاس ورڈ بنائیں', adminEmailTitle: 'کسی یوزر کی ای میل بدلیں — صرف ایڈمن', fUser: 'یوزر', saveEmail: 'ای میل محفوظ کریں',
      localTitle: 'مقامی ڈیٹا (order.js)', localHint: 'تمام ڈیٹا پہلے اس ڈیوائس پر محفوظ ہوتا ہے، پھر Sheet سے sync ہوتا ہے۔ یہی فائل بعد میں Electron / موبائل ایپ میں بھی کام کرے گی۔',
      clearLocal: 'مقامی ڈیٹا صاف کریں', profile: 'پروفائل', edit: 'ترمیم', statusBtn: 'اسٹیٹس', resetPass: 'پاس ورڈ بدلیں',
      disable: 'Disable', enable: 'Enable', chartsUnavailable: 'گراف کے لیے انٹرنیٹ چاہیے (Chart.js لوڈ نہیں ہوا)۔ نیچے نمبر پھر بھی لائیو ہیں۔',
      yes: 'جی ہاں', no: 'نہیں', notMarked: 'درج نہیں', didNotRecite: 'نہیں سنایا',
      notAllowed: 'یہ کام آپ کے رول کے لیے نہیں ہے:', wrongLogin: 'غلط یوزر نیم یا پاس ورڈ۔',
      adminPhoneLabel: 'ایڈمن فون: ', editStudent: 'طالب علم میں ترمیم', nameRequired: 'نام ضروری ہے۔',
      saved: 'محفوظ ہو گیا۔', savedLocal: 'مقامی طور پر محفوظ ہو گیا اور sync کے لیے قطار میں ہے۔',
      studentAmountRequired: 'طالب علم اور رقم ضروری ہیں۔', ledgerSaved: 'کھاتے میں درج ہو گیا — رسید نمبر: ',
      photoBefore: 'اصل سائز: ', photoAfter: ' → کمپریس شدہ: ', showListFirst: 'پہلے فہرست دکھائیں۔',
      feeRequired: 'طالب علم، مہینہ اور رقم ضروری ہیں۔', amountRequired: 'رقم ضروری ہے۔',
      txSaved: 'لین دین محفوظ ہو گیا', itemNameRequired: 'آئٹم کا نام ضروری ہے۔',
      settingsSaved: 'محفوظ ہو گیا — ایڈمن فون: ', attDefaultNote: 'سب پہلے سے حاضر — صرف Absent / Leave پر ٹیپ کریں',
      fatherLabel: 'والد', ageLabel: 'عمر', admissionLabel: 'داخلہ', monthlyFeeLabel: 'ماہانہ فیس',
      addressLabel: 'پتہ / مقام', fatherPhoneLabel: 'والد کا فون', guardianPhoneLabel: 'سرپرست فون',
      classHistoryLabel: 'جماعت کی تاریخ', admissionFeeLabel: 'داخلہ فیس', receivedLabel: 'وصول',
      pendingLabel: 'باقی', ledgerHeading: 'گھر سے وصولی — الگ کھاتہ', balanceLabel: 'بیلنس',
      sabaqRecent: 'سبق — حالیہ', salaryLabel: 'ماہانہ تنخواہ', salaryPaidLabel: 'تنخواہ ادا شدہ',
      advancesLabel: 'ایڈوانس لیا', studentsInClass: 'اس کی جماعت کے طلبہ', attMarkedLabel: 'حاضری لگائی',
      salaryHistory: 'تنخواہ / ایڈوانس کی تاریخ', joinLabel: 'تقرری', phoneLabel: 'فون',
      noSalaryRecord: 'تنخواہ کا کوئی ریکارڈ نہیں۔', purposeLabel: 'مقصد', thankYou: 'شکریہ',
      changeStatusQ: '', changeStatusQ2: ' — اسٹیٹس ', changeStatusQ3: ' سے ',
      totalJoinedLabel: 'کل داخل', currentLabel: 'موجودہ', teachersEverLabel: 'اساتذہ کل',
      teachersLeftLabel: 'اساتذہ چھوڑ گئے', noRecordLabel: 'کوئی ریکارڈ نہیں'
    }
  };
  function t(key) { return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key; }
  function applyLang() {
    document.documentElement.lang = LANG;
    document.documentElement.dir = LANG === 'ur' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    var lt = $('langToggle'); if (lt) lt.textContent = LANG === 'en' ? 'اردو' : 'English';
    try { localStorage.setItem('mm_lang', LANG); } catch (e) {}
  }
  window.toggleLang = function () {
    LANG = LANG === 'en' ? 'ur' : 'en';
    applyLang();
    renderDashboard(); renderStudents(); renderTeachers(); renderFees(); renderAccounts(); renderReceipts(); renderHistory(); renderUsers(); renderItems(); renderClasses(); fillClassSelects();
    if (profileStudentId) renderStudentProfile();
    if (profileTeacherId) renderTeacherProfile();
  };
  // Extra Urdu labels for dashboard cards / small dynamic strings (key = English text).
  I18N.ur['Current students'] = 'موجودہ طلبہ'; I18N.ur['Total joined ever'] = 'کبھی داخل ہوئے';
  I18N.ur['Hifz completed'] = 'حفظ مکمل'; I18N.ur['Left'] = 'چھوڑ گئے';
  I18N.ur['New admissions this month'] = 'اس مہینے نئے داخلے'; I18N.ur['Admission fee pending'] = 'داخلہ فیس باقی';
  I18N.ur['Teachers active'] = 'اساتذہ (فعال)'; I18N.ur['Madrasa balance'] = 'مدرسہ بیلنس';
  I18N.ur['Masjid balance'] = 'مسجد بیلنس'; I18N.ur['Fees collected this month'] = 'اس مہینے فیس وصول';
  I18N.ur['Fees pending'] = 'فیس باقی'; I18N.ur['students'] = 'طلبہ';
  I18N.ur['No attendance recorded today yet.'] = 'آج کی حاضری ابھی درج نہیں ہوئی۔';
  I18N.ur['Set the admin contact number in Settings.'] = 'ایڈمن رابطہ نمبر Settings میں درج کریں۔';
  I18N.ur['No notifications yet.'] = 'ابھی کوئی نوٹیفکیشن نہیں۔';
  I18N.ur['No students found — add one above.'] = 'کوئی طالب علم نہیں ملا۔';
  I18N.ur['Admission received'] = 'داخلہ فیس وصول'; I18N.ur['Admission pending'] = 'داخلہ فیس باقی';
  I18N.ur['No teachers yet.'] = 'کوئی استاد نہیں۔'; I18N.ur['No students in this session.'] = 'اس سیشن میں کوئی طالب علم نہیں۔';
  I18N.ur['No fees recorded yet.'] = 'کوئی فیس درج نہیں۔'; I18N.ur['No transactions yet.'] = 'کوئی لین دین نہیں۔';
  I18N.ur['No receipts yet.'] = 'کوئی رسید نہیں۔'; I18N.ur['No history records for this filter.'] = 'اس فلٹر میں کوئی ریکارڈ نہیں۔';
  I18N.ur['No users yet.'] = 'کوئی یوزر نہیں۔'; I18N.ur['No budget items yet.'] = 'کوئی آئٹم نہیں۔';
  I18N.ur['No ledger entries yet.'] = 'کھاتے میں کوئی لین دین نہیں۔'; I18N.ur['Total joined'] = 'کل داخل';
  I18N.ur['Current'] = 'موجودہ'; I18N.ur['Teachers ever'] = 'اساتذہ کل'; I18N.ur['Teachers left'] = 'اساتذہ چھوڑ گئے';

  function $(id) { return document.getElementById(id); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function thisMonth() { return today().slice(0, 7); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rs(n) { return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK'); }
  function studentName(id) { var s = students.find(function (x) { return String(x.StudentID) === String(id); }); return s ? s.Name : id; }
  function teacherName(id) { var t = teachers.find(function (x) { return String(x.TeacherID) === String(id); }); return t ? t.Name : id; }
  function role() { return currentUser ? currentUser.Role : 'Admin'; }
  // v5 access rules: the Head Qari (Admin) monitors attendance but NEVER
  // marks it — only assistant Qaris mark attendance. Editor has no
  // attendance, settings or user rights, and per-user view/edit permissions
  // (set by the Admin in Settings > Users) decide what an Editor may change.
  function can(action) {
    if (role() === 'Admin') return action !== 'saveAttendance';
    if (role() === 'Editor') {
      if (['saveSettings', 'saveUser', 'saveClass', 'saveAttendance', 'correctAttendance', 'saveVehicle', 'restoreBackup', 'exportBackup'].indexOf(action) !== -1) return false;
      return permAllows(action);
    }
    if (role() === 'Qari') return ['saveAttendance', 'saveSabaq'].indexOf(action) !== -1 || action.indexOf('get') === 0;
    return false;
  }
  function permAllows(action) {
    var perms = currentUser && currentUser.Permissions ? String(currentUser.Permissions).split(',') : [];
    if (!perms.length) return true; // no permissions set = full Editor access
    var area = { saveStudent: 'students', saveTeacher: 'teachers', recordFee: 'fees', recordLedger: 'fees', recordTransaction: 'accounts', saveItem: 'accounts', saveSabaq: 'attendance' }[action];
    if (!area) return true;
    return perms.indexOf(area + ':edit') !== -1;
  }
  function requireRole(action) {
    if (!can(action)) { alert(t('notAllowed') + ' ' + role() + '.'); return false; }
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
    var u = $('loginUser').value.trim(), p = $('loginPass').value;
    var found = users.filter(function (x) { return String(x.Username) === u && String(x.Password) === p && x.Status === 'Active'; })[0];
    if (found) { loginSuccess(found); return; }
    // Try the server when an API URL is set (local demo users are the fallback).
    if (MMLocal.getApiUrl()) {
      MMLocal.apiPost('login', { username: u, password: p }).then(function (d) {
        if (d && d.ok && d.user) loginSuccess(d.user);
        else { $('loginError').textContent = t('wrongLogin'); }
      }).catch(function () { $('loginError').textContent = t('wrongLogin'); });
    } else {
      $('loginError').textContent = t('wrongLogin');
    }
  };
  function loginSuccess(u) {
    currentUser = { UserID: u.UserID, Name: u.Name, Role: u.Role, Username: u.Username, Phone: u.Phone || '', Email: u.Email || '', EmailVerified: u.EmailVerified || 'No', TeacherID: u.TeacherID || '', Permissions: u.Permissions || '' };
    try { sessionStorage.setItem('mm_v2_session', JSON.stringify(currentUser)); } catch (e) {}
    $('loginError').textContent = '';
    showApp();
    renderDashboard(); renderStudents(); renderTeachers(); renderFees(); renderAccounts(); renderReceipts(); renderHistory(); renderUsers(); renderItems(); renderClasses(); fillClassSelects();
    // Qari lands on his own streamlined screen, not the full dashboard.
    if (currentUser.Role === 'Qari') showSection('my-class');
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
  // Qari: only My Class, Students (own only), Attendance, Sabaq.
  // Editor: everything except Settings. Admin: everything.
  function myTeacher() {
    if (!currentUser) return null;
    if (currentUser.TeacherID) {
      var byId = teachers.filter(function (x) { return String(x.TeacherID) === String(currentUser.TeacherID); })[0];
      if (byId) return byId;
    }
    return teachers.filter(function (x) { return x.Name === currentUser.Name; })[0] || null;
  }
  function applyRole() {
    var r = role();
    var hideFor = { Qari: ['dashboard', 'teachers', 'fees', 'accounts', 'receipts', 'settings', 'history', 'reports', 'vehicles'], Editor: ['settings'] };
    var hide = hideFor[r] || [];
    document.querySelectorAll('#sidebar button').forEach(function (b) {
      var show = hide.indexOf(b.dataset.section) === -1;
      b.style.display = show ? '' : 'none';
      if (!show && b.classList.contains('active')) { b.classList.remove('active'); showSection(r === 'Qari' ? 'my-class' : 'dashboard'); }
    });
    var setBtn = $('sidebarSettingsBtn'); if (setBtn) setBtn.style.display = (r === 'Admin') ? '' : 'none';
    var usersPanel = $('usersPanel'); if (usersPanel) usersPanel.style.display = (r === 'Admin') ? '' : 'none';
    var adminContactNote = $('adminContactNote');
    if (adminContactNote) adminContactNote.textContent = r === 'Admin' ? '' : t('settingsTitle') + ' — Admin only.';
    ['setMadrasaName', 'setMasjidName', 'setAdminName', 'setAdminPhone', 'setAdminWhatsApp', 'setAddress', 'setLogoURL', 'setThemeColor'].forEach(function (id) {
      var el = $(id); if (el) el.disabled = (r !== 'Admin');
    });
    var saveBtn = $('saveSettingsBtn'); if (saveBtn) saveBtn.style.display = (r === 'Admin') ? '' : 'none';
    // Qari can view his children, mark attendance and record Sabaq — he
    // cannot add anything else, so the add forms and the + New menu are hidden.
    var isQari = r === 'Qari';
    ['studentFormPanel', 'teacherFormPanel'].forEach(function (id) { var el = $(id); if (el) el.style.display = isQari ? 'none' : ''; });
    var nmBtn = $('newMenuBtn'); if (nmBtn) nmBtn.style.display = isQari ? 'none' : '';
  }

  /* ---------- navigation ---------- */
  window.showSection = function (name) {
    if (name === 'settings' && role() !== 'Admin') { alert(t('settingsTitle')); return; }
    if ((name === 'accounts' || name === 'fees' || name === 'receipts' || name === 'history' || name === 'reports' || name === 'dashboard' || name === 'teachers' || name === 'vehicles') && role() === 'Qari') { showSection('my-class'); return; }
    document.querySelectorAll('.section').forEach(function (el) { el.classList.remove('active'); });
    var sec = $('section-' + name);
    if (sec) sec.classList.add('active');
    document.querySelectorAll('#sidebar button').forEach(function (b) { b.classList.toggle('active', b.dataset.section === name); });
    if (name === 'dashboard') renderDashboard();
    if (name === 'my-class') renderMyClass();
    if (name === 'students') renderStudents();
    if (name === 'fees') { renderFees(); fillFeeStudents(); }
    if (name === 'accounts') { renderAccounts(); renderItems(); }
    if (name === 'receipts') renderReceipts();
    if (name === 'history') renderHistory();
    if (name === 'reports') renderReports();
    if (name === 'sabaq') { renderSabaqReport(); fillSabaqStudents(); }
    if (name === 'settings') { renderUsers(); renderClasses(); }
    if (name === 'attendance') { renderAttendanceList(); renderAttRecords(); }
    if (name === 'vehicles') { renderVehicles(); fillVehicleSelect(); }
  };

  /* ---------- sync status pill ---------- */
  function refreshSyncPill() {
    var st = MMLocal.getSyncStatus();
    var pill = $('syncPill');
    if (!pill) return;
    if (!st.apiConfigured) {
      pill.textContent = st.pending ? 'Saved locally · Pending (' + st.pending + ') — no API URL yet' : 'Saved locally (no API URL yet)';
      pill.classList.add('pending');
    } else if (st.pending) {
      pill.textContent = 'Pending (' + st.pending + ') — tap to sync';
      pill.classList.add('pending');
    } else {
      pill.textContent = 'Synced' + (st.lastSync ? ' · ' + new Date(st.lastSync).toLocaleString() : '');
      pill.classList.remove('pending');
    }
    var info = $('localInfo');
    if (info) info.textContent = 'Students: ' + students.length + ' · Teachers: ' + teachers.length + ' · Fees: ' + fees.length + ' · Accounts: ' + accounts.length + ' · Receipts: ' + receipts.length + ' · Ledger: ' + ledger.length + ' · Users: ' + users.length + '\nPending in outbox: ' + st.pending + ' · Last sync: ' + (st.lastSync || 'never') + ' · Online: ' + (st.online ? 'yes' : 'no');
  }

  window.syncNowUI = function () {
    var pill = $('syncPill');
    if (pill) pill.textContent = 'Syncing…';
    MMLocal.syncNow().then(function (r) {
      if (r.ok) { refreshFromServer(); }
      refreshSyncPill();
      if (!r.ok && r.error) alert('Sync: ' + r.error + ' — data is still saved locally.');
    }).catch(function (e) { refreshSyncPill(); alert('Sync failed: ' + e.message + ' — data is still saved locally.'); });
  };

  /* ---------- settings / branding (white-label: nothing hard-coded) ---------- */
  function defaultSettings() {
    return { MadrasaName: 'مدرسہ (Madrasa Name — change in Settings)', MasjidName: 'مسجد (Masjid Name — change in Settings)', AdminName: 'ایڈمن (Admin Name)', AdminPhone: '', AdminWhatsApp: '', Address: '', LogoURL: '', ThemeColor: '#4f46e5' };
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
    var phone = $('brandAdminPhone'); if (phone) phone.textContent = settings.AdminPhone ? (t('adminPhoneLabel') + settings.AdminPhone) : '';
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
    $('setThemeColor').value = settings.ThemeColor || '#4f46e5';
  }

  /* ---------- load: local first, then server ---------- */
  function loadLocal() {
    MMLocal.seedDemoLocal();
    students = MMLocal.getLocal('students');
    teachers = MMLocal.getLocal('teachers');
    students.forEach(function (s) { s.Class = normaliseClass(s.Class); if (s.InCharge === undefined) s.InCharge = ''; });
    teachers.forEach(function (x) { x.Class = normaliseClass(x.Class); });
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
      if (u.TeacherID === undefined) u.TeacherID = '';
      if (u.Permissions === undefined) u.Permissions = '';
    });
    ledger = MMLocal.getLocal('ledger');
    items = MMLocal.getLocal('items');
    sabaq = MMLocal.getLocal('sabaq');
    classes = MMLocal.getLocal('classes') || [];
    if (!classes.length) classes = defaultClassesLocal();
    vehicles = MMLocal.getLocal('vehicles') || [];
    loadSettingsLocal();
  }
  function defaultClassesLocal() {
    var defs = [['Qaida', '—'], ['Nazra', '—'], ['Hifz', '—'], ['Tajweed', '—'],
      ['Alim-e-Deen', 'Level 1'], ['Alim-e-Deen', 'Level 2'], ['Alim-e-Deen', 'Level 3'], ['Alim-e-Deen', 'Level 4'],
      ['Alim-e-Deen', 'Level 5'], ['Alim-e-Deen', 'Level 6'], ['Alim-e-Deen', 'Level 7'], ['Alim-e-Deen', 'Level 8'],
      ['Fazil', '—']];
    return defs.map(function (d, i) { return { ClassID: 'CLS-DEF-' + (i + 1), ClassName: d[0], Level: d[1], Description: '', Status: 'Active' }; });
  }
  function classLabel(c) { return c.ClassName + (c.Level && c.Level !== '—' ? ' — ' + c.Level : ''); }
  // Canonical class names are English (stored in the Sheet). Urdu mode shows
  // the Urdu name; old Urdu values saved earlier are normalised on load.
  var CLASS_UR = { Qaida: 'قاعدہ', Nazra: 'ناظرہ', Hifz: 'حفظ', Tajweed: 'تجوید', 'Alim-e-Deen': 'عالم دین', Fazil: 'فاضل', Translation: 'ترجمہ', Other: 'دیگر' };
  var CLASS_OLD = { 'قاعدہ': 'Qaida', 'ناظرہ': 'Nazra', 'حفظ': 'Hifz', 'ترجمہ': 'Translation', 'دیگر': 'Other' };
  function normaliseClass(v) { return CLASS_OLD[v] || v || ''; }
  function cls(v) {
    if (!v) return '';
    if (LANG !== 'ur') return v;
    var parts = String(v).split(' — ');
    var name = CLASS_UR[parts[0]] || parts[0];
    if (parts[1]) return name + ' — ' + parts[1].replace('Level', 'لیول');
    return name;
  }
  function classOptions(selected) {
    var list = classes.filter(function (c) { return c.Status === 'Active'; });
    if (!list.length) list = defaultClassesLocal();
    return list.map(function (c) { return '<option value="' + esc(classLabel(c)) + '"' + (selected === classLabel(c) ? ' selected' : '') + '>' + esc(cls(classLabel(c))) + '</option>'; }).join('');
  }
  function fillClassSelects() {
    ['stClass', 'tClass'].forEach(function (id) { var el = $(id); if (el) el.innerHTML = classOptions(el.value || ''); });
    var fc = $('stFilterClass'); if (fc) { var cur = fc.value; fc.innerHTML = '<option value="">' + t('allClasses') + '</option>' + classOptions(''); if (cur) fc.value = cur; }
    var gs = $('globalSearchClass'); if (gs) { var gcur = gs.value; gs.innerHTML = '<option value="">' + t('allClasses') + '</option>' + classOptions(''); if (gcur) gs.value = gcur; }
  }
  function fillInChargeSelect() {
    var el = $('stInCharge'); if (!el) return;
    el.innerHTML = '<option value="">—</option>' + teachers.filter(function (x) { return x.Status === 'Active'; }).map(function (x) { return '<option value="' + esc(x.TeacherID) + '">' + esc(x.Name) + ' — ' + esc(x.Class) + '</option>'; }).join('');
  }

  function refreshFromServer() {
    if (!MMLocal.getApiUrl()) return;
    MMLocal.apiGet('getStudents').then(function (d) { if (d.students) { students = d.students; students.forEach(function (s) { s.Class = normaliseClass(s.Class); if (s.InCharge === undefined) s.InCharge = ''; }); MMLocal.saveLocal('students', students); renderStudents(); renderDashboard(); } }).catch(function () {});
    MMLocal.apiGet('getTeachers').then(function (d) { if (d.teachers) { teachers = d.teachers; teachers.forEach(function (x) { x.Class = normaliseClass(x.Class); }); MMLocal.saveLocal('teachers', teachers); renderTeachers(); fillInChargeSelect(); toggleUserTeacher(); } }).catch(function () {});
    MMLocal.apiGet('getFees').then(function (d) { if (d.fees) { fees = d.fees; MMLocal.saveLocal('fees', fees); renderFees(); } }).catch(function () {});
    MMLocal.apiGet('getAccounts').then(function (d) { if (d.accounts) { accounts = d.accounts; MMLocal.saveLocal('accounts', accounts); renderAccounts(); renderDashboard(); } }).catch(function () {});
    MMLocal.apiGet('getReceipts').then(function (d) { if (d.receipts) { receipts = d.receipts; MMLocal.saveLocal('receipts', receipts); renderReceipts(); } }).catch(function () {});
    MMLocal.apiGet('getDashboard').then(function (d) { if (d.dashboard) renderDashboard(d.dashboard); }).catch(function () {});
    MMLocal.apiGet('getSettings').then(function (d) { if (d.settings) { settings = Object.assign(defaultSettings(), d.settings); MMLocal.saveLocal('settings', settings); applyBranding(); fillSettingsForm(); } }).catch(function () {});
    MMLocal.apiGet('getUsers').then(function (d) { if (d.users) { users = d.users; MMLocal.saveLocal('users', users); renderUsers(); } }).catch(function () {});
    MMLocal.apiGet('getItems').then(function (d) { if (d.items) { items = d.items; MMLocal.saveLocal('items', items); renderItems(); } }).catch(function () {});
    MMLocal.apiGet('getClasses').then(function (d) { if (d.classes && d.classes.length) { classes = d.classes; MMLocal.saveLocal('classes', classes); fillClassSelects(); renderClasses(); } }).catch(function () {});
    MMLocal.apiGet('getSabaq').then(function (d) { if (d.sabaq) { sabaq = d.sabaq; MMLocal.saveLocal('sabaq', sabaq); } }).catch(function () {});
    MMLocal.apiGet('getAttendance').then(function (d) { if (d.attendance) { attendance = d.attendance; MMLocal.saveLocal('attendance', attendance); renderDashboard(); } }).catch(function () {});
    MMLocal.apiGet('getVehicles').then(function (d) { if (d.vehicles) { vehicles = d.vehicles; MMLocal.saveLocal('vehicles', vehicles); renderVehicles(); } }).catch(function () {});
    MMLocal.apiGet('getLedger').then(function (d) { if (d.ledger) { ledger = d.ledger; MMLocal.saveLocal('ledger', ledger); } }).catch(function () {});
  }

  /* ---------- dashboard ---------- */
  function renderDashboard(serverDash) {
    var d = serverDash || computeDashboard();
    var el = $('dashCards');
    if (!el) return;
    el.innerHTML =
      card(t('Current students'), d.currentStudents, 'green') +
      card(t('Total joined ever'), d.totalJoinedEver, '') +
      card(t('Hifz completed'), d.hifzCompleted, '') +
      card(t('Left'), d.leftStudents, 'red') +
      card(t('New admissions this month'), d.newAdmissionsThisMonth, 'green') +
      card(t('Admission fee pending'), d.admissionFeePendingCount + ' ' + t('students') + ' · ' + rs(d.admissionFeePendingAmount), 'amber') +
      card(t('Teachers active'), d.teachersActive + ' / ' + d.teachersTotal, '') +
      '<div class="card madrasa"><div class="label">' + t('Madrasa balance') + '</div><div class="value green">' + rs(d.madrasaBalance) + '</div></div>' +
      '<div class="card masjid"><div class="label">' + t('Masjid balance') + '</div><div class="value green">' + rs(d.masjidBalance) + '</div></div>' +
      card(t('Fees collected this month'), rs(d.feesCollectedThisMonth), 'green') +
      card(t('Fees pending'), d.feesPendingCount + ' ' + t('students') + ' · ' + rs(d.feesPendingAmount), 'amber');
    // Today's attendance — totals from the SUMMARY rows (present / arrived / left).
    var summaries = attendance.filter(function (a) { return a.Date === today() && a.StudentID === 'SUMMARY'; });
    var tot = { present: 0, absent: 0, leave: 0 };
    summaries.forEach(function (s) { var m = String(s.Status).match(/Present:\s*(\d+).*Absent:\s*(\d+).*Leave:\s*(\d+)/); if (m) { tot.present += +m[1]; tot.absent += +m[2]; tot.leave += +m[3]; } });
    $('dashAttendance').textContent = summaries.length
      ? t('attTodayTitle') + ' — ' + t('present') + ': ' + tot.present + ' · ' + t('absent') + ': ' + tot.absent + ' · ' + t('leave') + ': ' + tot.leave + '\n' +
        summaries.map(function (s) { return s.Session + ' — ' + s.Status + ' (' + (s.MarkedBy || '') + ')'; }).join('\n')
      : t('No attendance recorded today yet.');
    var hc = $('dashHistory');
    if (hc) hc.textContent = t('Total joined ever') + ': ' + d.totalJoinedEver + ' · ' + t('Current students') + ': ' + d.currentStudents + ' · ' + t('Hifz completed') + ': ' + d.hifzCompleted + ' · ' + t('Left') + ': ' + d.leftStudents + ' · ' + t('Teachers active') + ': ' + d.teachersActive + ' / ' + d.teachersLeft + ' ' + t('Left') + '.';
    var ac = $('dashAdminContact');
    if (ac) ac.textContent = settings.AdminName && settings.AdminPhone ? (settings.AdminName + ' — ' + settings.AdminPhone) : t('Set the admin contact number in Settings.');
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
    el.textContent = log.length ? log.join('\n') : t('No notifications yet.');
  }

  /* ---------- students ---------- */
  function visibleStudents() {
    // Qari sees only HIS students: those assigned to him (Student.InCharge
    // = his TeacherID) or, when no InCharge is set, the students of his Class.
    if (role() !== 'Qari') return students;
    var me = myTeacher();
    if (!me) return students;
    return students.filter(function (s) {
      if (s.InCharge) return String(s.InCharge) === String(me.TeacherID);
      return s.Class === me.Class;
    });
  }
  window.renderStudents = function () {
    var q = ($('stSearch').value || '').toLowerCase();
    var fs = $('stFilterStatus').value, fc = $('stFilterClass').value;
    var rows = visibleStudents().filter(function (s) {
      return (!fs || s.Status === fs) && (!fc || s.Class === fc) &&
        (!q || (s.Name + ' ' + s.FatherName + ' ' + s.Class + ' ' + (s.Address || '')).toLowerCase().indexOf(q) !== -1);
    });
    // Grouped by class, then by name. Qari sees Profile only — no Edit/Status.
    rows.sort(function (a, b) { return String(a.Class).localeCompare(String(b.Class)) || String(a.Name).localeCompare(String(b.Name)); });
    var isQ = role() === 'Qari';
    var html = '', lastClass = null;
    rows.forEach(function (s) {
      if (s.Class !== lastClass) {
        lastClass = s.Class;
        html += '<tr class="group-row"><td colspan="8">' + esc(cls(s.Class)) + ' — ' + rows.filter(function (x) { return x.Class === s.Class; }).length + ' ' + t('students') + '</td></tr>';
      }
      var sessions = [s.Session1 === 'yes' ? '1st' : '', s.Session2 === 'yes' ? '2nd' : '', s.NightSession === 'yes' ? 'Night' : ''].filter(Boolean).join(', ') || '—';
      var adm = String(s.AdmissionFeePaid) === 'Yes' ? '<span class="badge paid">' + t('Admission received') + ' ✓</span>' : '<span class="badge unpaid">' + t('Admission pending') + ' ' + rs(s.AdmissionFeeAmount) + '</span>';
      html += '<tr><td>' + (s.PhotoURL ? '<img src="' + esc(s.PhotoURL) + '" style="width:36px;height:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-inline-end:6px" alt="">' : '') + esc(s.Name) + '</td>' +
        '<td>' + esc(s.FatherName) + '</td><td>' + esc(s.Class) + '</td><td>' + sessions + '</td><td>' + rs(s.MonthlyFee) + '</td>' +
        '<td>' + adm + '</td>' +
        '<td><span class="badge ' + (s.Status === 'Current' ? 'current' : s.Status === 'HifzCompleted' ? 'hifz' : 'left') + '">' + esc(s.Status) + '</span></td>' +
        '<td><button class="btn small secondary" onclick="showStudentProfile(\'' + esc(s.StudentID) + '\')">' + t('profile') + '</button>' +
        (isQ ? '' : ' <button class="btn small secondary" onclick="editStudent(\'' + esc(s.StudentID) + '\')">' + t('edit') + '</button> ' +
        '<button class="btn small secondary" onclick="changeStudentStatus(\'' + esc(s.StudentID) + '\')">' + t('statusBtn') + '</button>') + '</td></tr>';
    });
    $('studentsTable').innerHTML = rows.length ? html : '<tr><td colspan="8" class="empty">' + t('No students found — add one above.') + '</td></tr>';
  };

  window.editStudent = function (id) {
    if (!requireRole('saveStudent')) return;
    var s = students.find(function (x) { return String(x.StudentID) === String(id); });
    if (!s) return;
    $('stId').value = s.StudentID; $('stName').value = s.Name || ''; $('stFather').value = s.FatherName || '';
    $('stAge').value = s.Age || ''; $('stClass').value = s.Class || ''; $('stAdmission').value = s.AdmissionDate || '';
    $('stFee').value = s.MonthlyFee || 0; $('stPhone').value = s.FatherPhone || ''; $('stStatus').value = s.Status || 'Current';
    $('stS1').value = s.Session1 || 'yes'; $('stS2').value = s.Session2 || 'yes'; $('stNight').value = s.NightSession || 'no';
    $('stPhotoURL').value = s.PhotoURL || '';
    if ($('stInCharge')) $('stInCharge').value = s.InCharge || '';
    if ($('stAddress')) $('stAddress').value = s.Address || '';
    if ($('stGuardian')) $('stGuardian').value = s.GuardianPhone || '';
    if ($('stAdmFee')) $('stAdmFee').value = s.AdmissionFeeAmount || 0;
    if ($('stAdmPaid')) $('stAdmPaid').value = s.AdmissionFeePaid || 'No';
    if ($('stAdmDate')) $('stAdmDate').value = s.AdmissionFeeDate || '';
    $('studentFormTitle').textContent = t('editStudent');
    window.scrollTo(0, 0);
  };

  window.changeStudentStatus = function (id) {
    if (!requireRole('saveStudent')) return;
    var s = students.find(function (x) { return String(x.StudentID) === String(id); });
    if (!s) return;
    var next = s.Status === 'Current' ? 'HifzCompleted' : s.Status === 'HifzCompleted' ? 'Left' : 'Current';
    if (!confirm(t('changeStatusQ') + s.Name + t('changeStatusQ2') + s.Status + t('changeStatusQ3') + next + (LANG === 'ur' ? ' کریں؟' : '?'))) return;
    s.Status = next;
    persistStudent(s);
  };

  window.resetStudentForm = function () {
    $('studentForm').reset(); $('stId').value = ''; $('stPhotoURL').value = '';
    $('photoPreview').style.display = 'none'; $('photoSizeNote').textContent = ''; pendingPhoto = null;
    $('studentFormTitle').textContent = t('addStudent');
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
      InCharge: $('stInCharge') ? $('stInCharge').value : '',
      AdmissionFeeReceiptNo: '',
      ClassHistory: '',
      PhotoURL: pendingPhoto ? pendingPhoto.url : ($('stPhotoURL').value || '')
    };
    if (!s.Name) { alert(t('nameRequired')); return; }
    var old = students.find(function (x) { return String(x.StudentID) === String(s.StudentID); });
    if (old) { s.ClassHistory = old.ClassHistory || old.Class || ''; if (old.Class && old.Class !== s.Class) s.ClassHistory = (s.ClassHistory ? s.ClassHistory + ' > ' : '') + s.Class; s.AdmissionFeeReceiptNo = old.AdmissionFeeReceiptNo || ''; }
    else s.ClassHistory = s.Class;
    if (s.AdmissionFeePaid === 'Yes' && !s.AdmissionFeeReceiptNo) s.AdmissionFeeReceiptNo = 'MSD-ADM-' + Date.now().toString().slice(-6);
    persistStudent(s);
    resetStudentForm();
    alert(t('savedLocal') + (MMLocal.getApiUrl() ? '' : ' (no API URL yet)'));
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
      '<div class="profile-head">' + (s.PhotoURL ? '<img src="' + esc(s.PhotoURL) + '" class="profile-photo" alt="">' : '<div class="profile-photo placeholder">' + esc((s.Name || '?').charAt(0)) + '</div>') +
      '<div><h3>' + esc(s.Name) + '</h3><p>' + t('fatherLabel') + ': ' + esc(s.FatherName) + ' · ' + t('fClass') + ': ' + esc(cls(s.Class)) + ' · ' + t('fStatus') + ': ' + esc(s.Status) + '</p>' +
      '<p>' + t('ageLabel') + ': ' + esc(s.Age) + ' · ' + t('admissionLabel') + ': ' + esc(s.AdmissionDate) + ' · ' + t('monthlyFeeLabel') + ': ' + rs(s.MonthlyFee) + '</p>' +
      '<p>' + t('addressLabel') + ': ' + esc(s.Address || '—') + '</p>' +
      '<p>' + t('fatherPhoneLabel') + ': <span dir="ltr">' + esc(s.FatherPhone || '—') + '</span> · ' + t('guardianPhoneLabel') + ': <span dir="ltr">' + esc(s.GuardianPhone || '—') + '</span></p>' +
      '<p>' + t('classHistoryLabel') + ': ' + esc(s.ClassHistory || s.Class || '—') + '</p>' +
      '<p>' + t('admissionFeeLabel') + ': ' + rs(s.AdmissionFeeAmount) + ' — ' + (String(s.AdmissionFeePaid) === 'Yes' ? t('receivedLabel') + ' ✓ (' + esc(s.AdmissionFeeDate || '') + ' · ' + esc(s.AdmissionFeeReceiptNo || '') + ')' : t('pendingLabel')) + '</p></div></div>' +
      '<h4>' + t('ledgerHeading') + ' · ' + t('balanceLabel') + ': ' + rs(balance) + '</h4>' +
      '<div class="table-wrap"><table><thead><tr><th>' + t('thDate') + '</th><th>' + t('fType') + '</th><th>' + t('thAmount') + '</th><th>' + t('fMethod') + '</th><th>' + t('thReceipt') + '</th><th>' + t('fNote') + '</th></tr></thead><tbody>' +
      (rows.length ? rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(r.Date) + '</td><td>' + esc(r.Type) + '</td><td>' + rs(r.Amount) + '</td><td>' + esc(r.Method) + '</td><td>' + esc(r.ReceiptNo) + '</td><td>' + esc(r.Note) + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">' + t('No ledger entries yet.') + '</td></tr>') +
      '</tbody></table></div>' +
      '<h4>' + t('sabaqRecent') + '</h4><div class="log">' + (sabaqRows.length ? sabaqRows.map(function (r) { return r.Date + ' — ' + r.Sabaq + ' (' + (r.Amount || '') + ') ' + (r.TeacherNote || ''); }).join('\n') : '—') + '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn small" onclick="printStudentProfile()">' + t('printProfile') + '</button>' +
      '<button class="btn small secondary" onclick="downloadStudentProfile()">' + t('downloadProfile') + '</button>' +
      '<button class="btn small secondary" onclick="shareStudentProfile()">' + t('shareProfile') + '</button></div>';
    var sel = $('ledgerStudent'); if (sel) sel.value = s.StudentID;
    renderAttCalendar();
    renderSabaqHistory();
  }
  /* ---------- attendance calendar (student profile) ---------- */
  window.calShift = function (d) {
    if (calYear === null) { var n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); }
    calMonth += d;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderAttCalendar();
  };
  function attStatusFor(s, dateStr) {
    // Direct Absent/Leave row wins; a SUMMARY row for a session the student
    // attends means Present; otherwise no record.
    var rows = attendance.filter(function (a) { return a.Date === dateStr && String(a.StudentID) === String(s.StudentID); });
    for (var i = 0; i < rows.length; i++) { if (rows[i].Status === 'Absent') return 'Absent'; if (rows[i].Status === 'Leave') return 'Leave'; }
    var summary = attendance.filter(function (a) { return a.Date === dateStr && a.StudentID === 'SUMMARY'; });
    for (var j = 0; j < summary.length; j++) {
      var sess = summary[j].Session;
      if ((sess === '1st' && s.Session1 === 'yes') || (sess === '2nd' && s.Session2 === 'yes') || (sess === 'Night' && s.NightSession === 'yes')) return 'Present';
    }
    return '';
  }
  function renderAttCalendar() {
    var el = $('attCalendar'); if (!el || !profileStudentId) return;
    var s = students.find(function (x) { return String(x.StudentID) === String(profileStudentId); });
    if (!s) return;
    if (calYear === null) { var n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); }
    var title = $('calTitle');
    if (title) title.textContent = new Date(calYear, calMonth, 1).toLocaleDateString(LANG === 'ur' ? 'ur-PK' : 'en-GB', { month: 'long', year: 'numeric' });
    var first = new Date(calYear, calMonth, 1);
    var startDow = (first.getDay() + 6) % 7; // Monday first
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var counts = { Present: 0, Absent: 0, Leave: 0 };
    var html = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) { return '<div class="cal-head">' + d + '</div>'; }).join('');
    for (var b = 0; b < startDow; b++) html += '<div class="cal-day empty"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var st = attStatusFor(s, ds);
      if (st) counts[st]++;
      var cls = st === 'Present' ? 'present' : st === 'Absent' ? 'absent' : st === 'Leave' ? 'leave' : 'none';
      html += '<div class="cal-day ' + cls + '" title="' + ds + (st ? ' — ' + st : '') + '">' + day + '</div>';
    }
    el.innerHTML = html;
    var sum = $('attCalSummary');
    if (sum) sum.textContent = title.textContent + ' — ' + t('present') + ': ' + counts.Present + ' · ' + t('absent') + ': ' + counts.Absent + ' · ' + t('leave') + ': ' + counts.Leave;
  }
  function renderSabaqHistory() {
    var el = $('sabaqHistory'); if (!el || !profileStudentId) return;
    var rows = sabaq.filter(function (r) { return String(r.StudentID) === String(profileStudentId); }).slice().reverse();
    el.textContent = rows.length ? rows.map(function (r) {
      var rec = String(r.Recited || 'Yes') === 'Yes' ? t('yes') + ' — ' + t('thRecited') : t('didNotRecite');
      return r.Date + ' — ' + rec + (r.Sabaq ? ' — ' + r.Sabaq : '') + (r.Amount ? ' (' + r.Amount + ')' : '') + (r.TeacherNote ? ' — ' + r.TeacherNote : '');
    }).join('\n') : '—';
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
    if (!entry.StudentID || !entry.Amount) { alert(t('studentAmountRequired')); return; }
    ledger.push(entry); MMLocal.saveLocal('ledger', ledger);
    receipts.push({ ReceiptNo: entry.ReceiptNo, Date: entry.Date, Fund: 'Madrasa', StudentID: entry.StudentID, TeacherID: '', Amount: entry.Amount, Purpose: entry.Type + ' — ' + entry.Note });
    MMLocal.saveLocal('receipts', receipts);
    MMLocal.queueChange('recordLedger', { entry: entry, role: role() });
    renderStudentProfile(); renderReceipts(); renderDashboard(); refreshSyncPill();
    alert(t('ledgerSaved') + entry.ReceiptNo);
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
      $('photoSizeNote').textContent = t('photoBefore') + MMImage.formatSize(c.originalSize) + t('photoAfter') + MMImage.formatSize(c.compressedSize) + ' (' + c.width + '×' + c.height + 'px, JPEG 0.75)';
      var prev = $('photoPreview'); prev.src = c.dataUrl; prev.style.display = 'block';
      pendingPhoto = null;
      return MMImage.uploadImage(file).then(function (u) {
        pendingPhoto = u;
        $('stPhotoURL').value = u.url;
        $('photoSizeNote').textContent += ' Uploaded — URL saved (base64 NOT stored in Sheet).';
      }).catch(function (err) {
        $('photoSizeNote').textContent += err.message + ' — photo preview only; URL not saved yet.';
      });
    }).catch(function (err) { $('photoSizeNote').textContent = err.message; });
  };

  /* ---------- teachers + Qari profile ---------- */
  window.renderTeachers = function () {
    var list = teachers;
    if (role() === 'Qari') { var me = myTeacher(); list = me ? [me] : []; }
    $('teachersTable').innerHTML = list.length ? list.map(function (t) {
      return '<tr><td>' + esc(t.Name) + '</td><td dir="ltr">' + esc(t.Phone) + '</td><td>' + esc(cls(t.Class)) + '</td><td>' + esc(t.JoinDate) + '</td><td>' + rs(t.MonthlySalary) + '</td>' +
        '<td><span class="badge ' + (t.Status === 'Active' ? 'active' : 'left') + '">' + esc(t.Status) + '</span></td>' +
        '<td><button class="btn small secondary" onclick="showTeacherProfile(\'' + esc(t.TeacherID) + '\')">' + t('profile') + '</button> ' +
        '<button class="btn small secondary" onclick="editTeacher(\'' + esc(t.TeacherID) + '\')">' + t('edit') + '</button> ' +
        '<button class="btn small secondary" onclick="changeTeacherStatus(\'' + esc(t.TeacherID) + '\')">' + t('statusBtn') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">' + t('No teachers yet.') + '</td></tr>';
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
    if (!t.Name) { alert(t('nameRequired')); return; }
    persistTeacher(t); resetTeacherForm();
    alert(t('saved'));
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
    var myStudents = students.filter(function (s) { return s.InCharge ? String(s.InCharge) === String(t.TeacherID) : s.Class === t.Class; });
    var salaryRows = receipts.filter(function (r) { return String(r.TeacherID) === String(t.TeacherID); });
    var advanceRows = accounts.filter(function (a) { return String(a.TeacherID) === String(t.TeacherID) && String(a.Category).indexOf('ایڈوانس') !== -1; });
    var salaryPaid = salaryRows.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0);
    var advances = advanceRows.reduce(function (s, r) { return s + (Number(r.Amount) || 0); }, 0);
    var marked = attendance.filter(function (a) { return a.MarkedBy === t.Name; });
    el.innerHTML =
      '<div class="profile-head"><div class="profile-photo placeholder">' + esc((t.Name || '?').charAt(0)) + '</div><div><h3>' + esc(t.Name) + '</h3>' +
      '<p>' + t('phoneLabel') + ': <span dir="ltr">' + esc(t.Phone || '—') + '</span> · ' + t('fClass') + ': ' + esc(cls(t.Class)) + ' · ' + t('joinLabel') + ': ' + esc(t.JoinDate) + ' · ' + t('fStatus') + ': ' + esc(t.Status) + (t.LeaveDate ? ' (' + esc(t.LeaveDate) + ')' : '') + '</p>' +
      '<p>' + t('salaryLabel') + ': ' + rs(t.MonthlySalary) + ' · ' + t('salaryPaidLabel') + ': ' + rs(salaryPaid) + ' · ' + t('advancesLabel') + ': ' + rs(advances) + '</p>' +
      '<p>' + t('studentsInClass') + ': ' + myStudents.filter(function (s) { return s.Status === 'Current'; }).length + ' / ' + myStudents.length + '</p>' +
      '<p>' + t('attMarkedLabel') + ': ' + marked.length + '</p></div></div>' +
      '<h4>' + t('studentsInClass') + '</h4><div class="log">' + (myStudents.length ? myStudents.map(function (s) { return s.Name + ' — ' + s.Class + ' (' + s.Status + ')'; }).join('\n') : '—') + '</div>' +
      '<h4>' + t('salaryHistory') + '</h4><div class="log">' +
      (salaryRows.length ? salaryRows.map(function (r) { return r.Date + ' — ' + r.Purpose + ' — ' + rs(r.Amount) + ' (' + r.ReceiptNo + ')'; }).join('\n') : t('noSalaryRecord')) + '\n' +
      (advanceRows.length ? advanceRows.map(function (a) { return a.Date + ' — Advance — ' + rs(a.Amount) + ' — ' + a.Description; }).join('\n') : '') + '</div>';
  }

  /* ---------- attendance ---------- */
  window.renderAttendanceList = function () {
    var session = $('attSession').value;
    var current = students.filter(function (s) { return s.Status === 'Current'; });
    if (role() === 'Qari') current = visibleStudents().filter(function (s) { return s.Status === 'Current'; });
    if (session === '1st') attSessionList = current.filter(function (s) { return s.Session1 === 'yes'; });
    else if (session === '2nd') attSessionList = current.filter(function (s) { return s.Session2 === 'yes'; });
    else attSessionList = current.filter(function (s) { return s.NightSession === 'yes'; });
    attMarks = {};
    $('attCount').textContent = t('session') + ': ' + session + ' — ' + attSessionList.length + ' ' + t('students') + ' (' + t('attDefaultNote') + ')';
    $('attList').innerHTML = attSessionList.length ? attSessionList.map(function (s) {
      return '<div class="att-row" id="att-' + esc(s.StudentID) + '"><span class="name">' + esc(s.Name) + '</span><span class="cls">' + esc(s.Class) + '</span>' +
        '<button class="toggle" onclick="toggleAtt(\'' + esc(s.StudentID) + '\',\'Absent\',this)">Absent</button>' +
        '<button class="toggle" onclick="toggleAtt(\'' + esc(s.StudentID) + '\',\'Leave\',this)">Leave</button></div>';
    }).join('') : '<div class="empty">' + t('No students in this session.') + '</div>';
  };
  window.toggleAtt = function (id, kind, btn) {
    if (role() === 'Admin') { alert(t('attAdminNoMark')); return; }
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
    if (!attSessionList.length) { alert(t('showListFirst')); return; }
    var date = $('attDate').value || today();
    var session = $('attSession').value;
    // Finalised once marked: a second save is refused — only the Admin
    // (Head Qari) can correct it from the records panel below.
    var already = attendance.filter(function (a) { return a.Date === date && a.Session === session && a.StudentID === 'SUMMARY'; })[0];
    if (already) { alert(t('attFinal')); return; }
    var absent = [], leave = [];
    Object.keys(attMarks).forEach(function (id) { if (attMarks[id] === 'Absent') absent.push(id); else leave.push(id); });
    var present = attSessionList.length - absent.length - leave.length;
    absent.forEach(function (id) { attendance.push({ Date: date, Session: session, StudentID: id, Status: 'Absent', MarkedBy: $('attBy').value || (currentUser ? currentUser.Name : '') }); });
    leave.forEach(function (id) { attendance.push({ Date: date, Session: session, StudentID: id, Status: 'Leave', MarkedBy: $('attBy').value || (currentUser ? currentUser.Name : '') }); });
    attendance.push({ Date: date, Session: session, StudentID: 'SUMMARY', Status: 'Present: ' + present + ' | Absent: ' + absent.length + ' | Leave: ' + leave.length, MarkedBy: $('attBy').value || (currentUser ? currentUser.Name : '') });
    MMLocal.saveLocal('attendance', attendance);
    MMLocal.queueChange('saveAttendance', { date: date, session: session, markedBy: $('attBy').value || (currentUser ? currentUser.Name : ''), absent: absent, leave: leave, totalInSession: attSessionList.length, role: role() });
    $('attSavedNote').textContent = t('saved') + ' — ' + t('present') + ': ' + present + ' · ' + t('absent') + ': ' + absent.length + ' · ' + t('leave') + ': ' + leave.length;
    renderDashboard(); refreshSyncPill();
  };
  /* ---------- attendance records — Admin-only correction ---------- */
  window.renderAttRecords = function () {
    var panel = $('attRecordsPanel'); if (!panel) return;
    var isAdmin = role() === 'Admin';
    panel.style.display = isAdmin ? '' : 'none';
    if (!isAdmin) return;
    var dEl = $('attRecDate'), sEl = $('attRecSession');
    if (dEl && !dEl.value) dEl.value = today();
    if (sEl && !sEl.value) sEl.value = '1st';
    var date = dEl.value, session = sEl.value;
    var list = students.filter(function (s) { return s.Status === 'Current' && (session === '1st' ? s.Session1 === 'yes' : session === '2nd' ? s.Session2 === 'yes' : s.NightSession === 'yes'); });
    $('attRecordsList').innerHTML = list.length ? list.map(function (s) {
      var row = attendance.filter(function (a) { return a.Date === date && a.Session === session && String(a.StudentID) === String(s.StudentID); })[0];
      var st = row ? row.Status : 'Present';
      return '<tr><td>' + esc(s.Name) + '</td><td>' + esc(cls(s.Class)) + '</td><td>' + st + '</td><td><select onchange="correctAttendanceUI(\'' + esc(s.StudentID) + '\', this.value)">' +
        '<option value="Present"' + (st === 'Present' ? ' selected' : '') + '>Present</option>' +
        '<option value="Absent"' + (st === 'Absent' ? ' selected' : '') + '>Absent</option>' +
        '<option value="Leave"' + (st === 'Leave' ? ' selected' : '') + '>Leave</option></select></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">' + t('No students in this session.') + '</td></tr>';
  };
  window.correctAttendanceUI = function (studentId, status) {
    if (!requireRole('correctAttendance')) return;
    var date = ($('attRecDate') && $('attRecDate').value) || today();
    var session = ($('attRecSession') && $('attRecSession').value) || '1st';
    var i = -1;
    attendance.forEach(function (a, idx) { if (a.Date === date && a.Session === session && String(a.StudentID) === String(studentId)) i = idx; });
    if (status === 'Present') { if (i !== -1) attendance.splice(i, 1); }
    else if (i !== -1) attendance[i].Status = status;
    else attendance.push({ Date: date, Session: session, StudentID: studentId, Status: status, MarkedBy: currentUser ? currentUser.Name : '' });
    var rows = attendance.filter(function (a) { return a.Date === date && a.Session === session && a.StudentID !== 'SUMMARY'; });
    var absent = rows.filter(function (a) { return a.Status === 'Absent'; }).length;
    var leave = rows.filter(function (a) { return a.Status === 'Leave'; }).length;
    var total = students.filter(function (s) { return s.Status === 'Current' && (session === '1st' ? s.Session1 === 'yes' : session === '2nd' ? s.Session2 === 'yes' : s.NightSession === 'yes'); }).length;
    var present = Math.max(0, total - absent - leave);
    var sum = attendance.filter(function (a) { return a.Date === date && a.Session === session && a.StudentID === 'SUMMARY'; })[0];
    var summary = 'Present: ' + present + ' | Absent: ' + absent + ' | Leave: ' + leave;
    if (sum) sum.Status = summary;
    else attendance.push({ Date: date, Session: session, StudentID: 'SUMMARY', Status: summary, MarkedBy: currentUser ? currentUser.Name : '' });
    MMLocal.saveLocal('attendance', attendance);
    MMLocal.queueChange('correctAttendance', { date: date, session: session, studentId: studentId, status: status, markedBy: currentUser ? currentUser.Name : '', role: role() });
    renderAttRecords(); renderDashboard(); refreshSyncPill();
  };
  window.saveSabaqUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveSabaq')) return;
    var recited = $('sabaqRecited') ? $('sabaqRecited').value : 'Yes';
    var s = { Date: $('sabaqDate').value || today(), StudentID: $('sabaqStudent').value, Sabaq: $('sabaqText').value.trim() || (recited === 'No' ? '—' : ''), Amount: $('sabaqAmount').value.trim(), TeacherNote: $('sabaqNote').value.trim(), MarkedBy: currentUser ? currentUser.Name : '', Recited: recited };
    if (!s.StudentID || (recited === 'Yes' && !s.Sabaq)) { alert('Student and lesson are required.'); return; }
    // One Sabaq row per student per day — update it if it already exists.
    var ex = sabaq.filter(function (r) { return String(r.StudentID) === String(s.StudentID) && r.Date === s.Date; })[0];
    if (ex) { Object.assign(ex, s); MMLocal.saveLocal('sabaq', sabaq); }
    else { sabaq.push(s); MMLocal.saveLocal('sabaq', sabaq); }
    MMLocal.queueChange('saveSabaq', { sabaq: s, role: role() });
    e.target.reset();
    if ($('sabaqDate')) $('sabaqDate').value = today();
    renderSabaqReport(); refreshSyncPill();
  };
  function fillSabaqStudents() {
    var sel = $('sabaqStudent'); if (!sel) return;
    sel.innerHTML = visibleStudents().filter(function (s) { return s.Status === 'Current'; }).map(function (s) { return '<option value="' + esc(s.StudentID) + '">' + esc(s.Name) + ' — ' + esc(cls(s.Class)) + '</option>'; }).join('');
  }
  /* ---------- Sabaq daily report: who recited today, who did not ---------- */
  window.renderSabaqReport = function () {
    var el = $('sabaqReportTable'); if (!el) return;
    var date = ($('sabaqReportDate') && $('sabaqReportDate').value) || today();
    var list = visibleStudents().filter(function (s) { return s.Status === 'Current'; });
    el.innerHTML = list.length ? list.map(function (s) {
      var row = sabaq.filter(function (r) { return String(r.StudentID) === String(s.StudentID) && r.Date === date; })[0];
      var badge = !row ? '<span class="badge unpaid">' + t('notMarked') + '</span>'
        : String(row.Recited || 'Yes') === 'Yes' ? '<span class="badge paid">' + t('yes') + ' ✓</span>'
        : '<span class="badge unpaid">' + t('didNotRecite') + '</span>';
      return '<tr><td>' + esc(s.Name) + '</td><td>' + esc(cls(s.Class)) + '</td><td>' + badge + '</td><td>' + esc(row ? (row.Sabaq || '—') : '—') + '</td>' +
        '<td><button class="btn small secondary" onclick="markSabaqRecited(\'' + esc(s.StudentID) + '\',\'Yes\')">' + t('yes') + '</button> ' +
        '<button class="btn small secondary" onclick="markSabaqRecited(\'' + esc(s.StudentID) + '\',\'No\')">' + t('no') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">' + t('No students found — add one above.') + '</td></tr>';
  };
  window.markSabaqRecited = function (studentId, recited) {
    if (!requireRole('saveSabaq')) return;
    var date = ($('sabaqReportDate') && $('sabaqReportDate').value) || today();
    var ex = sabaq.filter(function (r) { return String(r.StudentID) === String(studentId) && r.Date === date; })[0];
    var row = ex || { Date: date, StudentID: studentId, Sabaq: '', Amount: '', TeacherNote: '', MarkedBy: currentUser ? currentUser.Name : '' };
    row.Recited = recited;
    if (!ex) sabaq.push(row);
    MMLocal.saveLocal('sabaq', sabaq);
    MMLocal.queueChange('saveSabaq', { sabaq: row, role: role() });
    renderSabaqReport(); refreshSyncPill();
  };

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
    if (!fee.studentId || !fee.month || !fee.amount) { alert(t('feeRequired')); return; }
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
    $('receiptView').innerHTML = '<h3>' + esc(settings.MadrasaName || '') + ' — ' + t('receiptTitle') + '</h3><table>' +
      '<tr><td>' + t('thReceipt') + '</td><td><b>' + esc(rec.ReceiptNo) + '</b></td></tr>' +
      '<tr><td>' + t('thDate') + '</td><td>' + esc(rec.Date) + '</td></tr>' +
      '<tr><td>' + t('fStudent') + '</td><td>' + esc(name) + '</td></tr>' +
      '<tr><td>' + t('purposeLabel') + '</td><td>' + esc(rec.Purpose) + '</td></tr>' +
      '<tr><td>' + t('thAmount') + '</td><td><b>' + rs(rec.Amount) + '</b></td></tr></table>' +
      '<p style="text-align:center;color:#64748b;font-size:13px">' + t('thankYou') + '</p>';
  }
  window.renderFees = function () {
    $('feesTable').innerHTML = fees.length ? fees.slice().reverse().map(function (f) {
      return '<tr><td>' + esc(f.ReceiptNo) + '</td><td>' + esc(f.Date) + '</td><td>' + esc(studentName(f.StudentID)) + '</td><td>' + esc(f.Month) + '</td><td>' + rs(f.Amount) + '</td><td><span class="badge ' + (f.Status === 'Paid' ? 'paid' : 'unpaid') + '">' + esc(f.Status) + '</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">' + t('No fees recorded yet.') + '</td></tr>';
  };

  /* ---------- accounts + expenses by item ---------- */
  window.recordTransactionUI = function (e) {
    e.preventDefault();
    if (!requireRole('recordTransaction')) return;
    var tx = { fund: $('txFund').value, type: $('txType').value, category: $('txCategory').value.trim(), item: $('txItem') ? $('txItem').value.trim() : '', allocated: $('txAllocated') ? $('txAllocated').value : '', allocatedAmount: $('txAllocAmount') ? Number($('txAllocAmount').value) || 0 : 0, amount: Number($('txAmount').value) || 0, description: $('txDesc').value.trim(), date: $('txDate').value || today(), receiptNo: '', enteredBy: currentUser ? currentUser.Name : '', teacherId: $('txTeacher') ? $('txTeacher').value : '', vehicleId: $('txVehicle') ? $('txVehicle').value : '' };
    if (!tx.amount) { alert(t('amountRequired')); return; }
    if (tx.type === 'Income') tx.receiptNo = nextReceiptNoLocal();
    accounts.push({ Date: tx.date, Fund: tx.fund, Type: tx.type, Category: tx.category, Item: tx.item, Allocated: tx.allocated, AllocatedAmount: tx.allocatedAmount, SpentAmount: tx.type === 'Expense' ? tx.amount : 0, Amount: tx.amount, Description: tx.description, ReceiptNo: tx.receiptNo, EnteredBy: tx.enteredBy, TeacherID: tx.teacherId, VehicleID: tx.vehicleId });
    MMLocal.saveLocal('accounts', accounts);
    if (tx.receiptNo) { receipts.push({ ReceiptNo: tx.receiptNo, Date: tx.date, Fund: tx.fund, StudentID: '', TeacherID: tx.teacherId, Amount: tx.amount, Purpose: tx.category + ' — ' + tx.description }); MMLocal.saveLocal('receipts', receipts); }
    if (tx.type === 'Expense' && tx.item) {
      var it = items.filter(function (x) { return x.ItemName === tx.item && x.Fund === tx.fund; })[0];
      if (it) { it.SpentAmount = (Number(it.SpentAmount) || 0) + tx.amount; MMLocal.upsertLocal('items', 'ItemID', it); }
    }
    MMLocal.queueChange('recordTransaction', { transaction: tx, role: role() });
    e.target.reset();
    renderAccounts(); renderItems(); renderDashboard(); refreshSyncPill();
    alert(t('txSaved') + (tx.receiptNo ? ' — ' + tx.receiptNo : ''));
  };
  window.renderAccounts = function () {
    var fund = $('txFilterFund') ? $('txFilterFund').value : '';
    var rows = accounts.filter(function (a) { return !fund || a.Fund === fund; });
    var bal = { Madrasa: 0, Masjid: 0 };
    accounts.forEach(function (a) { var amt = Number(a.Amount) || 0; if (a.Type === 'Income') bal[a.Fund] = (bal[a.Fund] || 0) + amt; if (a.Type === 'Expense') bal[a.Fund] = (bal[a.Fund] || 0) - amt; });
    $('balMadrasa').textContent = rs(bal.Madrasa || 0);
    $('balMasjid').textContent = rs(bal.Masjid || 0);
    $('accountsTable').innerHTML = rows.length ? rows.slice().reverse().map(function (a) {
      return '<tr><td>' + esc(a.Date) + '</td><td>' + esc(a.Fund) + '</td><td>' + esc(a.Type) + '</td><td>' + esc(a.Category) + '</td><td>' + esc(a.Item || '—') + '</td><td>' + esc(a.Allocated || '—') + '</td><td>' + esc(vehicleNo(a.VehicleID)) + '</td><td>' + rs(a.Amount) + '</td><td>' + esc(a.Description) + '</td><td>' + esc(a.ReceiptNo) + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="empty">' + t('No transactions yet.') + '</td></tr>';
    var ts = $('txTeacher'); if (ts) ts.innerHTML = '<option value="">—</option>' + teachers.map(function (t) { return '<option value="' + esc(t.TeacherID) + '">' + esc(t.Name) + '</option>'; }).join('');
    fillVehicleSelect();
  };
  window.saveItemUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveItem')) return;
    var it = { ItemID: $('itemId').value || ('ITM-' + Date.now()), ItemName: $('itemName').value.trim(), Fund: $('itemFund').value, AllocatedAmount: Number($('itemAllocated').value) || 0, SpentAmount: Number($('itemSpent').value) || 0, Status: $('itemStatus').value };
    if (!it.ItemName) { alert(t('itemNameRequired')); return; }
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
    }).join('') : '<tr><td colspan="6" class="empty">' + t('No budget items yet.') + '</td></tr>';
  };

  /* ---------- receipts ---------- */
  window.renderReceipts = function () {
    $('receiptsTable').innerHTML = receipts.length ? receipts.slice().reverse().map(function (r) {
      return '<tr><td>' + esc(r.ReceiptNo) + '</td><td>' + esc(r.Date) + '</td><td>' + esc(r.Fund) + '</td><td>' + rs(r.Amount) + '</td><td>' + esc(r.Purpose) + '</td>' +
        '<td><button class="btn small secondary" onclick="printReceiptSlip(\'' + esc(r.ReceiptNo) + '\')">' + t('printSlip') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">' + t('No receipts yet.') + '</td></tr>';
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
      card(t('totalJoinedLabel'), st.length, '') +
      card(t('currentLabel'), st.filter(function (s) { return s.Status === 'Current'; }).length, 'green') +
      card(t('Hifz completed'), st.filter(function (s) { return s.Status === 'HifzCompleted'; }).length, '') +
      card(t('Left'), st.filter(function (s) { return s.Status === 'Left'; }).length, 'red') +
      card(t('teachersEverLabel'), teachers.length, '') +
      card(t('teachersLeftLabel'), teachers.filter(function (t) { return t.Status === 'Left'; }).length, 'red');
    $('historyTable').innerHTML = st.length ? st.map(function (s) {
      return '<tr><td>' + esc(s.Name) + '</td><td>' + esc(s.FatherName) + '</td><td dir="ltr">' + esc(s.FatherPhone || '') + '</td><td dir="ltr">' + esc(s.GuardianPhone || '') + '</td><td>' + esc(s.Address || '—') + '</td><td>' + esc(s.Class) + '</td><td>' + esc(s.AdmissionDate) + '</td><td>' + esc(s.Status) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">' + t('No history records for this filter.') + '</td></tr>';
    var locs = [];
    students.forEach(function (s) { if (s.Address && locs.indexOf(s.Address) === -1) locs.push(s.Address); });
    var dl = $('histLocations'); if (dl) dl.innerHTML = locs.length ? locs.map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') : '';
  };

  /* ---------- users (Admin only, in Settings) ---------- */
  window.renderUsers = function () {
    var el = $('usersTable'); if (!el) return;
    el.innerHTML = users.length ? users.map(function (u) {
      var ver = String(u.EmailVerified) === 'Yes' ? '<span class="badge verified">Verified ✓' + (u.VerifiedDate ? ' ' + esc(u.VerifiedDate) : '') + '</span>' : '<span class="badge not-verified">Not verified</span>';
      var linked = u.TeacherID ? teacherName(u.TeacherID) : '—';
      return '<tr><td>' + esc(u.Name) + '</td><td>' + esc(u.Username) + '</td><td>' + esc(u.Role) + '</td><td>' + esc(linked) + '</td><td dir="ltr">' + esc(u.Phone || '') + '</td>' +
        '<td dir="ltr">' + esc(u.Email || '—') + '</td><td>' + ver + '</td><td>' + esc(u.Status) + '</td><td>' + esc(permSummary(u)) + '</td>' +
        '<td><button class="btn small secondary" onclick="toggleUser(\'' + esc(u.UserID) + '\')">' + (u.Status === 'Active' ? t('disable') : t('enable')) + '</button> ' +
        '<button class="btn small secondary" onclick="resetUserPassword(\'' + esc(u.UserID) + '\')">' + t('resetPass') + '</button> ' +
        '<button class="btn small secondary" onclick="editUser(\'' + esc(u.UserID) + '\')">' + t('edit') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="10" class="empty">' + t('No users yet.') + '</td></tr>';
    fillAdminEmailUsers();
  };
  function permSummary(u) {
    if (u.Role !== 'Editor') return '—';
    var p = u.Permissions ? String(u.Permissions).split(',') : [];
    if (!p.length) return t('fullAccess');
    return p.map(function (x) { var parts = x.split(':'); return parts[0] + ' (' + parts[1] + ')'; }).join(', ');
  }
  function readPerms() {
    var areas = ['students', 'fees', 'accounts', 'attendance'];
    return areas.filter(function (a) { var el = $('perm' + a.charAt(0).toUpperCase() + a.slice(1) + 'Edit'); return el && el.checked; }).map(function (a) { return a + ':edit'; }).join(',');
  }
  function fillPerms(p) {
    var list = p ? String(p).split(',') : [];
    ['students', 'fees', 'accounts', 'attendance'].forEach(function (a) { var el = $('perm' + a.charAt(0).toUpperCase() + a.slice(1) + 'Edit'); if (el) el.checked = list.indexOf(a + ':edit') !== -1; });
  }
  window.editUser = function (id) {
    if (!requireRole('saveUser')) return;
    var u = users.filter(function (x) { return String(x.UserID) === String(id); })[0]; if (!u) return;
    $('newUserId').value = u.UserID; $('newUserName').value = u.Name || ''; $('newUserUsername').value = u.Username || '';
    $('newUserPassword').value = ''; $('newUserPassword').required = false;
    $('newUserRole').value = u.Role || 'Editor'; $('newUserPhone').value = u.Phone || '';
    if ($('newUserEmail')) $('newUserEmail').value = u.Email || '';
    if ($('newUserTeacher')) $('newUserTeacher').value = u.TeacherID || '';
    fillPerms(u.Permissions || '');
    toggleUserTeacher(); window.scrollTo(0, 0);
  };
  window.toggleUser = function (id) {
    if (!requireRole('saveUser')) return;
    var u = users.find(function (x) { return String(x.UserID) === String(id); });
    if (!u) return;
    u.Status = u.Status === 'Active' ? 'Disabled' : 'Active';
    persistUser(u);
  };
  function persistUser(u) {
    // NOTE: the local users copy has no Password (server strips it), so a
    // password reset must carry the new password in the queued payload.
    var payloadUser = Object.assign({}, u);
    MMLocal.upsertLocal('users', 'UserID', u);
    MMLocal.queueChange('saveUser', { user: payloadUser, role: role() });
    renderUsers(); refreshSyncPill();
  }
  window.saveUserUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveUser')) return;
    var editId = $('newUserId') ? $('newUserId').value : '';
    var u = { UserID: editId || ('USR-' + Date.now()), Name: $('newUserName').value.trim(), Username: $('newUserUsername').value.trim(), Password: $('newUserPassword').value, Role: $('newUserRole').value, Phone: $('newUserPhone').value.trim(), Status: 'Active', Email: $('newUserEmail') ? $('newUserEmail').value.trim() : '', EmailVerified: 'No', VerifiedDate: '', ResetCode: '', ResetExpiry: '', TeacherID: ($('newUserRole').value === 'Qari' && $('newUserTeacher')) ? $('newUserTeacher').value : '', Permissions: readPerms() };
    if (!u.Name || !u.Username || (!editId && !u.Password)) { alert('Name, username and password are required.'); return; }
    if (users.some(function (x) { return String(x.Username) === u.Username && String(x.UserID) !== String(u.UserID); })) { alert('Username already exists.'); return; }
    if (editId) {
      var ex = users.filter(function (x) { return String(x.UserID) === String(editId); })[0];
      if (ex) { if (!u.Password) u.Password = ex.Password; u.Status = ex.Status; u.EmailVerified = ex.EmailVerified || 'No'; u.VerifiedDate = ex.VerifiedDate || ''; Object.assign(ex, u); MMLocal.saveLocal('users', users); persistUser(ex); }
    } else {
      users.push(u); MMLocal.saveLocal('users', users);
      MMLocal.queueChange('saveUser', { user: u, role: role() });
    }
    e.target.reset(); if ($('newUserId')) $('newUserId').value = ''; $('newUserPassword').required = true; fillPerms(''); toggleUserTeacher();
    renderUsers(); refreshSyncPill();
    alert(editId ? ('User updated (' + u.Role + '). Username: ' + u.Username) : ('User created (' + u.Role + '). Username: ' + u.Username + (u.TeacherID ? ' — linked to ' + teacherName(u.TeacherID) : '')));
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
    $('settingsNote').textContent = t('settingsSaved') + (settings.AdminPhone || '—') + '. ' + (url ? 'API URL set — syncing…' : 'No API URL — local only.');
    refreshSyncPill();
    if (url) refreshFromServer();
  };

  window.markSabaqRecited = function (studentId, recited) {
    if (!requireRole('saveSabaq')) return;
    var date = ($('sabaqReportDate') && $('sabaqReportDate').value) || today();
    var ex = sabaq.filter(function (r) { return String(r.StudentID) === String(studentId) && r.Date === date; })[0];
    var row = ex || { Date: date, StudentID: studentId, Sabaq: '', Amount: '', TeacherNote: '', MarkedBy: currentUser ? currentUser.Name : '' };
    row.Recited = recited;
    if (!row.Sabaq) row.Sabaq = recited === 'No' ? '—' : '';
    if (!ex) sabaq.push(row);
    MMLocal.saveLocal('sabaq', sabaq);
    MMLocal.queueChange('saveSabaq', { sabaq: row, role: role() });
    renderSabaqReport(); refreshSyncPill();
  };

  /* ---------- global search (top bar) ---------- */
  window.renderGlobalSearch = function () {
    var box = $('globalSearchResults'); if (!box) return;
    var q = ($('globalSearch').value || '').trim().toLowerCase();
    var fc = $('globalSearchClass') ? $('globalSearchClass').value : '';
    if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var rows = students.filter(function (s) {
      return (!fc || s.Class === fc) &&
        (s.Name + ' ' + s.FatherName + ' ' + s.Class + ' ' + (s.Address || '')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    box.innerHTML = rows.length ? rows.map(function (s) {
      return '<div class="search-row" onclick="openSearchStudent(\'' + esc(s.StudentID) + '\')"><b>' + esc(s.Name) + '</b> — ' + esc(cls(s.Class)) + ' · ' + esc(s.FatherName) + '</div>';
    }).join('') : '<div class="search-row">' + t('No students found — add one above.') + '</div>';
    box.style.display = 'block';
  };
  window.openSearchStudent = function (id) {
    var box = $('globalSearchResults'); if (box) { box.style.display = 'none'; }
    var inp = $('globalSearch'); if (inp) inp.value = '';
    showStudentProfile(id);
  };
  document.addEventListener('click', function (e) {
    var box = $('globalSearchResults');
    if (box && !e.target.closest('.top-search')) box.style.display = 'none';
    var menu = $('newMenu');
    if (menu && !e.target.closest('.new-menu-wrap')) menu.style.display = 'none';
  });

  /* ---------- + New menu ---------- */
  window.toggleNewMenu = function (e) {
    e.stopPropagation();
    var m = $('newMenu'); if (!m) return;
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
  };
  window.newEntry = function (kind) {
    var m = $('newMenu'); if (m) m.style.display = 'none';
    if (kind === 'student') { showSection('students'); resetStudentForm(); var el = $('stName'); if (el) el.focus(); }
    if (kind === 'teacher') { showSection('teachers'); resetTeacherForm(); var t2 = $('tName'); if (t2) t2.focus(); }
    if (kind === 'fee') { showSection('fees'); fillFeeStudents(); }
    if (kind === 'transaction') { showSection('accounts'); var a = $('txAmount'); if (a) a.focus(); }
    if (kind === 'item') { showSection('accounts'); var it = $('itemName'); if (it) it.focus(); }
    if (kind === 'class') { showSection('settings'); var c = $('className'); if (c) c.focus(); }
    if (kind === 'user') { showSection('settings'); var u = $('newUserName'); if (u) u.focus(); }
    if (kind === 'vehicle') { showSection('vehicles'); var v = $('vehNo'); if (v) v.focus(); }
  };

  /* ---------- classes (Admin only) ---------- */
  window.renderClasses = function () {
    var el = $('classesTable'); if (!el) return;
    el.innerHTML = classes.length ? classes.map(function (c) {
      return '<tr><td>' + esc(c.ClassName) + '</td><td>' + esc(c.Level || '—') + '</td><td>' + esc(c.Description || '') + '</td><td>' + esc(c.Status) + '</td>' +
        '<td><button class="btn small secondary" onclick="toggleClassStatus(\'' + esc(c.ClassID) + '\')">' + (c.Status === 'Active' ? t('disable') : t('enable')) + '</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">—</td></tr>';
  };
  window.toggleClassStatus = function (id) {
    if (!requireRole('saveClass')) return;
    var c = classes.filter(function (x) { return String(x.ClassID) === String(id); })[0];
    if (!c) return;
    c.Status = c.Status === 'Active' ? 'Closed' : 'Active';
    persistClass(c);
  };
  function persistClass(c) {
    MMLocal.upsertLocal('classes', 'ClassID', c);
    MMLocal.queueChange('saveClass', { classObj: c, role: role() });
    renderClasses(); fillClassSelects(); refreshSyncPill();
  }
  window.saveClassUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveClass')) return;
    var c = { ClassID: $('classId').value || ('CLS-' + Date.now()), ClassName: $('className').value.trim(), Level: $('classLevel').value.trim() || '—', Description: $('classDesc').value.trim(), Status: $('classStatus').value };
    if (!c.ClassName) return;
    persistClass(c);
    e.target.reset(); $('classId').value = '';
  };

  /* ---------- charts (Chart.js, with text fallback) ---------- */
  function lastNDays(n) {
    var out = [], d = new Date();
    for (var i = n - 1; i >= 0; i--) { var x = new Date(d); x.setDate(d.getDate() - i); out.push(x.toISOString().slice(0, 10)); }
    return out;
  }
  function drawChart(id, fallbackId, config) {
    var cv = $(id), fb = $(fallbackId);
    if (typeof Chart === 'undefined') {
      if (cv) cv.style.display = 'none';
      if (fb) { fb.style.display = 'block'; fb.textContent = t('chartsUnavailable'); }
      return;
    }
    if (fb) fb.style.display = 'none';
    if (cv) cv.style.display = 'block';
    if (charts[id]) charts[id].destroy();
    if (cv) charts[id] = new Chart(cv, config);
  }
  function attSeries(list, days) {
    return days.map(function (d) {
      var rows = attendance.filter(function (a) { return a.Date === d; });
      var present = 0, absent = 0, leave = 0;
      rows.forEach(function (a) {
        if (a.StudentID === 'SUMMARY') { var m = /Present: (\d+) \| Absent: (\d+) \| Leave: (\d+)/.exec(a.Status || ''); if (m) { present += +m[1]; absent += +m[2]; leave += +m[3]; } }
        else if (a.Status === 'Absent') absent++;
        else if (a.Status === 'Leave') leave++;
      });
      return { present: present, absent: absent, leave: leave };
    });
  }
  function renderReports() {
    var days = lastNDays(14);
    var series = attSeries(attendance, days);
    drawChart('chartAtt', 'chartAttFallback', { type: 'bar', data: { labels: days.map(function (d) { return d.slice(5); }), datasets: [
      { label: t('present'), data: series.map(function (s) { return s.present; }), backgroundColor: '#16a34a' },
      { label: t('absent'), data: series.map(function (s) { return s.absent; }), backgroundColor: '#dc2626' },
      { label: t('leave'), data: series.map(function (s) { return s.leave; }), backgroundColor: '#d97706' } ] },
      options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
    var byClass = {};
    students.forEach(function (s) { if (s.Status === 'Current') byClass[s.Class] = (byClass[s.Class] || 0) + 1; });
    drawChart('chartClass', 'chartClassFallback', { type: 'doughnut', data: { labels: Object.keys(byClass).map(cls), datasets: [{ data: Object.keys(byClass).map(function (k) { return byClass[k]; }), backgroundColor: ['#4f46e5', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#db2777', '#65a30d'] }] }, options: { responsive: true } });
    var months = [], feesByMonth = {};
    fees.forEach(function (f) { if (f.Status === 'Paid' && f.Month) feesByMonth[f.Month] = (feesByMonth[f.Month] || 0) + (Number(f.Amount) || 0); });
    Object.keys(feesByMonth).sort().slice(-6).forEach(function (m) { months.push(m); });
    drawChart('chartFees', 'chartFeesFallback', { type: 'bar', data: { labels: months, datasets: [{ label: t('navFees'), data: months.map(function (m) { return feesByMonth[m]; }), backgroundColor: '#4f46e5' }] }, options: { responsive: true, scales: { y: { beginAtZero: true } } } });
    var funds = { Madrasa: { in: 0, out: 0 }, Masjid: { in: 0, out: 0 } };
    accounts.forEach(function (a) { if (!funds[a.Fund]) return; if (a.Type === 'Income') funds[a.Fund].in += Number(a.Amount) || 0; if (a.Type === 'Expense') funds[a.Fund].out += Number(a.Amount) || 0; });
    drawChart('chartFunds', 'chartFundsFallback', { type: 'bar', data: { labels: ['Madrasa', 'Masjid'], datasets: [
      { label: 'Income', data: [funds.Madrasa.in, funds.Masjid.in], backgroundColor: '#16a34a' },
      { label: 'Expense', data: [funds.Madrasa.out, funds.Masjid.out], backgroundColor: '#dc2626' } ] },
      options: { responsive: true, scales: { y: { beginAtZero: true } } } });
    var admByMonth = {};
    students.forEach(function (s) { if (s.AdmissionDate) { var m = String(s.AdmissionDate).slice(0, 7); admByMonth[m] = (admByMonth[m] || 0) + 1; } });
    var admMonths = Object.keys(admByMonth).sort().slice(-6);
    drawChart('chartAdm', 'chartAdmFallback', { type: 'line', data: { labels: admMonths, datasets: [{ label: t('navStudents'), data: admMonths.map(function (m) { return admByMonth[m]; }), borderColor: '#4f46e5', backgroundColor: '#4f46e5', tension: 0.3 }] }, options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
  }

  /* ---------- My Class (Qari home) ---------- */
  function renderMyClass() {
    var me = myTeacher();
    var list = visibleStudents().filter(function (s) { return s.Status === 'Current'; });
    var myIds = {};
    list.forEach(function (s) { myIds[s.StudentID] = s; });
    var cardsEl = $('myClassCards');
    if (cardsEl) {
      var absentToday = attendance.filter(function (a) { return a.Date === today() && a.Status === 'Absent' && myIds[a.StudentID]; }).length;
      var leaveToday = attendance.filter(function (a) { return a.Date === today() && a.Status === 'Leave' && myIds[a.StudentID]; }).length;
      cardsEl.innerHTML =
        card(t('myClassTitle') + (me ? ' — ' + me.Name + ' (' + cls(me.Class) + ')' : ''), list.length + ' ' + t('students'), 'green') +
        card(t('absent') + ' — ' + today(), t('absent') + ': ' + absentToday + ' · ' + t('leave') + ': ' + leaveToday, absentToday ? 'red' : 'green');
    }
    var tbl = $('myClassTable');
    if (tbl) {
      tbl.innerHTML = list.length ? list.map(function (s) {
        var sessions = [s.Session1 === 'yes' ? '1st' : '', s.Session2 === 'yes' ? '2nd' : '', s.NightSession === 'yes' ? 'Night' : ''].filter(Boolean).join(', ') || '—';
        return '<tr><td>' + esc(s.Name) + '</td><td>' + esc(s.FatherName) + '</td><td>' + esc(cls(s.Class)) + '</td><td>' + sessions + '</td><td>' + esc(s.Status) + '</td>' +
          '<td><button class="btn small secondary" onclick="showStudentProfile(\'' + esc(s.StudentID) + '\')">' + t('profile') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">' + t('No students found — add one above.') + '</td></tr>';
    }
    renderMyClassAttendance();
    var days = lastNDays(14);
    var series = days.map(function (d) {
      // Per-session accuracy for THIS Qari's students only.
      var present = 0, absent = 0, leave = 0;
      ['1st', '2nd', 'Night'].forEach(function (sess) {
        var hasSummary = attendance.some(function (a) { return a.Date === d && a.Session === sess && a.StudentID === 'SUMMARY'; });
        if (!hasSummary) return;
        var inSession = list.filter(function (s) { return sess === '1st' ? s.Session1 === 'yes' : sess === '2nd' ? s.Session2 === 'yes' : s.NightSession === 'yes'; });
        var ab = attendance.filter(function (a) { return a.Date === d && a.Session === sess && a.Status === 'Absent' && myIds[a.StudentID]; }).length;
        var lv = attendance.filter(function (a) { return a.Date === d && a.Session === sess && a.Status === 'Leave' && myIds[a.StudentID]; }).length;
        absent += ab; leave += lv; present += Math.max(0, inSession.length - ab - lv);
      });
      return { present: present, absent: absent, leave: leave };
    });
    drawChart('chartMyClass', 'chartMyClassFallback', { type: 'bar', data: { labels: days.map(function (d) { return d.slice(5); }), datasets: [
      { label: t('present'), data: series.map(function (s) { return s.present; }), backgroundColor: '#16a34a' },
      { label: t('absent'), data: series.map(function (s) { return s.absent; }), backgroundColor: '#dc2626' },
      { label: t('leave'), data: series.map(function (s) { return s.leave; }), backgroundColor: '#d97706' } ] },
      options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
  }
  function renderMyClassAttendance() {
    var session = $('myAttSession') ? $('myAttSession').value : '1st';
    var list = visibleStudents().filter(function (s) { return s.Status === 'Current'; });
    if (session === '1st') list = list.filter(function (s) { return s.Session1 === 'yes'; });
    else if (session === '2nd') list = list.filter(function (s) { return s.Session2 === 'yes'; });
    else list = list.filter(function (s) { return s.NightSession === 'yes'; });
    attSessionList = list;
    attMarks = {};
    var el = $('myAttList'); if (!el) return;
    el.innerHTML = list.length ? list.map(function (s) {
      return '<div class="att-row" id="att-' + esc(s.StudentID) + '"><span class="name">' + esc(s.Name) + '</span><span class="cls">' + esc(cls(s.Class)) + '</span>' +
        '<button class="toggle" onclick="toggleAtt(\'' + esc(s.StudentID) + '\',\'Absent\',this)">' + t('absent') + '</button>' +
        '<button class="toggle" onclick="toggleAtt(\'' + esc(s.StudentID) + '\',\'Leave\',this)">' + t('leave') + '</button></div>';
    }).join('') : '<div class="empty">' + t('No students in this session.') + '</div>';
  }
  window.saveMyClassAttendance = function () {
    if (!requireRole('saveAttendance')) return;
    if (!attSessionList.length) return;
    var date0 = today(), session0 = $('myAttSession').value;
    var already0 = attendance.filter(function (a) { return a.Date === date0 && a.Session === session0 && a.StudentID === 'SUMMARY'; })[0];
    if (already0) { alert(t('attFinal')); return; }
    var absent = [], leave = [];
    Object.keys(attMarks).forEach(function (id) { if (attMarks[id] === 'Absent') absent.push(id); else leave.push(id); });
    var present = attSessionList.length - absent.length - leave.length;
    var date = today(), session = $('myAttSession').value;
    var by = currentUser ? currentUser.Name : '';
    absent.forEach(function (id) { attendance.push({ Date: date, Session: session, StudentID: id, Status: 'Absent', MarkedBy: by }); });
    leave.forEach(function (id) { attendance.push({ Date: date, Session: session, StudentID: id, Status: 'Leave', MarkedBy: by }); });
    attendance.push({ Date: date, Session: session, StudentID: 'SUMMARY', Status: 'Present: ' + present + ' | Absent: ' + absent.length + ' | Leave: ' + leave.length, MarkedBy: by });
    MMLocal.saveLocal('attendance', attendance);
    MMLocal.queueChange('saveAttendance', { date: date, session: session, markedBy: by, absent: absent, leave: leave, totalInSession: attSessionList.length, role: role() });
    var note = $('myAttSavedNote'); if (note) note.textContent = t('present') + ': ' + present + ' · ' + t('absent') + ': ' + absent.length + ' · ' + t('leave') + ': ' + leave.length;
    renderMyClass(); refreshSyncPill();
  };


  /* ---------- vehicles (expenses tracked separately) ---------- */
  function vehicleNo(id) { if (!id) return '—'; var v = vehicles.filter(function (x) { return String(x.VehicleID) === String(id); })[0]; return v ? v.VehicleNo : id; }
  function fillVehicleSelect() { var tv = $('txVehicle'); if (tv) tv.innerHTML = '<option value="">—</option>' + vehicles.filter(function (v) { return v.Status === 'Active'; }).map(function (v) { return '<option value="' + esc(v.VehicleID) + '">' + esc(v.VehicleNo) + ' — ' + esc(v.Type || '') + '</option>'; }).join(''); }
  window.renderVehicles = function () {
    var el = $('vehiclesTable'); if (!el) return;
    el.innerHTML = vehicles.length ? vehicles.map(function (v) {
      var exp = accounts.filter(function (a) { return String(a.VehicleID) === String(v.VehicleID) && a.Type === 'Expense'; }).reduce(function (s, a) { return s + (Number(a.Amount) || 0); }, 0);
      return '<tr><td>' + esc(v.VehicleNo) + '</td><td>' + esc(v.Type || '—') + '</td><td>' + esc(v.Driver || '—') + '</td><td>' + esc(v.Route || '—') + '</td><td>' + esc(v.Status) + '</td><td>' + rs(exp) + '</td>' +
        '<td><button class="btn small secondary" onclick="editVehicle(\'' + esc(v.VehicleID) + '\')">' + t('edit') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">' + t('noVehicles') + '</td></tr>';
    fillVehicleSelect();
  };
  window.editVehicle = function (id) {
    if (!requireRole('saveVehicle')) return;
    var v = vehicles.filter(function (x) { return String(x.VehicleID) === String(id); })[0]; if (!v) return;
    $('vehId').value = v.VehicleID; $('vehNo').value = v.VehicleNo || ''; $('vehType').value = v.Type || '';
    $('vehDriver').value = v.Driver || ''; $('vehRoute').value = v.Route || ''; $('vehStatus').value = v.Status || 'Active';
    window.scrollTo(0, 0);
  };
  window.saveVehicleUI = function (e) {
    e.preventDefault(); if (!requireRole('saveVehicle')) return;
    var v = { VehicleID: $('vehId').value || ('VEH-' + Date.now()), VehicleNo: $('vehNo').value.trim(), Type: $('vehType').value.trim(), Driver: $('vehDriver').value.trim(), Route: $('vehRoute').value.trim(), Status: $('vehStatus').value };
    if (!v.VehicleNo) { alert(t('vehicleNoRequired')); return; }
    MMLocal.upsertLocal('vehicles', 'VehicleID', v);
    MMLocal.queueChange('saveVehicle', { vehicle: v, role: role() });
    e.target.reset(); $('vehId').value = '';
    renderVehicles(); refreshSyncPill();
  };
  window.resetVehicleForm = function () { $('vehicleForm').reset(); $('vehId').value = ''; };

  /* ---------- print: POS slip receipt (80mm) + A4 student profile ---------- */
  window.printReceiptSlip = function (receiptNo) {
    var rec = receipts.filter(function (r) { return String(r.ReceiptNo) === String(receiptNo); })[0]; if (!rec) return;
    var name = rec.StudentID ? studentName(rec.StudentID) : '';
    var w = window.open('', '_blank', 'width=340,height=640');
    if (!w) { alert('Please allow pop-ups to print.'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Receipt ' + esc(rec.ReceiptNo) + '</title><style>body{font-family:monospace;width:80mm;margin:0 auto;padding:8px;font-size:13px}h2{text-align:center;font-size:15px;margin:4px 0}p,td{margin:2px 0}table{width:100%}hr{border-top:1px dashed #000}.c{text-align:center}.r{text-align:right}</style></head><body>' +
      '<h2>' + esc(settings.MadrasaName || 'Madrasa') + '</h2><p class="c">' + esc(settings.Address || '') + '</p><hr>' +
      '<table><tr><td>Receipt</td><td class="r"><b>' + esc(rec.ReceiptNo) + '</b></td></tr>' +
      '<tr><td>Date</td><td class="r">' + esc(rec.Date) + '</td></tr>' +
      '<tr><td>Fund</td><td class="r">' + esc(rec.Fund) + '</td></tr>' +
      (name ? '<tr><td>Student</td><td class="r">' + esc(name) + '</td></tr>' : '') +
      '<tr><td>Purpose</td><td class="r">' + esc(rec.Purpose) + '</td></tr></table><hr>' +
      '<p><b>Amount: ' + rs(rec.Amount) + '</b></p><p class="c">' + esc(t('thankYou')) + '</p>' +
      '<script>window.onload=function(){window.print();}</script></body></html>');
    w.document.close();
  };
  window.printStudentProfile = function () {
    var s = students.filter(function (x) { return String(x.StudentID) === String(profileStudentId); })[0]; if (!s) return;
    var rows = ledger.filter(function (r) { return String(r.StudentID) === String(s.StudentID); });
    var att = attendance.filter(function (a) { return String(a.StudentID) === String(s.StudentID); });
    var sab = sabaq.filter(function (r) { return String(r.StudentID) === String(s.StudentID); }).slice(-10).reverse();
    var w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { alert('Please allow pop-ups to print.'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(s.Name) + '</title><style>body{font-family:Arial,sans-serif;margin:20px;font-size:14px}h1{font-size:20px}h2{font-size:15px;margin-top:18px;border-bottom:1px solid #999;padding-bottom:4px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:5px 8px;text-align:left}img{max-width:120px;max-height:120px}</style></head><body>' +
      '<h1>' + esc(settings.MadrasaName || 'Madrasa') + ' — ' + esc(s.Name) + '</h1>' +
      (s.PhotoURL ? '<img src="' + esc(s.PhotoURL) + '" alt="">' : '') +
      '<table><tr><td>Father</td><td>' + esc(s.FatherName) + '</td></tr><tr><td>Class</td><td>' + esc(s.Class) + '</td></tr>' +
      '<tr><td>Status</td><td>' + esc(s.Status) + '</td></tr><tr><td>Admission</td><td>' + esc(s.AdmissionDate) + '</td></tr>' +
      '<tr><td>Monthly fee</td><td>' + rs(s.MonthlyFee) + '</td></tr><tr><td>Address</td><td>' + esc(s.Address || '—') + '</td></tr>' +
      '<tr><td>Father phone</td><td>' + esc(s.FatherPhone || '—') + '</td></tr><tr><td>Guardian phone</td><td>' + esc(s.GuardianPhone || '—') + '</td></tr></table>' +
      '<h2>Ledger</h2><table><tr><th>Date</th><th>Type</th><th>Amount</th><th>Receipt</th></tr>' +
      (rows.length ? rows.slice().reverse().map(function (r) { return '<tr><td>' + esc(r.Date) + '</td><td>' + esc(r.Type) + '</td><td>' + rs(r.Amount) + '</td><td>' + esc(r.ReceiptNo) + '</td></tr>'; }).join('') : '<tr><td colspan="4">No entries</td></tr>') + '</table>' +
      '<h2>Attendance (recorded)</h2><p>' + (att.length ? att.map(function (a) { return a.Date + ' (' + a.Session + '): ' + a.Status; }).join(' · ') : 'No record') + '</p>' +
      '<h2>Sabaq — recent</h2><p>' + (sab.length ? sab.map(function (r) { return r.Date + ' — ' + (r.Sabaq || '—') + ' (' + (r.Recited || 'Yes') + ')'; }).join('<br>') : '—') + '</p>' +
      '<script>window.onload=function(){window.print();}</script></body></html>');
    w.document.close();
  };
  window.downloadStudentProfile = function () {
    var s = students.filter(function (x) { return String(x.StudentID) === String(profileStudentId); })[0]; if (!s) return;
    var data = { student: s, ledger: ledger.filter(function (r) { return String(r.StudentID) === String(s.StudentID); }), attendance: attendance.filter(function (a) { return String(a.StudentID) === String(s.StudentID); }), sabaq: sabaq.filter(function (r) { return String(r.StudentID) === String(s.StudentID); }) };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'student-' + s.StudentID + '.json'; a.click();
  };
  window.shareStudentProfile = function () {
    var s = students.filter(function (x) { return String(x.StudentID) === String(profileStudentId); })[0]; if (!s) return;
    var text = (settings.MadrasaName || 'Madrasa') + ' — ' + s.Name + ' (' + s.Class + ') · Father: ' + s.FatherName + ' · Fee: ' + rs(s.MonthlyFee) + ' · Status: ' + s.Status;
    if (navigator.share) { navigator.share({ title: s.Name, text: text }).catch(function () {}); return; }
    if (navigator.clipboard) { navigator.clipboard.writeText(text).then(function () { alert(t('copiedLabel')); }).catch(function () { alert(text); }); return; }
    alert(text);
  };

  /* ---------- backup: download whole dataset / upload to restore ---------- */
  window.downloadBackupUI = function () {
    if (!requireRole('exportBackup')) return;
    MMLocal.apiPost('exportBackup', { role: role() }).then(function (d) {
      if (d && d.ok && d.backup) {
        var blob = new Blob([JSON.stringify(d.backup, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'madrasa-masjid-backup-' + today() + '.json'; a.click();
      } else alert((d && d.error) || 'Backup failed.');
    }).catch(function () { alert('Backup failed — check connection.'); });
  };
  window.uploadBackupUI = function (input) {
    if (!requireRole('restoreBackup')) return;
    var f = input.files && input.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var b = JSON.parse(r.result);
        if (!b.tabs) { alert('Invalid backup file.'); return; }
        if (!confirm(t('backupRestoreConfirm'))) return;
        MMLocal.apiPost('restoreBackup', { backup: b, role: role() }).then(function (d) {
          if (d && d.ok) { alert(t('backupRestored')); refreshFromServer(); }
          else alert((d && d.error) || 'Restore failed.');
        }).catch(function () { alert('Restore failed — check connection.'); });
      } catch (e) { alert('Invalid backup file.'); }
    };
    r.readAsText(f);
  };

  /* ---------- Admin changes his own password ---------- */
  window.changeMyPasswordUI = function (e) {
    e.preventDefault();
    if (!requireRole('saveUser')) return;
    var np = $('myNewPass').value, cp = $('myConfirmPass').value;
    if (!np || np.length < 6) { alert(t('passMin6')); return; }
    if (np !== cp) { alert(t('passNoMatch')); return; }
    var me = currentUser;
    var payloadUser = { UserID: me.UserID, Name: me.Name, Role: me.Role, Username: me.Username, Password: np, Phone: me.Phone || '', Status: 'Active', Email: me.Email || '' };
    MMLocal.apiPost('saveUser', { user: payloadUser, role: role() }).then(function (d) {
      if (d && d.ok) {
        var u = users.filter(function (x) { return String(x.UserID) === String(me.UserID); })[0];
        if (u) { u.Password = np; MMLocal.saveLocal('users', users); }
        $('myNewPass').value = ''; $('myConfirmPass').value = '';
        alert(t('passwordChanged'));
      } else alert((d && d.error) || 'Could not change password.');
    }).catch(function () { alert('Could not change password — check connection.'); });
  };

  /* ---------- users (Admin only) + admin-only passwords ---------- */
  window.toggleUserTeacher = function () {
    var wrap = $('userTeacherWrap'); if (!wrap) return;
    wrap.style.display = $('newUserRole').value === 'Qari' ? '' : 'none';
    var sel = $('newUserTeacher');
    if (sel) sel.innerHTML = '<option value="">—</option>' + teachers.filter(function (x) { return x.Status === 'Active'; }).map(function (x) { return '<option value="' + esc(x.TeacherID) + '">' + esc(x.Name) + ' — ' + esc(cls(x.Class)) + '</option>'; }).join('');
  };
  window.genPasswordUI = function () {
    var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var p = '';
    for (var i = 0; i < 8; i++) p += chars[Math.floor(Math.random() * chars.length)];
    $('newUserPassword').value = p;
    alert('Generated password (give it to the user once, then it is the Admin\'s record): ' + p);
  };
  window.resetUserPassword = function (id) {
    if (!requireRole('saveUser')) return;
    var u = users.filter(function (x) { return String(x.UserID) === String(id); })[0];
    if (!u) return;
    var np = prompt('New password for ' + u.Name + ' (' + u.Username + ') — only the Admin sets passwords:');
    if (!np || np.length < 4) { alert('Password must be at least 4 characters.'); return; }
    u.Password = np;
    persistUser(u, true);
    alert('Password reset for ' + u.Username + '. Give the new password to the user yourself.');
  };
  function init() {
    if (API_URL) MMLocal.setApiUrl(API_URL); // file placeholder; Settings value wins if already saved
    applyLang();
    loadLocal();
    restoreSession();
    $('attDate').value = today(); $('feeDate').value = today(); $('txDate').value = today();
    $('feeMonth').value = thisMonth(); $('stAdmission').value = today(); $('tJoin').value = today();
    if ($('ledgerDate')) $('ledgerDate').value = today();
    if ($('sabaqDate')) $('sabaqDate').value = today();
    if ($('sabaqReportDate')) $('sabaqReportDate').value = today();
    $('setApiUrl').value = MMLocal.getApiUrl();
    $('setImgbb').value = MMImage.getKey() || '';
    fillSettingsForm(); applyBranding(); fillClassSelects(); fillInChargeSelect(); toggleUserTeacher();
    renderDashboard(); renderStudents(); renderTeachers(); renderFees(); renderAccounts(); renderReceipts(); fillFeeStudents(); fillLedgerStudents(); fillSabaqStudents(); renderNotifLog(); renderHistory(); renderUsers(); renderItems(); renderClasses(); renderSabaqReport(); refreshSyncPill();
    refreshFromServer();
    if (currentUser) { showApp(); if (currentUser.Role === 'Qari') showSection('my-class'); } else showLogin();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
