/* ==================================================================
   AttendPro — js/checkin.js
   Runs on checkin.html, where a student lands after scanning a
   session's QR code. Calls the Python backend directly — this page
   deliberately doesn't touch Firestore itself, since the whole point
   is that the backend verifies the request's real IP address.
=================================================================== */

const statusIcon = document.getElementById('statusIcon');
const statusTitle = document.getElementById('statusTitle');
const statusMessage = document.getElementById('statusMessage');
const matNoForm = document.getElementById('matNoForm');

function setStatus({ icon, title, message, color }) {
  statusIcon.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  statusIcon.style.color = color;
  statusTitle.textContent = title;
  statusMessage.textContent = message;
}

async function submitCheckin(sessionId, matNo) {
  try {
    const res = await fetch(`${API_BASE_URL}/attendance/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, matNo }),
    });
    const data = await res.json();

    if (res.ok) {
      setStatus({
        icon: 'fa-circle-check',
        title: "You're checked in!",
        message: 'Attendance recorded for this class.',
        color: 'var(--primary-green)',
      });
      return;
    }

    if (data.error === 'wrong-network') {
      setStatus({
        icon: 'fa-wifi',
        title: 'Wrong network',
        message: data.message || "Connect to the lecturer's WiFi and try again.",
        color: 'var(--primary-amber)',
      });
    } else if (data.error === 'already-checked-in') {
      setStatus({
        icon: 'fa-circle-check',
        title: 'Already checked in',
        message: "You've already been marked present for this session.",
        color: 'var(--primary-blue)',
      });
    } else if (data.error === 'session-expired' || data.error === 'session-ended') {
      setStatus({
        icon: 'fa-clock',
        title: 'Session closed',
        message: 'This attendance session is no longer open.',
        color: 'var(--primary-red)',
      });
    } else if (data.error === 'student-not-found') {
      setStatus({
        icon: 'fa-circle-xmark',
        title: 'Matric number not found',
        message: "That matric number isn't registered. Check it and try again.",
        color: 'var(--primary-red)',
      });
      matNoForm.hidden = false;
    } else {
      setStatus({
        icon: 'fa-triangle-exclamation',
        title: 'Something went wrong',
        message: 'Could not check you in. Try again in a moment.',
        color: 'var(--primary-red)',
      });
    }
  } catch (err) {
    console.error('Check-in request failed:', err);
    setStatus({
      icon: 'fa-triangle-exclamation',
      title: 'Connection problem',
      message: 'Could not reach the attendance server.',
      color: 'var(--primary-red)',
    });
  }
}

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session');

if (!sessionId) {
  setStatus({
    icon: 'fa-triangle-exclamation',
    title: 'Invalid link',
    message: 'This check-in link is missing a session — scan the QR code again.',
    color: 'var(--primary-red)',
  });
} else {
  const savedMatNo = sessionStorage.getItem('attendpro_matNo');
  if (savedMatNo) {
    submitCheckin(sessionId, savedMatNo);
  } else {
    // Not signed in on this device — ask for the matric number directly
    // rather than sending them through the full sign-in flow.
    setStatus({
      icon: 'fa-id-card',
      title: 'Enter your matric number',
      message: "We'll check your WiFi connection when you submit.",
      color: 'var(--primary-blue)',
    });
    matNoForm.hidden = false;
  }
}

matNoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const matNo = document.getElementById('matNo').value.trim();
  if (!matNo) return;
  matNoForm.hidden = true;
  setStatus({
    icon: 'fa-wifi',
    title: 'Checking you in...',
    message: "Make sure you're connected to the lecturer's WiFi for this class.",
    color: 'var(--primary-blue)',
  });
  submitCheckin(sessionId, matNo);
});
