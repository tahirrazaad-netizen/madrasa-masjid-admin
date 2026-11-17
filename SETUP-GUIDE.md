# Madrasa + Masjid Admin Panel — SETUP GUIDE (v3)

> **Status: v3, built locally. NOT live-tested yet.**
> No real Google Sheet and no GitHub repo were connected during this build —
> all three connection values below are placeholders. Nothing here uses
> real student / teacher names or real amounts: the only rows are clearly
> labelled DEMO rows, easy to delete.
>
> **What changed in v2:** login screen first, roles (Admin / Editor / Qari),
> student + Qari profiles, admission-fee tracking, per-student ledger,
> expenses by item/budget, History section, Admin contact in Settings
> (saved to the Sheet), and white-label branding so it can be sold to
> another Madrasa. Everything from v1 still works.
>
> **What changed in v3:** Forgot Password flow (username/email → 6-digit
> code → new password) and Add Email flow (add email + verify with a
> 6-digit code) for every user. In demo/local mode the code is SHOWN on
> screen labelled "DEMO CODE" so the flows can be tested end-to-end
> without a Sheet or email. In live mode the code is EMAILED with
> MailApp and never shown. Everything from v1 + v2 still works.

## What this is

- **Admin panel first** (this build). User / teacher app comes later.
- **Frontend:** static HTML on GitHub Pages — `index.html`, `admin.css`,
  `admin.js`, `order.js`, `image.js`.
- **Backend:** Google Sheets, via one Apps Script Web App — `Code.gs`.
  The frontend calls it with `fetch()` JSON. There is **no**
  `google.script.run` in the GitHub files, because GitHub Pages is
  static hosting, not Apps Script hosting.
- **Madrasa and Masjid are one entity but have SEPARATE funds.**
  Every transaction picks Fund = Madrasa or Masjid, and the dashboard
  shows two separate balances. Never mix them.
- **Language:** Urdu (RTL) first, English in brackets.
- **Local-first:** `order.js` saves every record on the device
  (localStorage) first, queues the change, and syncs to the Sheet when
  online. The same file is meant to work later inside Electron / mobile.

## Files in this folder

| File | What it does |
|---|---|
| `index.html` | Login screen (+ Forgot Password) + whole admin panel: Dashboard, Students, Student Profile, Teachers, Qari Profile, Attendance (+ Sabaq), Fees, Accounts (+ Items/Budget), Receipts, History, My Account (Add/Verify Email), Settings (+ Users) |
| `admin.css` | Green/teal styling, RTL, mobile-friendly + login/profile styles (v2) |
| `admin.js` | All panel logic: login, roles, profiles, ledger, items, history, settings via order.js queue + v3 Forgot Password and Add/Verify Email flows (live API call when a URL is set, local demo helpers otherwise) |
| `order.js` | Local data layer: `saveLocal`, `queueChange`, `syncNow`, `getLocal` + offline outbox + sync status; now also stores users, ledger, items, sabaq, settings + v3 local demo helpers (`requestPasswordResetLocal`, `verifyResetCodeLocal`, `resetPasswordLocal`, `saveUserEmailLocal`, `requestEmailVerificationLocal`, `verifyEmailLocal`) |
| `image.js` | Photo compression (max 800px, JPEG 0.75, before/after size) + ImgBB upload; only the hosted URL goes in the Sheet, never base64 |
| `Code.gs` | Apps Script backend: JSON API + auto-creates Sheet tabs + demo seed (once only) + server-side role checks |
| `SETUP-GUIDE.md` | This file |

## Step 1 — Create the Google Sheet

1. Go to https://sheets.google.com — create a **blank** spreadsheet.
2. Name it e.g. `Madrasa Masjid Accounts`.
3. Copy the **Sheet ID** from its URL:
   `https://docs.google.com/spreadsheets/d/` **`<THIS PART>`** `/edit`
4. Keep the sheet empty — `Code.gs` creates the tabs itself.

## Step 2 — Paste the Sheet ID in Code.gs (exact line)

- File: `Code.gs`
- Line: **run `grep -n "const SHEET_ID" Code.gs`** — in v2 it is still
  `const SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';`
  (just under the `// >>> PASTE YOUR GOOGLE SHEET ID HERE` comment).
- Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID only.
  Do not change anything else on that line.

Tabs created automatically on first run, with these exact columns:

- **Students:** StudentID, Name, FatherName, Age, Class, Session1, Session2,
  NightSession, AdmissionDate, MonthlyFee, Status, FatherPhone, GuardianPhone,
  Address, AdmissionFeeAmount, AdmissionFeePaid, AdmissionFeeDate,
  AdmissionFeeReceiptNo, ClassHistory, PhotoURL
- **Teachers:** TeacherID, Name, Phone, Class, JoinDate, LeaveDate, Status, MonthlySalary, PhotoURL
- **Users:** UserID, Name, Role (Admin / Editor / Qari), Username, Password, Phone, Status, Email, EmailVerified (Yes/No), VerifiedDate, ResetCode, ResetExpiry. v3: if the Sheet was made with v2, `Code.gs` adds the missing columns itself on first run (`ensureTabHeaders`) — no manual fix needed. The ResetCode is never sent to the browser (stripped in `getUsers`).
- **Attendance:** Date, Session, StudentID, Status, MarkedBy
- **Sabaq:** Date, StudentID, Sabaq, Amount, TeacherNote, MarkedBy
- **Fees:** ReceiptNo, Date, StudentID, Month, Amount, Status, Method
- **StudentLedger:** LedgerID, Date, StudentID, Type (PaymentFromHome / Fee / Advance / Refund), Amount, Method, ReceiptNo, Note
- **Accounts:** Date, Fund, Type, Category, Item, Allocated, AllocatedAmount, SpentAmount, Amount, Description, ReceiptNo, EnteredBy, TeacherID
- **Items:** ItemID, ItemName, Fund, AllocatedAmount, SpentAmount, Status
- **Receipts:** ReceiptNo, Date, Fund, StudentID, TeacherID, Amount, Purpose
- **Settings:** Key, Value (MadrasaName, MasjidName, AdminName, AdminPhone, AdminWhatsApp, Address, LogoURL, ThemeColor)

Demo rows are seeded **only once ever** (script-property flag `mm_seeded_v2`).
If you delete all real rows, the demos do **not** come back. Delete the
DEMO rows from Students / Teachers after your first real entry.

## Step 3 — Deploy Code.gs as a Web App

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` content, paste this project's `Code.gs`.
3. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone** (or "Anyone with a Google account")
4. Copy the Web App URL — it ends in `/exec`.
5. **After ANY change to Code.gs, redeploy as a NEW version** —
   otherwise the old code keeps running.

## Step 4 — Paste the Web App URL in admin.js (exact line)

- File: `admin.js`
- Line: **run `grep -n "var API_URL" admin.js`** — in v2 it is still
  `var API_URL = '';` near the top of the file, under the
  `// >>> PASTE YOUR APPS SCRIPT WEB APP URL HERE` comment.
- Paste the `/exec` URL between the quotes.
- Easier alternative: after logging in, go to **Settings**, paste the URL
  there and press Save — Settings overrides the file value.

## Step 5 — ImgBB key (photos)

- Free key: https://api.imgbb.com/ → create a key.
- File: `image.js` — line `var IMGBB_API_KEY = '';`
  (under the `// >>> PASTE YOUR IMGBB API KEY HERE` comment),
  **or** paste it in **Settings** in the panel (Settings wins).
- Without a key, photo compression + preview still work, but the photo
  is **not** uploaded and the panel says so plainly. The Sheet stores
  only the hosted URL, never base64.

## Step 6 — Upload to GitHub Pages

1. Create a GitHub repo (e.g. `madrasa-masjid-admin`) — link still pending
   from the user; **do not upload anywhere until the repo link is given**.
2. Upload `index.html`, `admin.css`, `admin.js`, `order.js`, `image.js`
   to the repo root (do **not** upload `Code.gs` to GitHub Pages —
   it lives in Apps Script only).
3. Repo → **Settings → Pages** → deploy from the `main` branch, root folder.
4. Open the Pages URL — the **login screen** should appear first.

## Step 7 — First login (DEMO — change immediately)

The login screen appears before the panel. Demo logins (clearly labelled
DEMO on the screen itself):

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Editor | `editor` | `editor123` |
| Qari | `qari` | `qari123` |

**After first login, Admin must:** Settings → Users → create a real Admin
user with a new password, then Disable the demo `admin` user. Also fill in
Settings → Madrasa name, Admin phone, address, logo.

⚠️ **Login security — read this:** this login is a **demo / small-trust-circle
login only**. Passwords are stored in the Sheet's Users tab in plain text
and checked by Apps Script. Anyone who can read the Sheet can read them.
Do NOT use a real Google / bank / email password here, and do not treat
this as secure production auth. Real auth (Google sign-in check in Apps
Script) is a later step. The panel is protected from casual visitors,
not from someone with Sheet access.

### Roles — what each role can / cannot do

| | Admin | Editor | Qari |
|---|---|---|---|
| Dashboard, Students, Teachers | ✓ | ✓ | Own class only |
| Student / Qari profile | ✓ | ✓ | Own profile + own class |
| Attendance (default Present, mark Absent only) | ✓ | ✓ | ✓ own class only |
| Sabaq (what the child recited) | ✓ | ✓ | ✓ |
| Fees + per-student ledger | ✓ | ✓ | ✗ |
| Accounts, Items/Budget, Receipts, History | ✓ | ✓ (Accounts) / History ✓ | ✗ |
| Settings (branding, Admin phone, API URL) | ✓ | ✗ | ✗ |
| Users (create / disable, grant Editor) | ✓ | ✗ | ✗ |

Role checks run in **two places**: `admin.js` hides/disables sections
per role, AND `Code.gs` `handleAction` rejects disallowed actions
(`ROLE_DENY` in Code.gs). If the frontend is bypassed, the server still
says no. Editor cannot change Settings/Users; Qari cannot save students,
teachers, fees, transactions, ledger, items or settings.

## Step 8 — Settings: Admin contact + branding (white-label)

Admin only, in **Settings**:

- **Madrasa name / Masjid name / Address / Logo URL / Theme colour** —
  shown on the login screen, top bar and receipts. No Madrasa name is
  hard-coded in the HTML/JS except as a default placeholder.
- **Admin name / Admin phone / Admin WhatsApp** — saved to the Sheet's
  Settings tab via `saveSettings` (locally first through `order.js`,
  queued to sync when offline). The saved number shows on the Dashboard
  and the top bar.

## Step 9 — Test (v2 checklist — still valid in v3)

> The v2 checklist below still applies. The v3 checklist is Step 10.

1. **Login:** open the panel → login screen shows first → `admin / admin123`
   logs in → panel appears → Logout returns to the login screen.
2. **Roles:** log in as `editor` → Settings is hidden. Log in as `qari` →
   Accounts / Fees / Receipts / History / Settings are hidden, and
   Students/Attendance show only his class.
3. **Profiles:** click 👤 on a student → full profile: photo, father,
   address/location, phones, class history, admission fee, ledger with
   running balance. Click 👤 on a teacher → photo, class, salary,
   advances, salary history, his students, attendance he marked.
4. **Admission fee:** add a student with Admission Fee = 500, Paid = No →
   Dashboard shows "Admission fee pending". Change to Yes → receipt
   number appears.
5. **Ledger:** in a student profile, add "Payment from home" Rs 1,000 →
   it appears in his ledger with a receipt number and running balance.
6. **Items/Budget:** add item "کتابیں", Allocated 10,000, Fund Madrasa →
   record an Expense with Item "کتابیں" Rs 2,000 → Spent becomes 2,000,
   Remaining 8,000.
7. **History:** History section shows total joined ever / left /
   Hifz completed / current, with phones + locations; filter by year
   and by location.
8. **Settings contact:** Admin changes Admin Phone → Dashboard shows the
   new number → after sync, the Sheet's Settings tab has AdminPhone.
9. **Sync pill (top right):** with no API URL it says "Saved locally";
   after Step 4 + a reload it should say "Synced" (or "Pending (n)").

## Step 10 — Test v3: Forgot Password + Add Email

### A. Forgot Password — DEMO mode (no Sheet, no email — test right now)
1. Open `index.html` in a browser (double-click the file is enough for the demo).
2. On the login screen click **"Forgot Password?"**.
3. **Step 1:** type `admin` → **Send reset code**. A box appears with a
   **DEMO CODE** (6 digits, e.g. `482913`) — clearly labelled, because in
   demo mode nothing is emailed.
4. **Step 2:** type a WRONG code first → you must see "Wrong code, or the
   code has expired". Then type the DEMO CODE → it accepts it.
5. **Step 3:** type a new password twice (e.g. `newpass123`) → **Save**.
   You return to the login screen with "✅ Password changed".
6. Log in with `admin / newpass123` → it works. Log in with the OLD
   password `admin123` → it must FAIL (old password stops working).
7. **Ask Admin path:** repeat Step 1 with a user who has NO email saved
   (all demo users start with no email) → the screen says "No email is
   saved on this account. Ask the Admin…" and shows the Admin's phone
   from Settings, plus the DEMO CODE for testing.
8. **Expiry:** a code is valid for 15 minutes only. (To test expiry
   quickly, request a code, wait — or in the browser console change the
   stored `ResetExpiry` to the past — then verify must fail.)

### B. Add Email — DEMO mode
1. Log in as Admin (`admin / admin123` — or your new password from A).
2. Sidebar → **My Account** → type an email (e.g. `admin@example.com`)
   → **Save email**. Status shows "Verified: No".
3. Click **Send verification code** → a DEMO CODE appears on screen.
4. Enter the wrong code first → error. Enter the DEMO CODE → "✅ Email
   verified" and the status changes to **Verified: Yes** with today's date.
5. **Admin path:** Settings → Users → "Set a user's email" → pick the
   Qari user, save an email → the Users table shows the email and
   "Not verified". The Qari can then verify it from his own My Account.
6. **Own-email rule:** log in as Editor/Qari → My Account lets them
   change ONLY their own email. They cannot open Settings → Users.

### C. Forgot Password + Add Email — LIVE mode (after Steps 1–6 above)
1. Deploy `Code.gs`, set the Web App URL in Settings, reload.
2. First add an email (My Account) and verify it — the code now comes
   by REAL email (MailApp), NOT on screen. Check inbox/spam.
3. Log out → Forgot Password → type the username → the code arrives
   by email within a minute or two. Enter it → set a new password →
   log in with it.
4. If no email arrives: the screen says "Email could not be sent…
   Ask the Admin" and does NOT claim it was sent. Check: (a) the email
   address is correct in Users, (b) the Apps Script project was deployed
   "Execute as: Me" (MailApp sends as the deployer's Google account),
   (c) the account's Gmail sending quota. **MailApp note:** the free
   Apps Script mail quota is about 100 emails/day for a consumer Google
   account — plenty for reset/verification codes, but it is not a bulk
   mail service.

### D. Email is also used for
- Password reset (this flow).
- Fee-payment notification to the Qari: when a fee is recorded, the
  Dashboard notification log now names the Qari's saved email (log
  only — real push/email sending of the notification is a later step).
- Admin contact in Settings (phone/WhatsApp) is separate from email.

## BRANDING / SELLING TO ANOTHER MADRASA (white-label)

To give this software to another Madrasa, the new buyer only has to:

1. Create their own Google Sheet and paste its ID in `Code.gs` line 24.
2. Deploy `Code.gs` as a Web App and paste the URL in Settings.
3. Log in as demo Admin, go to **Settings**, and change: Madrasa name,
   Masjid name, Admin name/phone/WhatsApp, Address, Logo URL, Theme colour.
4. In **Settings → Users**, disable the demo users and create their own
   Admin / Editor / Qari users.
5. Delete the DEMO student/teacher/item rows.

No code change is needed. The Madrasa name, logo, colours, phone and
address all come from Settings; the Sheet ID is the only code value.
Do not sell it as "secure" — see the login security note above.

> **Central admin / control panel for many madaris:** that is a LATER
> step, not in v2. v2 is one self-contained copy per Madrasa.

## What was NOT live-tested

- **No real Google Sheet was connected** (Sheet ID is a placeholder).
- **No GitHub repo / Pages URL exists yet** (repo link still pending).
- **No live sync, no live ImgBB upload, no live receipt from the server,
  no live login against the Sheet.**
- The panel was verified locally only: JS syntax checked
  (`node --check`), frontend actions matched one-by-one against
  `Code.gs`, login screen / role hiding / profile sections checked by
  reading the code. Open it in a browser from the Pages URL and report
  the exact error words if anything fails.

## Features deliberately NOT in v3 (come one by one, as the user asks)

- User / teacher (Qari) app — admin panel only in v3.
- Real push notification to Qari Sahib — v3 has a notification **log** only
  (it now names the Qari's saved email, but nothing is actually emailed yet).
- Real (secure) production auth — v3 login is demo-only, see above.
  The 6-digit codes are a demo/small-trust-circle mechanism, not
  production-grade auth. Do NOT use a real Google/bank password here.
- Central admin panel to manage many madaris — later step, not now.

## v4 update (2026-11-17) — READ THIS BEFORE DEPLOYING
- **Redeploy Code.gs as a NEW VERSION** (Apps Script > Deploy > Manage deployments > pencil icon > Version: New version > Deploy). The Web App URL stays the same. Without this, the new backend features (Classes tab, InCharge/TeacherID/Recited columns, GET-payload writes, Sabaq upsert) will not run — the frontend keeps working on the old backend, but Classes and the new Qari linking will fall back to local data only.
- **Writes now go through GET** (`?action=...&payload={...}`) — a plain fetch POST loses its body on Google's redirect, so queued saves silently never reached the Sheet. `order.js` apiPost now uses this GET-payload call; Code.gs `doGet` parses it.
- **Language:** English by default, Urdu toggle button at the top. No mixed UI.
- **Passwords:** only the main Admin creates / resets passwords (Settings > Users > Reset password). There is no self-service Forgot Password any more.
- **Qari access:** link each Qari user to his Teacher record in Settings > Users. Students are assigned to a Qari via the In-charge field on the student form (or by Class when no In-charge is set). A Qari sees only his own students and lands on the My Class screen.
- **Classes:** define classes in Settings > Classes (Qaida, Nazra, Hifz, Alim-e-Deen Level 1–8, Fazil). Each level is a separate class.
- **Graphs:** Reports & Graphs section (Chart.js CDN) + a class attendance graph on My Class.
- **Sabaq:** daily report shows who recited and who did not; each student profile has an attendance calendar.
