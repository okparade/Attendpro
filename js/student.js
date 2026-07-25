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
  try {
const [profile, sessions, openSessions, enrollments] = await Promise.all([
  dbGet('students', matDocId(matNo)),

  dbGetCollection('attendance', ref =>
    ref.where('matNo', '==', matNo)
  ),

  dbGetCollection('sessions', ref =>
    ref.where('active', '==', true)
  ),

  dbGetCollection('enrollments', ref =>
    ref.where('matNo', '==', matNo)
  )
]);
    if (!profile) throw new Error('profile-not-found');



const myCourses = [];

for (const enrollment of enrollments) {

    const course = await dbGet("courses", enrollment.courseId);

    if (course) {

        myCourses.push({

            code: course.courseId,
            title: course.title,
            department: course.department,
            lecturer: course.lecturerStaffId

        });

    }

}

renderRows({

    tbody: document.getElementById("myClassesBody"),
    template: document.getElementById("myClassRowTemplate"),
    rows: myCourses,
    emptyEl: document.getElementById("myClassesEmpty")

});

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
      loadingEl.hidden = true;
      console.log('Loading state hidden');
    } else {
      console.log('Loading state element not found');
    }

    console.log('Hiding error state...');
    const errorEl = document.getElementById('errorState');
    if (errorEl) {
      errorEl.hidden = true;
      console.log('Error state hidden');
    } else {
      console.log('Error state element not found');
    }

    console.log('Showing dashboard root...');
    const rootEl = document.getElementById('dashboardRoot');
    if (rootEl) {
      rootEl.hidden = false;
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

/* ==========================================================
   JOIN COURSE MODAL
========================================================== */

const joinModal = document.getElementById("joinCourseModal");
const joinBtn = document.getElementById("joinClassBtn");
const closeJoinModal = document.getElementById("closeJoinModal");

joinBtn?.addEventListener("click", () => {
    document.getElementById("joinCourseMessage").hidden = true;
    joinModal.hidden = false;
});

closeJoinModal?.addEventListener("click", () => {
    joinModal.hidden = true;
});

joinModal?.addEventListener("click", (e) => {
    if (e.target === joinModal) {
        joinModal.hidden = true;
    }
});


/* ==========================================================
   JOIN COURSE
========================================================== */

document.getElementById("joinCourseForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = document.getElementById("joinCourseMessage");
    const submitBtn = document.getElementById("joinCourseSubmit");

    message.hidden = true;
    submitBtn.disabled = true;

    try {

        const matNo = sessionStorage.getItem("attendpro_matNo");

        if (!matNo) {
            throw new Error("Student not logged in.");
        }

        const courseCode = document
            .getElementById("courseCodeInput")
            .value
            .trim()
            .replace(/\s+/g, " ")
            .toUpperCase();

        // Check course exists
        const course = await dbGet("courses", courseCode);

        if (!course) {
            throw new Error("Course not found.");
        }

        // Enrollment document id
        const enrollmentId = `${matNo}_${courseCode}`;

        // Check if already enrolled
        const existing = await dbGet("enrollments", enrollmentId);

        if (existing) {
            throw new Error("You have already joined this course.");
        }

        // Save enrollment
        await dbSet("enrollments", enrollmentId, {

            matNo: matNo,
            courseId: courseCode,
            studentName: sessionStorage.getItem("attendpro_name") || "",

            enrolledAt: firebase.firestore.FieldValue.serverTimestamp()

        });

        message.className = "form-alert success";
        message.textContent = "Course joined successfully!";
        message.hidden = false;

        // Close modal
        joinModal.hidden = true;

        // Clear form
        document.getElementById("joinCourseForm").reset();

        // Reload dashboard
        await loadStudentDashboard();

    } catch (err) {

        console.error(err);

        message.className = "form-alert";
        message.textContent = err.message || "Failed to join course.";
        message.hidden = false;

    } finally {

        submitBtn.disabled = false;

    }
});

document.getElementById('retryBtn')?.addEventListener('click', loadStudentDashboard);

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  loadStudentDashboard();
});
