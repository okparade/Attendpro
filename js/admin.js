/* ==================================================================
   AttendPro — js/admin.js
   Fetches admin data and binds it to the markup in
   admin-dashboard.html via the shared helpers in js/common.js.
   Update the endpoint paths below to match your real backend.
=================================================================== */

async function loadAdminDashboard() {
  setViewState({ loading: true, error: null });
  try {
    const [students, lecturers, attendance, sessions, courses] = await Promise.all([
      dbGetCollection('students'),
      dbGetCollection('lecturers'),
      dbGetCollection('attendance'),
      dbGetCollection('sessions'),
      // Tolerate a missing courses rule so the rest of the dashboard still
      // loads if firestore.rules hasn't been (re)published yet.
      dbGetCollection('courses').catch(err => {
        console.warn('Could not read courses — did you publish the updated firestore.rules?', err);
        return [];
      }),
    ]);

    // Calculate stats from actual data
    const totalStudents = students.length;
    const presentToday = attendance.filter(a => a.status === 'present').length;
    const absentToday = attendance.filter(a => a.status === 'absent').length;
    const attendanceRate = totalStudents > 0 ? Math.round((presentToday / totalStudents) * 100) : 0;
    const sessionsToday = sessions.filter(s => {
      if (!s.startedAt) return false;
      const sessionDate = s.startedAt.toDate ? s.startedAt.toDate() : new Date(s.startedAt);
      const today = new Date();
      return sessionDate.toDateString() === today.toDateString();
    }).length;

    // Profile
    applyData(document, {
      userName: 'Administrator',
      avatarUrl: 'https://i.pravatar.cc/45',
    });

    // Dashboard + Attendance page stat cards (same data-field names, both pages update)
    applyData(document, {
      totalStudents,
      presentToday,
      absentToday,
      attendanceRate: `${attendanceRate}%`,
      sessionsToday,
    });

    // Recent attendance table (dashboard page) - map attendance records to template format
    const recentAttendance = attendance.slice(0, 5).map(a => ({
      studentName: a.studentName || 'Unknown',
      courseName: a.courseName || 'Unknown',
      date: a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate().toLocaleDateString() : new Date(a.timestamp).toLocaleDateString()) : 'Unknown',
      status: a.status || 'unknown',
    }));
    renderRows({
      tbody: document.getElementById('recentAttendanceBody'),
      template: document.getElementById('attendanceRowTemplate'),
      rows: recentAttendance,
      emptyEl: document.getElementById('recentAttendanceEmpty'),
    });

    // Students table - map student records to template format
    const studentRows = students.map(s => ({
      id: s.matNo,
      matricNo: s.matNo,
      name: s.fullName,
      department: s.department || 'N/A',
      level: s.level || 'N/A',
      status: 'active',
    }));
    renderRows({
      tbody: document.getElementById('studentsBody'),
      template: document.getElementById('studentRowTemplate'),
      rows: studentRows,
      emptyEl: document.getElementById('studentsEmpty'),
    });

    // Lecturers table - map lecturer records to template format
    const lecturerRows = lecturers.map(l => ({
      id: l.staffId,
      lecturerId: l.staffId,
      name: l.fullName,
      email: l.email,
      department: l.department || 'N/A',
    }));
    renderRows({
      tbody: document.getElementById('lecturersBody'),
      template: document.getElementById('lecturerRowTemplate'),
      rows: lecturerRows,
      emptyEl: document.getElementById('lecturersEmpty'),
    });

    // Courses table
    const lecturerNameById = Object.fromEntries(lecturers.map(l => [l.staffId, l.fullName]));
    const courseRows = courses.map(c => ({
      code: c.courseId,
      title: c.title,
      department: c.department || 'N/A',
      lecturerName: lecturerNameById[c.lecturerStaffId] || c.lecturerStaffId || 'Unassigned',
    }));
    renderRows({
      tbody: document.getElementById('coursesBody'),
      template: document.getElementById('courseRowTemplate'),
      rows: courseRows,
      emptyEl: document.getElementById('coursesEmpty'),
    });

    // Populate the "Create a Course" lecturer picker
    const lecturerSelect = document.getElementById('courseLecturer');
    if (lecturerSelect) {
      const chosen = lecturerSelect.value;
      lecturerSelect.innerHTML = '<option value="">Select a lecturer</option>';
      lecturers.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.staffId;
        opt.textContent = `${l.fullName || l.staffId} (${l.staffId})`;
        lecturerSelect.appendChild(opt);
      });
      lecturerSelect.value = chosen;
    }

    // Reports page
    applyData(document, {
      overallAttendanceRate: `${attendanceRate}%`,
    });

    // Explicitly hide loading/error states
    document.getElementById('loadingState').hidden = true;
    document.getElementById('errorState').hidden = true;
    document.getElementById('dashboardRoot').hidden = false;
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    setViewState({ loading: false, error: 'Failed to load dashboard data. Please try again.' });
  }
}

/* ------------------------------------------------------------------
   Row actions — edit / delete buttons carry the record id in their
   data-field attribute (see the <template>s in admin-dashboard.html).
   Wire these up to your real endpoints.
-------------------------------------------------------------------*/
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  // Row-action buttons carry the record id in data-id (set by applyData
  // from the row's data-field="id"), not in the literal data-field value.
  const id = btn.dataset.id;

  switch (action) {
    case 'create-course': {
      const courseMenuItem = document.querySelector('.menu-item[data-page="courses"] a');
      courseMenuItem?.click();
      document.getElementById('courseCode')?.focus();
      break;
    }
    case 'add-student':
    case 'mark-attendance':
    case 'generate-report':
    case 'download-report':
      console.log(`TODO: wire "${action}" up to your backend`);
      break;
    case 'add-lecturer':
      document.getElementById('allowlistStaffId')?.focus();
      break;
    case 'edit-student':
    case 'edit-lecturer':
      console.log(`TODO: open edit form for record ${id}`);
      break;
    case 'delete-student':
      apiSend(`/admin/students/${id}`, 'DELETE').then(loadAdminDashboard).catch(console.error);
      break;
    case 'delete-lecturer':
      apiSend(`/admin/lecturers/${id}`, 'DELETE').then(loadAdminDashboard).catch(console.error);
      break;
  }
});

document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
  const systemName = document.getElementById('systemName').value;
  const institutionName = document.getElementById('institutionName').value;
  apiSend('/admin/settings', 'PUT', { systemName, institutionName }).catch(console.error);
});

/* ------------------------------------------------------------------
   Pre-approve a lecturer — writes directly to Firestore
   (lecturerAllowlist/{staffId}). A lecturer can only complete
   signup once their Staff ID + email exist here (see js/auth.js).
-------------------------------------------------------------------*/
document.getElementById('allowlistForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertEl = document.getElementById('allowlistAlert');
  const btn = document.getElementById('allowlistSubmitBtn');
  const staffId = document.getElementById('allowlistStaffId').value.trim();
  const email = document.getElementById('allowlistEmail').value.trim();

  btn.disabled = true;
  try {
    await dbSet('lecturerAllowlist', staffId, {
      email,
      addedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    alertEl.textContent = `${staffId} approved — they can now sign up with that email.`;
    alertEl.className = 'form-alert success';
    alertEl.hidden = false;
    e.target.reset();
  } catch (err) {
    console.error('Error adding to allowlist:', err);
    alertEl.textContent = 'Could not add that Staff ID. Try again.';
    alertEl.className = 'form-alert';
    alertEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------------
   Create a course — writes directly to Firestore (courses/{code}).
   The assigned lecturer then sees it in their session course picker
   (see js/lecturer.js), which is what lets them start attendance.
-------------------------------------------------------------------*/
document.getElementById('courseForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertEl = document.getElementById('courseAlert');
  const btn = document.getElementById('courseSubmitBtn');
  const code = document.getElementById('courseCode').value.trim();
  const title = document.getElementById('courseTitle').value.trim();
  const department = document.getElementById('courseDepartment').value.trim();
  const lecturerStaffId = document.getElementById('courseLecturer').value;

  btn.disabled = true;
  try {
    const existing = await dbGet('courses', code);
    if (existing) throw new Error('already-exists');

    await dbSet('courses', code, {
      courseId: code,
      title,
      department,
      lecturerStaffId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    alertEl.textContent = `${code} created and assigned.`;
    alertEl.className = 'form-alert success';
    alertEl.hidden = false;
    e.target.reset();
    loadAdminDashboard();
  } catch (err) {
    console.error('Error creating course:', err);
    alertEl.textContent = err.message === 'already-exists'
      ? 'A course with that code already exists.'
      : 'Could not create that course. Try again.';
    alertEl.className = 'form-alert';
    alertEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* NOTE: the admin dashboard has no sign-in of its own yet, so this
   just returns to the landing page rather than clearing a session. */
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  window.location.href = 'index.html';
});

document.getElementById('retryBtn')?.addEventListener('click', loadAdminDashboard);

document.addEventListener('DOMContentLoaded', () => {
  initSidebarNav();
  loadAdminDashboard();
});
