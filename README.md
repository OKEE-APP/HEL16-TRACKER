# HEL16 Site Tracker

OKEE's installation, testing and QA/QC tracker for HEL16, as an installable phone app that works without signal.

- **Open:** https://okee-app.github.io/HEL16-TRACKER/ (open it once with signal, sign in, then use **Add to Home Screen**)
- **Teams:** `#install`, `#test` and `#qa` open the Installers, Testers and QA/QC apps directly.

## How offline works

- `sw.js` keeps the app, the Firebase libraries, fonts and the QR library on the phone, so the app opens with no signal.
- Firestore keeps a copy of the site data on the phone. Every area is downloaded after sign-in, while there is signal.
- Work recorded offline is held on the phone (the pill in the header shows how many items) and sent automatically when signal returns. Photos are held too.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page, styles and startup |
| `app.js` | The tracker itself |
| `firebase-shim.js` | Sign-in, team access, and the Firebase data, photo and file layer |
| `config.js` | Firebase project settings and owner emails |
| `sw.js` | Offline layer. **Bump `VERSION` on every change** so phones pick up the update |
| `firebase/*.rules` | Security rules to paste into the Firebase console |

## Access

Owners (in `config.js` and both rules files) are always Editors. Editors add everyone else under **Account → Team access**:

- **Editor:** records work, edits the circuit schedule, adds boards, signs off and manages the team
- **Contributor:** records work
- **View only:** sees progress

Site data is never stored in this repository. It lives only in Firebase.
