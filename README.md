# Madrasa + Masjid Admin Panel

Admin panel for a Madrasa (Islamic school) + Masjid (mosque) — one entity, separate funds.

- **Frontend:** `index.html` + `admin.js` + `admin.css` (GitHub Pages)
- **Local data layer:** `order.js` — saves on the device first, syncs to Google Sheets when online (ready for Electron / mobile later)
- **Image compression:** `image.js` — photos compressed to max 800px JPEG before upload
- **Backend:** `Code.gs` — Google Apps Script Web App, Google Sheets as database
- **Setup:** see `SETUP-GUIDE.md`

## Features (v3)

- Login first — roles: Admin, Editor, Qari (each Qari sees only his own class)
- Forgot Password flow + Add Email / email verification (demo code shown on screen in demo mode, emailed via MailApp in live mode)
- Student + Qari profiles, admission fee (paid yes/no), per-student ledger (payments from home)
- Attendance — default Present, mark Absent/Leave only; sessions 1st / 2nd / Night
- Fees with printable receipts, separate Madrasa / Masjid funds, expenses by item (allocated vs spent)
- History — joined / left / Hifz completed, contacts, locations
- Settings — institution name, logo, admin contact (saved to the Sheet), white-label so it can be sold to other madaris

## Demo logins (change after first login)

- Admin: `admin` / `admin123`
- Editor: `editor` / `editor123`
- Qari: `qari` / `qari123`

Demo login only — passwords are plain in the Sheet. Do not use a real password there.

## Live Sheet

Google Sheet: **Madrasa Masjid Admin** — 11 tabs: Students, Teachers, Users, Attendance, Sabaq, Fees, StudentLedger, Accounts, Items, Receipts, Settings.
Sheet ID is in `Code.gs` (line 24).
