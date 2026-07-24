/* ==================================================================
   AttendPro — js/student.js
   Fetches student data and binds it to the markup in
   student-dashboard.html via the shared helpers in js/common.js.
   Update the endpoint paths below to match your real backend.
=================================================================== */

/* Guard — only a matric number set by the sign-in flow (see
   js/auth.js) gets past this. Runs immediately, before the rest of
   the page loads. */
(function guardStudentSession() {
  if (!sessionStorage.getItem('attendpro_matNo')) {
    window.location.href = 'auth/student-signin.html';
  }
})();

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  sessionStorage.removeItem('attendpro_role');
  sessionStorage.removeItem('attendpro_matNo');
  window.location.href = 'auth/student-signin.html';
});

async function loadStudentDashboard() {
  setViewState({ loading: true, error: null });
  const matNo = sessionStorage.getItem('attendpro_matNo');
  console.log('Loading student dashboard for matNo:', matNo);
  try {
    const [profile, sessions, openSessions] = await Promise.all([
      dbGet('students', matDocId(matNo)),
      dbGetCollection('attendance', ref => ref.where('matNo', '==', matNo)),
      dbGetCollection('sessions', ref => ref.where('active', '==', true)),
    ]);

    console.log('Dashboard data loaded:', { profile, sessions, openSessions });
    if (!profile) throw new Error('profile-not-found');

    // Profile / topbar — real data from Firestore
    applyData(document, {
      userName: profile.fullName || 'Student',
      avatarUrl: profile.passportUrl || 'https://i.pravatar.cc/45',
      profileName: profile.fullName || '',
      profileMatricNo: profile.matNo || matNo,
      profileDepartment: profile.department || '',
      profileEmail: profile.email || '',
    });

    // Stats derived from attendance records
    const presentCount = sessions.filter(s => s.status === 'present').length;
    const absentCount = sessions.filter(s => s.status === 'absent').length;
    const lateCount = sessions.filter(s => s.status === 'late').length;
    const totalSessions = sessions.length;
    const attendanceRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

    applyData(document, {
      totalSessions,
      presentCount,
      absentCount,
      lateCount,
      attendanceRateLabel: `${attendanceRate}%`,
    });

    const fillEl = document.getElementById('rateFill');
    fillEl.style.width = `${attendanceRate}%`;
    fillEl.style.backgroundColor = attendanceRate >= 75 ? '#10B981' : attendanceRate >= 50 ? '#F59E0B' : '#EF4444';

    // Recent history (dashboard page, first 5) + full history (attendance page)
    renderRows({
      tbody: document.getElementById('recentHistoryBody'),
      template: document.getElementById('historyRowTemplate'),
      rows: sessions.slice(0, 5),
      emptyEl: document.getElementById('recentHistoryEmpty'),
    });
    renderRows({
      tbody: document.getElementById('attendanceHistoryBody'),
      template: document.getElementById('historyRowTemplate'),
      rows: sessions,
      emptyEl: document.getElementById('attendanceHistoryEmpty'),
    });

    // Open sessions — map the real session doc's fields onto what the row template expects
    const mappedOpenSessions = openSessions.map(s => ({
      className: s.courseId,
      lecturerName: s.lecturerStaffId,
      openedAt: s.startedAt?.toDate ? s.startedAt.toDate().toLocaleTimeString() : 'just now',
      sessionId: s.sessionId,
    }));
    renderRows({
      tbody: document.getElementById('openSessionsBody'),
      template: document.getElementById('openSessionRowTemplate'),
      rows: mappedOpenSessions,
      emptyEl: document.getElementById('openSessionsEmpty'),
    });
    document.querySelectorAll('#openSessionsBody [data-action="check-in"]').forEach((btn, i) => {
      btn.dataset.sessionId = mappedOpenSessions[i]?.sessionId;
    });

    // Explicitly hide error state and show dashboard using style.display
    console.log('Hiding loading state...');
    const loadingEl = document.getElementById('loadingState');
    if (loadingEl) {
      loadingEl.style.display = 'none';
      console.log('Loading state hidden');
    } else {
      console.log('Loading state element not found');
    }

    console.log('Hiding error state...');
    const errorEl = document.getElementById('errorState');
    if (errorEl) {
      errorEl.style.display = 'none';
      console.log('Error state hidden');
    } else {
      console.log('Error state element not found');
    }

    console.log('Showing dashboard root...');
    const rootEl = document.getElementById('dashboardRoot');
    if (rootEl) {
      rootEl.style.display = 'flex';
      console.log('Dashboard root shown');
    } else {
      console.log('Dashboard root element not found');
    }
  } catch (err) {
    console.error('Error loading student dashboard:', err);
    console.error('Error details:', err.message, err.code);
    setViewState({ loading: false, error: 'Failed to load dashboard data. Please try again.' });
  }
}

/* ------------------------------------------------------------------
   Row / page actions
-------------------------------------------------------------------*/
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="check-in"]');
  if (!btn) return;
  const sessionId = btn.dataset.sessionId;
  const matNo = sessionStorage.getItem('attendpro_matNo');

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Checking...';

  try {
    const res = await fetch(`${API_BASE_URL}/attendance/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, matNo }),
    });
    const data = await res.json();

    if (res.ok) {
      btn.textContent = 'Checked in';
      loadStudentDashboard();
      return;
    }

    if (data.error === 'wrong-network') {
      alert(data.message || "Connect to the lecturer's WiFi for this class and try again.");
    } else if (data.error === 'already-checked-in') {
      btn.textContent = 'Checked in';
      return;
    } else {
      alert('Could not check you in. Try again in a moment.');
    }
    btn.disabled = false;
    btn.textContent = originalLabel;
  } catch (err) {
    console.error('Check-in failed:', err);
    alert('Could not reach the attendance server.');
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

document.getElementById('joinClassBtn')?.addEventListener('click', () => {
  console.log('TODO: open "join class with code" form and POST to /student/classes/join');
});

document.getElementById('retryBtn')?.addEventListener('click', loadStudentDashboard);

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  loadStudentDashboard();
});
