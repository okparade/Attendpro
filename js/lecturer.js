/* ==================================================================
   AttendPro — js/lecturer.js
   Fetches lecturer data and binds it to the markup in
   lecturer-dashboard.html via the shared helpers in js/common.js.
   Update the endpoint paths below to match your real backend.
=================================================================== */

/* Guard — only signed-in lecturers (Firebase Auth) can see this
   page. Runs immediately, before the rest of the page loads. */
let authInitialized = false;
auth.onAuthStateChanged((user) => {
  authInitialized = true;
  console.log('Auth state changed, user:', user ? user.email : 'none');
  if (!user) {
    window.location.href = 'auth/lecturer-signin.html';
  } else {
    // Load dashboard once auth is confirmed
    loadLecturerDashboard();
  }
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  auth.signOut().then(() => {
    window.location.href = 'auth/lecturer-signin.html';
  });
});

/* startedAt may be a Firestore Timestamp or a raw value — normalise to
   epoch millis for sorting (0 if missing). */
function sessionMillis(session) {
  const t = session.startedAt;
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  return new Date(t).getTime();
}

async function loadLecturerDashboard() {
  setViewState({ loading: true, error: null });
  try {
    const lecturer = await getCurrentLecturer();
    if (!lecturer) throw new Error('lecturer-not-found');

    const [students, attendance, sessions, courses] = await Promise.all([
      dbGetCollection('students'),
      dbGetCollection('attendance'),
      dbGetCollection('sessions'),
      // Tolerate a missing courses rule so the rest of the dashboard still
      // loads if firestore.rules hasn't been (re)published yet.
      dbGetCollection('courses', ref => ref.where('lecturerStaffId', '==', lecturer.staffId)).catch(err => {
        console.warn('Could not read courses — did you publish the updated firestore.rules?', err);
        return [];
      }),
    ]);

    // Calculate stats from actual data. Attendance records don't carry the
    // lecturer id — only the session does — so link attendance to this
    // lecturer through the sessions they started.
    const totalStudents = students.length;
    const mySessions = sessions.filter(s => s.lecturerStaffId === lecturer.staffId);
    const mySessionIds = new Set(mySessions.map(s => s.sessionId));
    const lecturerAttendance = attendance.filter(a => mySessionIds.has(a.sessionId));
    const presentCount = lecturerAttendance.filter(a => a.status === 'present').length;
    const attendanceRate = lecturerAttendance.length > 0 ? Math.round((presentCount / lecturerAttendance.length) * 100) : 0;
    const todaysClasses = sessions.filter(s => {
      if (!s.startedAt || s.lecturerStaffId !== lecturer.staffId) return false;
      const sessionDate = s.startedAt.toDate ? s.startedAt.toDate() : new Date(s.startedAt);
      const today = new Date();
      return sessionDate.toDateString() === today.toDateString();
    }).length;

    // Profile / topbar
    applyData(document, {
      userName: lecturer.fullName || 'Lecturer',
      avatarUrl: lecturer.passportUrl || 'https://i.pravatar.cc/45',
      profileName: lecturer.fullName || '',
      profileDepartment: lecturer.department || '',
      profileEmail: lecturer.email || '',
    });

    // Dashboard stat cards
    applyData(document, {
      totalCourses: courses.length,
      totalStudents,
      todaysClasses,
      attendanceRate: `${attendanceRate}%`,
    });

    // My Courses table
    renderRows({
      tbody: document.getElementById('coursesBody'),
      template: document.getElementById('courseRowTemplate'),
      rows: courses.map(c => ({
        code: c.courseId,
        title: c.title,
        studentCount: totalStudents,
      })),
      emptyEl: document.getElementById('coursesEmpty'),
    });

    // Attendance session page — course picker
    const courseSelect = document.getElementById('sessionCourse');
    if (courseSelect) {
      courseSelect.innerHTML = '';
      if (courses.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No courses assigned — ask your admin';
        courseSelect.appendChild(opt);
      } else {
        courses.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.courseId;
          opt.textContent = c.title ? `${c.courseId} — ${c.title}` : c.courseId;
          courseSelect.appendChild(opt);
        });
      }
    }

    // Attendance history table — one row per session this lecturer ran,
    // aggregating its per-student check-ins. Only "present" records exist
    // (a check-in), so absent is the rest of the student body.
    const historyRows = mySessions
      .slice()
      .sort((a, b) => sessionMillis(b) - sessionMillis(a))
      .map(s => {
        const present = attendance.filter(a => a.sessionId === s.sessionId && a.status === 'present').length;
        const started = s.startedAt;
        return {
          date: started ? (started.toDate ? started.toDate().toLocaleDateString() : new Date(started).toLocaleDateString()) : 'Unknown',
          courseCode: s.courseId || 'Unknown',
          presentCount: present,
          absentCount: Math.max(totalStudents - present, 0),
        };
      });
    renderRows({
      tbody: document.getElementById('historyBody'),
      template: document.getElementById('historyRowTemplate'),
      rows: historyRows,
      emptyEl: document.getElementById('historyEmpty'),
    });

    // Reports page
    applyData(document, {
      overallAttendanceRate: `${attendanceRate}%`,
    });

    // Explicitly hide loading/error states
    document.getElementById('loadingState').hidden = true;
    document.getElementById('errorState').hidden = true;
    document.getElementById('dashboardRoot').hidden = false;
  } catch (err) {
    console.error('Error loading lecturer dashboard:', err);
    setViewState({ loading: false, error: 'Failed to load dashboard data. Please try again.' });
  }
}

/* ------------------------------------------------------------------
   Attendance session controls
   Starting/ending a session and checking the real WiFi IP happens on
   the Python backend (see /backend/app.py) — the browser can't be
   trusted to report its own IP address. The live feed reads
   `attendance` straight from Firestore, since that's just a read.
-------------------------------------------------------------------*/
let activeSessionId = null;
let liveFeedTimer = null;
let currentLecturer = null;

async function getCurrentLecturer() {
  if (currentLecturer) return currentLecturer;
  const user = auth.currentUser;
  if (!user) {
    console.log('No Firebase Auth user found');
    return null;
  }
  console.log('Looking for lecturer with authUid:', user.uid);
  const matches = await dbGetCollection('lecturers', ref => ref.where('authUid', '==', user.uid).limit(1));
  console.log('Found lecturer matches:', matches);
  currentLecturer = matches[0] || null;
  if (!currentLecturer) {
    console.log('No lecturer found with authUid:', user.uid);
    // Try to get all lecturers to debug
    const allLecturers = await dbGetCollection('lecturers');
    console.log('All lecturers in database:', allLecturers);
  }
  return currentLecturer;
}

document.getElementById('startSessionBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('startSessionBtn');
  const statusEl = document.getElementById('sessionStatus');
  const courseId = document.getElementById('sessionCourse').value;

  if (!courseId) {
    statusEl.textContent = 'Select a course first.';
    statusEl.hidden = false;
    return;
  }

  btn.disabled = true;
  try {
    const lecturer = await getCurrentLecturer();
    if (!lecturer) throw new Error('lecturer-not-found');

    const res = await fetch(`${API_BASE_URL}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, staffId: lecturer.staffId }),
    });
    if (!res.ok) throw new Error('start-failed');
    const { sessionId, registeredIp } = await res.json();

    activeSessionId = sessionId;
    document.getElementById('qrImage').src = `${API_BASE_URL}/qr/${sessionId}.png`;
    document.getElementById('qrWrap').hidden = false;
    statusEl.textContent = `Session live — students must be on the WiFi at ${registeredIp}.`;
    statusEl.hidden = false;

    document.getElementById('endSessionBtn').disabled = false;
    btn.disabled = true;

    pollLiveFeed();
  } catch (err) {
    console.error('Error starting session:', err);
    statusEl.textContent = 'Could not start the session — check your connection and try again.';
    statusEl.hidden = false;
    btn.disabled = false;
  }
});

document.getElementById('endSessionBtn')?.addEventListener('click', async () => {
  if (!activeSessionId) return;
  const btn = document.getElementById('endSessionBtn');
  btn.disabled = true;
  try {
    await fetch(`${API_BASE_URL}/session/${activeSessionId}/end`, { method: 'POST' });
  } catch (err) {
    console.error('Error ending session:', err);
  } finally {
    activeSessionId = null;
    clearTimeout(liveFeedTimer);
    document.getElementById('qrWrap').hidden = true;
    document.getElementById('sessionStatus').textContent = 'Session ended.';
    document.getElementById('startSessionBtn').disabled = false;
  }
});

async function pollLiveFeed() {
  if (!activeSessionId) return;
  try {
    const feed = await dbGetCollection('attendance', ref => ref.where('sessionId', '==', activeSessionId));
    renderRows({
      tbody: document.getElementById('liveFeedBody'),
      template: document.getElementById('liveFeedRowTemplate'),
      rows: feed.map(r => ({
        studentName: r.studentName,
        time: r.checkedInAt?.toDate ? r.checkedInAt.toDate().toLocaleTimeString() : '',
        status: r.status,
      })),
      emptyEl: document.getElementById('liveFeedEmpty'),
    });
  } catch (err) {
    console.error('Error polling live feed:', err);
  }
  if (activeSessionId) liveFeedTimer = setTimeout(pollLiveFeed, 5000);
}

document.getElementById('exportReportBtn')?.addEventListener('click', () => {
  console.log('TODO: wire "export report" up to your backend');
});

document.getElementById('retryBtn')?.addEventListener('click', loadLecturerDashboard);

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  // Dashboard will load when auth state is confirmed
  if (authInitialized && auth.currentUser) {
    loadLecturerDashboard();
  }
});
