/* ==================================================================
   AttendPro — common.js
   Shared functionality for every dashboard (admin / lecturer /
   student). Page-specific data fetching lives in js/admin.js,
   js/lecturer.js and js/student.js — they call the helpers below.
=================================================================== */

const API_BASE = '/api';

/* ------------------------------------------------------------------
   Generic fetch wrapper
-------------------------------------------------------------------*/
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

async function apiSend(path, method, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

/* Same as apiSend, but for requests that include a file (e.g. passport
   photograph on signup) — sends multipart/form-data instead of JSON. */
async function apiSendForm(path, method, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

/* ==================================================================
   FIRESTORE HELPERS
   Requires js/firebase-config.js to be loaded first (defines the
   global `db` / `auth` objects). Used by js/auth.js and the admin
   "pre-approve a lecturer" form. The rest of the dashboards (stats,
   tables) still use the REST helpers above for now.
-------------------------------------------------------------------*/
async function dbGet(collection, id) {
  const snap = await db.collection(collection).doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function dbGetCollection(collection, queryFn) {
  let ref = db.collection(collection);
  if (queryFn) ref = queryFn(ref);
  const snap = await ref.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function dbSet(collection, id, data) {
  return db.collection(collection).doc(id).set(data);
}

async function dbUpdate(collection, id, data) {
  return db.collection(collection).doc(id).update(data);
}

async function dbDelete(collection, id) {
  return db.collection(collection).doc(id).delete();
}

/* ------------------------------------------------------------------
   Image compression — resizes + re-encodes a passport photo client
   side so it's small enough to store as a base64 string directly on
   the Firestore document (well under the 1MB document limit).
-------------------------------------------------------------------*/
function compressImageToBase64(file, { maxSize = 300, quality = 0.7 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------
   One-time code helpers (student sign-in)
-------------------------------------------------------------------*/
function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(name.length - visible.length, 2))}@${domain}`;
}

/* ------------------------------------------------------------------
   Matric number → Firestore document id. Matric numbers routinely
   contain slashes (e.g. DOU/SE/001), which Firestore forbids in a
   document id, so percent-encode them. The raw matNo is still stored
   as a field on the document. The Python backend uses the equivalent
   urllib.parse.quote(mat_no, safe='') so both sides agree on the id.
-------------------------------------------------------------------*/
function matDocId(matNo) {
  return encodeURIComponent(String(matNo).trim());
}

/* ------------------------------------------------------------------
   Sidebar navigation — toggles .active on the menu item and
   .active-page on the matching <section class="page" id="...">.
   Every dashboard uses the same markup:
     <li class="menu-item" data-page="courses"><a>...</a></li>
     <section id="courses" class="page">...</section>
-------------------------------------------------------------------*/
function initSidebarNav() {
  const menuItems = document.querySelectorAll('.menu-item[data-page]');
  const pages = document.querySelectorAll('.page[id]');
  const pageTitle = document.querySelector('.topbar .page-title');

  function activate(pageId) {
    menuItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });
    pages.forEach(section => {
      section.classList.toggle('active-page', section.id === pageId);
    });
    if (pageTitle) {
      const activeItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
      if (activeItem) pageTitle.textContent = activeItem.dataset.title || activeItem.textContent.trim();
    }
    window.location.hash = pageId;
  }

  menuItems.forEach(item => {
    item.querySelector('a')?.addEventListener('click', (e) => {
      e.preventDefault();
      activate(item.dataset.page);
    });
  });

  const initial = window.location.hash.replace('#', '') || menuItems[0]?.dataset.page;
  if (initial) activate(initial);
}

/* ------------------------------------------------------------------
   Data binding — fills every [data-field="key"] element found
   inside `scope` with the matching value from `data`.
   Works on <span>, <img> (sets src), and <input>/<select> (sets value).
   This is the piece that makes backend/database wiring simple:
   just call applyData(sectionEl, { totalStudents: 2460, ... }).
-------------------------------------------------------------------*/
function applyData(scope, data) {
  Object.entries(data).forEach(([key, value]) => {
    scope.querySelectorAll(`[data-field="${key}"]`).forEach(node => {
      if (node.tagName === 'IMG') {
        node.src = value;
      } else if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
        node.value = value;
      } else if (node.tagName === 'BUTTON' || node.tagName === 'A') {
        // Action buttons/links carry a record id (e.g. data-field="id"),
        // not display text — stash it in a data-* attribute so we don't
        // clobber the visible "Edit"/"Delete"/"Check In" label. Read it
        // back as node.dataset[key].
        node.dataset[key] = value;
      } else {
        node.textContent = value;
      }
    });
  });
}

/* ------------------------------------------------------------------
   Status badge — sets the class + label on a .status-badge span.
   status: 'present' | 'absent' | 'late' | 'active' | 'inactive'
-------------------------------------------------------------------*/
function setStatusBadge(node, status) {
  node.className = `status-badge status-${status || 'inactive'}`;
  node.textContent = status || '';
}

/* ------------------------------------------------------------------
   Table rows — clones a <template>, fills its [data-field] spans
   via applyData, sets any .status-badge, and appends to tbody.
   Usage:
     renderRows({
       tbody: document.querySelector('#recentAttendanceBody'),
       template: document.querySelector('#attendanceRowTemplate'),
       rows: sessions,
       emptyEl: document.querySelector('#recentAttendanceEmpty'),
     });
-------------------------------------------------------------------*/
function renderRows({ tbody, template, rows, emptyEl }) {
  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    tbody.closest('table').hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  tbody.closest('table').hidden = false;
  if (emptyEl) emptyEl.hidden = true;

  rows.forEach(row => {
    const node = template.content.cloneNode(true);
    const rootRow = node.querySelector('tr');
    applyData(rootRow, row);
    const badge = rootRow.querySelector('.status-badge');
    if (badge) setStatusBadge(badge, row.status);
    tbody.appendChild(node);
  });
}

/* ------------------------------------------------------------------
   View state — toggles the shared loading / error / content blocks.
   Every dashboard page has:
     #loadingState, #errorState (#errorMessage, #retryBtn), #dashboardRoot
-------------------------------------------------------------------*/
function setViewState({ loading, error }) {
  const loadingEl = document.getElementById('loadingState');
  const errorEl = document.getElementById('errorState');
  const rootEl = document.getElementById('dashboardRoot');
  const errorMsgEl = document.getElementById('errorMessage');

  if (loadingEl) loadingEl.hidden = !loading;
  if (errorEl) errorEl.hidden = !(!loading && error);
  if (rootEl) rootEl.hidden = !(!loading && !error);
  if (error && errorMsgEl) errorMsgEl.textContent = error;
}
