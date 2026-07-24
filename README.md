# AttendPro — Smart Attendance Management System

A web-based attendance system for students, lecturers and admins. A lecturer
starts a session, students check in by scanning a QR code, and the check-in is
verified server-side against the lecturer's WiFi (the real client IP) so
attendance can't be forged from off-network.

- **Frontend** — static HTML/CSS/JS (Firebase Auth + Firestore, EmailJS for the
  student one-time sign-in code).
- **Backend** — a small Flask API (`backend/`) that generates session QR codes
  and performs the IP-verified check-in using the Firebase Admin SDK.

## Layout

```
├── index.html                 Landing page
├── auth/                       Student & lecturer sign-in / sign-up
├── admin-dashboard.html        Admin: students, lecturers, courses, reports
├── lecturer-dashboard.html     Lecturer: courses, start/end session, live feed
├── student-dashboard.html      Student: attendance history, open sessions
├── checkin.html                Landing page after scanning a session QR code
├── js/                         Frontend logic (see js/firebase-config.js first)
├── css/style.css
├── firestore.rules             Firestore security rules (publish in console)
└── backend/                    Flask API (app.py) + deploy notes (README.md)
```

## Roles & flow

1. **Admin** pre-approves lecturers (Staff ID + email) and creates **courses**,
   assigning each to a lecturer.
2. **Lecturer** signs up (only if pre-approved) and signs in with email/password.
   They pick one of their assigned courses and **start a session** — the backend
   registers the lecturer's current IP and returns a QR code.
3. **Student** self-registers with a matric number, signs in via an emailed
   one-time code, and checks in by scanning the QR (or entering their matric
   number on `checkin.html`). The backend records attendance only if the request
   comes from the lecturer's registered network.

## Running locally

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# The Firebase Admin credential — download from Firebase console →
# Project settings → Service accounts → Generate new private key.
export FIREBASE_SERVICE_ACCOUNT=/path/to/serviceAccountKey.json
export FRONTEND_CHECKIN_URL=http://localhost:8000/checkin.html
python app.py            # serves on http://localhost:5000
```

### Frontend

```bash
# from the repo root
python3 -m http.server 8000    # open http://localhost:8000
```

`js/api-config.js` auto-points at `http://localhost:5000` when served from
localhost, and at the deployed backend otherwise (update the production URL
there once deployed — see `backend/README.md`).

## Configuration

- `js/firebase-config.js` — Firebase web config + EmailJS IDs.
- `firestore.rules` — **must be published** in Firebase console → Firestore →
  Rules. It denies all client writes to `sessions`/`attendance` (only the
  backend's Admin SDK writes them) and allows the `courses` collection the admin
  dashboard needs.

> Note: matric numbers may contain slashes (e.g. `DOU/SE/001`), which Firestore
> forbids in a document id, so students are stored under `encodeURIComponent(matNo)`
> (the backend mirrors this with `urllib.parse.quote(mat_no, safe="")`). The raw
> matric number is kept as a field on the document.
