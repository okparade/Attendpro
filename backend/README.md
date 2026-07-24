# AttendPro backend — deploying to PythonAnywhere (free tier)

Why PythonAnywhere: it's genuinely free with no credit card required,
and unlike Render's free tier it doesn't sleep after inactivity (no
cold-start delay when a lecturer clicks "Start Attendance").

## 1. Get a Firebase service account key

This is a **different** credential from the `firebaseConfig` object
used in the frontend — it gives the backend full admin access to
Firestore, so keep it secret and never commit it.

1. Firebase console → ⚙️ Project settings → **Service accounts**
2. Click **Generate new private key** → downloads a JSON file
3. Rename it to `serviceAccountKey.json` — you'll upload this in step 3

## 2. Create your PythonAnywhere account

1. Sign up free at https://www.pythonanywhere.com (Beginner account)
2. Open a **Bash console** from the dashboard

## 3. Upload the code

Easiest option — from the Bash console:

```bash
git clone <your-repo-url> attendpro-backend
cd attendpro-backend/backend
pip install --user -r requirements.txt
```

No repo yet? Use the **Files** tab to upload `app.py`,
`requirements.txt`, and your `serviceAccountKey.json` directly into
a folder, e.g. `/home/yourusername/attendpro-backend/backend/`.

## 4. Create the web app

1. Go to the **Web** tab → **Add a new web app**
2. Choose **Manual configuration** (not the Flask wizard) → Python 3.10
3. Edit the **WSGI configuration file** it links to — replace the
   contents with:

```python
import sys, os

path = '/home/yourusername/attendpro-backend/backend'
if path not in sys.path:
    sys.path.insert(0, path)

# Free tier has no dedicated "environment variables" UI, so set them
# here instead, before importing the app:
os.environ['FIREBASE_SERVICE_ACCOUNT'] = f'{path}/serviceAccountKey.json'
os.environ['FRONTEND_CHECKIN_URL'] = 'https://your-site.example.com/checkin.html'

from app import app as application
```

4. Back on the **Web** tab, click the green **Reload** button

## 5. Test it

Visit `https://yourusername.pythonanywhere.com/health` — you should
see `{"status": "ok"}`.

## 6. Point the frontend at it

Open `js/api-config.js` and set:

```js
const API_BASE_URL = 'https://yourusername.pythonanywhere.com';
```

## Notes / limits on the free tier

- Outbound requests from a free PythonAnywhere account are restricted
  to an allowlist of sites — this backend doesn't make any outbound
  calls itself (Firestore access via the Admin SDK is allowlisted by
  default), so you shouldn't hit this.
- CPU seconds are capped on the free tier, but these endpoints are
  tiny (a Firestore read/write and a QR image) — a small class won't
  come close.
- If you outgrow the free tier, the same `app.py` runs unchanged on
  Render, Railway, or any host that runs a WSGI app with `gunicorn`.
