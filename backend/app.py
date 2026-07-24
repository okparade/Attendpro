"""
AttendPro backend — Flask API

Two jobs, both of which need a real server (not just the browser):

1. Generate attendance QR codes server-side and return them as a
   plain PNG. A phone just loads an <img> — no client-side QR-drawing
   library, so no more lag on slower phone screens.

2. Verify attendance against the lecturer's WiFi using the *real*
   request IP address, which only a server can see. The client
   can't be trusted to report its own IP, so this check has to
   happen here, not in the browser.

This talks to Firestore via the Firebase Admin SDK (a service
account), which is a different credential from the firebaseConfig
used in the frontend. The Admin SDK bypasses Firestore Security
Rules entirely — that's intentional: the `sessions` and `attendance`
collections are set to deny all client writes (see firestore.rules),
so this backend is the *only* thing that can ever create an
attendance record.
"""

import io
import os
import time
import urllib.parse
import uuid

import qrcode
import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

# ---------------------------------------------------------------
# Setup
# ---------------------------------------------------------------
app = Flask(__name__)

# Restrict cross-origin access to the frontend origin(s). Set
# ALLOWED_ORIGINS to a comma-separated list (e.g.
# "https://your-site.example.com,http://localhost:8000"); it defaults to
# localhost for development. Use "*" only if you knowingly want any origin.
_allowed = os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000")
CORS(app, origins="*" if _allowed.strip() == "*" else [o.strip() for o in _allowed.split(",") if o.strip()])

# PythonAnywhere (and most hosts) sit behind one reverse proxy, which
# is what actually lets us read the real client IP from X-Forwarded-For
# instead of the proxy's own IP.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

SERVICE_ACCOUNT_PATH = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "serviceAccountKey.json")
cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()

# Where a student lands after scanning a QR code. Update this once
# the frontend is deployed (GitHub Pages, Netlify, Firebase Hosting...).
FRONTEND_CHECKIN_URL = os.environ.get(
    "FRONTEND_CHECKIN_URL", "https://your-site.example.com/checkin.html"
)

SESSION_TTL_SECONDS = 60 * 60  # a session auto-expires 1 hour after it starts


def get_client_ip():
    """The real client IP, trusting exactly one layer of reverse proxy.

    ProxyFix(x_for=1) above rewrites request.remote_addr to the address the
    *single trusted* proxy reported, so we read that. We deliberately do NOT
    use request.access_route[0] — that's the left-most X-Forwarded-For entry,
    which the client fully controls and could set to the lecturer's IP to
    forge an on-network check-in.
    """
    return request.remote_addr


# ---------------------------------------------------------------
# Health check — hit this first after deploying to confirm it's up.
# ---------------------------------------------------------------
@app.get("/health")
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------
# What's my IP — the lecturer's browser calls this the moment a
# session starts, so we capture whatever WiFi they're on *right now*.
# ---------------------------------------------------------------
@app.get("/my-ip")
def my_ip():
    return jsonify({"ip": get_client_ip()})


# ---------------------------------------------------------------
# Start a session. The lecturer's frontend calls this instead of
# writing straight to Firestore — the registered IP has to be the
# one the SERVER saw, never one the client claims about itself.
# ---------------------------------------------------------------
@app.post("/session/start")
def start_session():
    data = request.get_json(force=True) or {}
    course_id = data.get("courseId")
    staff_id = data.get("staffId")
    if not course_id or not staff_id:
        return jsonify({"error": "missing-fields"}), 400

    session_id = uuid.uuid4().hex[:8]
    registered_ip = get_client_ip()

    db.collection("sessions").document(session_id).set({
        "sessionId": session_id,
        "courseId": course_id,
        "lecturerStaffId": staff_id,
        "registeredIp": registered_ip,
        "active": True,
        "startedAt": firestore.SERVER_TIMESTAMP,
        "expiresAt": time.time() + SESSION_TTL_SECONDS,
    })

    return jsonify({"sessionId": session_id, "registeredIp": registered_ip})


@app.post("/session/<session_id>/end")
def end_session(session_id):
    db.collection("sessions").document(session_id).update({"active": False})
    return jsonify({"ok": True})


# ---------------------------------------------------------------
# QR code for a session — a plain PNG. The frontend just does
# <img src="/qr/<sessionId>.png">, nothing computed on-device.
# ---------------------------------------------------------------
@app.get("/qr/<session_id>.png")
def session_qr(session_id):
    checkin_url = f"{FRONTEND_CHECKIN_URL}?session={session_id}"
    img = qrcode.make(checkin_url, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


# ---------------------------------------------------------------
# Attendance check-in — the one endpoint where the real security
# check happens: is this request coming from the lecturer's
# registered WiFi?
# ---------------------------------------------------------------
@app.post("/attendance/checkin")
def checkin():
    data = request.get_json(force=True) or {}
    session_id = data.get("sessionId")
    mat_no = data.get("matNo")
    if not session_id or not mat_no:
        return jsonify({"error": "missing-fields"}), 400

    session_ref = db.collection("sessions").document(session_id)
    session_doc = session_ref.get()
    if not session_doc.exists:
        return jsonify({"error": "session-not-found"}), 404

    session = session_doc.to_dict()
    if not session.get("active"):
        return jsonify({"error": "session-ended"}), 410
    if session.get("expiresAt", 0) < time.time():
        return jsonify({"error": "session-expired"}), 410

    # Matric numbers routinely contain slashes (e.g. DOU/SE/001), which
    # Firestore forbids in a document id — the frontend stores students
    # under encodeURIComponent(matNo), so mirror that here.
    mat_doc_id = urllib.parse.quote(mat_no, safe="")
    student_doc = db.collection("students").document(mat_doc_id).get()
    if not student_doc.exists:
        return jsonify({"error": "student-not-found"}), 404

    client_ip = get_client_ip()
    if client_ip != session.get("registeredIp"):
        return jsonify({
            "error": "wrong-network",
            "message": "Connect to the lecturer's WiFi network for this class, then try again.",
        }), 403

    attendance_id = f"{session_id}_{mat_doc_id}"
    attendance_ref = db.collection("attendance").document(attendance_id)
    if attendance_ref.get().exists:
        return jsonify({"error": "already-checked-in"}), 409

    student = student_doc.to_dict()
    attendance_ref.set({
        "sessionId": session_id,
        "courseId": session.get("courseId"),
        "matNo": mat_no,
        "studentName": student.get("fullName"),
        "status": "present",
        "checkedInIp": client_ip,
        "checkedInAt": firestore.SERVER_TIMESTAMP,
    })

    return jsonify({"ok": True})


if __name__ == "__main__":
    # Debug is OFF unless FLASK_DEBUG is truthy — never expose Werkzeug's
    # interactive debugger (an RCE vector) on a real deployment.
    debug = os.environ.get("FLASK_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")
    app.run(debug=debug, port=int(os.environ.get("PORT", 5000)))
