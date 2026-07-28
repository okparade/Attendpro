/* ==================================================================
   AttendPro — js/auth.js
   Shared functionality for every sign-in / sign-up page, now backed
   by Firebase (Firestore + Auth) and EmailJS instead of a REST API.
   Requires firebase-config.js loaded first. Every block below is
   guarded with `?.` so it's a no-op on pages missing that element.

   Collections used:
     students/{matNo}            — fullName, firstName, lastName,
                                    middleName, email, passportUrl
                                    (base64 data URI), authUid,
                                    registeredAt
     otps/{matNo}                 — code, expiresAt (short-lived)
     lecturerAllowlist/{staffId}  — email (added by admin, see js/admin.js)
     lecturers/{staffId}          — same shape as students + staffId,
                                     authUid (Firebase Auth uid)
=================================================================== */

function showAlert(message, type = 'error') {
  const el = document.getElementById('formAlert');
  if (!el) return;
  el.textContent = message;
  el.className = `form-alert${type === 'success' ? ' success' : ''}`;
  el.hidden = false;
}

function hideAlert() {
  const el = document.getElementById('formAlert');
  if (el) el.hidden = true;
}

function setSubmitting(btn, isSubmitting, idleLabel) {
  if (!btn) return;
  btn.disabled = isSubmitting;
  btn.textContent = isSubmitting ? 'Please wait...' : idleLabel;
}

/* ------------------------------------------------------------------
   Passport photo preview
-------------------------------------------------------------------*/
const photoInput = document.getElementById('passportPhoto');
const photoPreview = document.getElementById('photoPreview');
photoInput?.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    photoPreview.innerHTML = `<img src="${reader.result}" alt="Passport preview">`;
  };
  reader.readAsDataURL(file);
});

/* ------------------------------------------------------------------
   Password show/hide toggles
-------------------------------------------------------------------*/
document.querySelectorAll('.password-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.toggleFor);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = isHidden ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  });
});

/* ------------------------------------------------------------------
   STUDENT SIGN UP
   Writes directly to students/{matNo}. The passport photo is
   compressed client-side and stored as a base64 data URI in the
   same `passportUrl` field your existing records use — an <img src>
   doesn't care whether that string is a URL or a data URI, so
   nothing else needs to special-case it.
-------------------------------------------------------------------*/
const studentSignupForm = document.getElementById('studentSignupForm');
studentSignupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const btn = document.getElementById('submitBtn');
  setSubmitting(btn, true, 'Create Account');

  try {
    const lastName = document.getElementById('lastName').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const matNo = document.getElementById('matNo').value.trim();
    const email = document.getElementById('email').value.trim();
    const photoFile = document.getElementById('passportPhoto').files[0];

    if (!matNo) throw new Error('missing-matno');
    if (!photoFile) throw new Error('missing-photo');

    const existing = await dbGet('students', matDocId(matNo));
    if (existing) throw new Error('already-exists');

    const passportUrl = await compressImageToBase64(photoFile, { maxSize: 300, quality: 0.7 });

    await dbSet('students', matDocId(matNo), {
      matNo,
      firstName,
      lastName,
      middleName,
      fullName: [firstName, middleName, lastName].filter(Boolean).join(' '),
      email,
      passportUrl,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    showAlert('Account created! Redirecting to sign in...', 'success');
    setTimeout(() => { window.location.href = 'student-signin.html'; }, 1200);
  } catch (err) {
    console.error('Student signup failed:', err);
    if (err.message === 'already-exists') {
      showAlert('An account already exists for that matric number. Try signing in instead.');
    } else {
      showAlert('Could not create your account. Check your details and try again.');
    }
  } finally {
    setSubmitting(btn, false, 'Create Account');
  }
});

/* ------------------------------------------------------------------
   STUDENT SIGN IN — step 1: request code, step 2: verify code
-------------------------------------------------------------------*/
const matNoForm = document.getElementById('matNoForm');
const otpForm = document.getElementById('otpForm');
let resendTimerId = null;

function startResendTimer(seconds = 30) {
  const resendBtn = document.getElementById('resendBtn');
  const resendTimer = document.getElementById('resendTimer');
  let remaining = seconds;
  resendBtn.disabled = true;
  clearInterval(resendTimerId);
  resendTimerId = setInterval(() => {
    remaining -= 1;
    resendTimer.textContent = `Resend code in ${remaining}s`;
    if (remaining <= 0) {
      clearInterval(resendTimerId);
      resendTimer.textContent = "Didn't get a code?";
      resendBtn.disabled = false;
    }
  }, 1000);
}

async function requestStudentCode() {
  hideAlert();
  const matNo = document.getElementById('matNo').value.trim();
  if (!matNo) return;

  const btn = document.getElementById('sendCodeBtn');
  setSubmitting(btn, true, 'Send Sign-in Code');
  try {
    console.log('Looking up student with matNo:', matNo);
    const student = await dbGet('students', matDocId(matNo));
    console.log('Student found:', student);
    if (!student) throw new Error('not-found');
    if (!student.email) throw new Error('no-email');

    const code = generateOtpCode();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    console.log('Generated OTP code:', code);
    console.log('Creating OTP in database...');
    await dbSet('otps', matDocId(matNo), {
      code,
      expiresAt,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    console.log('Sending email via EmailJS to:', student.email);
    console.log('EmailJS template variables:', {
      [EMAILJS_TO_EMAIL_VAR]: student.email,
      [EMAILJS_TO_NAME_VAR]: student.fullName || student.firstName || 'Student',
      [EMAILJS_OTP_VAR]: code,
    });
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_OTP_TEMPLATE_ID, {
      [EMAILJS_TO_EMAIL_VAR]: student.email,
      [EMAILJS_TO_NAME_VAR]: student.fullName || student.firstName || 'Student',
      [EMAILJS_OTP_VAR]: code,
    });

    matNoForm.hidden = true;
    otpForm.hidden = false;
    document.getElementById('signinSubtitle').textContent = 'Enter the 6-digit code we sent you.';
    applyData(document, { maskedEmail: maskEmail(student.email) });
    otpForm.querySelector('.otp-digit')?.focus();
    startResendTimer(30);
  } catch (err) {
    console.error('Error requesting sign-in code:', err);
    if (err.message === 'not-found') {
      showAlert("We couldn't find that matric number. Check it and try again.");
    } else if (err.message === 'no-email') {
      showAlert("We don't have an email on file for that matric number yet — contact your admin.");
    } else {
      showAlert('Could not send the sign-in code. Please try again.');
    }
  } finally {
    setSubmitting(btn, false, 'Send Sign-in Code');
  }
}

matNoForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  requestStudentCode();
});

document.getElementById('resendBtn')?.addEventListener('click', requestStudentCode);

document.getElementById('changeMatNoLink')?.addEventListener('click', (e) => {
  e.preventDefault();
  otpForm.hidden = true;
  matNoForm.hidden = false;
  document.getElementById('signinSubtitle').textContent = 'Enter your matric number to get a sign-in code.';
  clearInterval(resendTimerId);
  hideAlert();
});

/* OTP digit boxes — auto-advance / auto-back */
const otpDigits = document.querySelectorAll('.otp-digit');
otpDigits.forEach((digit, index) => {
  digit.addEventListener('input', () => {
    digit.value = digit.value.replace(/[^0-9]/g, '');
    if (digit.value && index < otpDigits.length - 1) otpDigits[index + 1].focus();
  });
  digit.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !digit.value && index > 0) otpDigits[index - 1].focus();
  });
});

otpForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const code = Array.from(otpDigits).map(d => d.value).join('');
  if (code.length < otpDigits.length) {
    showAlert('Enter the full 6-digit code.');
    return;
  }

  const btn = document.getElementById('verifyBtn');
  setSubmitting(btn, true, 'Verify & Sign In');
  try {
    const matNo = document.getElementById('matNo').value.trim();
    console.log('Verifying code for matNo:', matNo);
    console.log('Entered code:', code);
    const record = await dbGet('otps', matDocId(matNo));
    console.log('OTP record from database:', record);
    if (!record) {
      console.log('No OTP record found for matNo:', matNo);
      throw new Error('bad-code');
    }
    console.log('Code comparison - entered:', code, 'stored:', record.code, 'match:', code === record.code);
    if (record.code !== code) throw new Error('bad-code');
    if (Date.now() > record.expiresAt) throw new Error('expired');

    // Anonymous auth gives the student a real Firebase UID, so
    // Firestore Security Rules can check request.auth.uid against
    // students/{matNo}.authUid on future reads/writes.
    console.log("Signing in anonymously...");

    const credential = await auth.signInAnonymously();

    const user = credential.user;

    console.log("Anonymous auth successful, UID:", user.uid);
    const currentStudent = await dbGet('students', matDocId(matNo));
    console.log('Current student document before update:', currentStudent);
//     console.log('Student has authUid?', !!currentStudent.authUid);
//     console.log("Current Firebase UID:", user.uid);
// console.log("UIDs match?", currentStudent.authUid === user.uid);

    console.log('Updating student record with authUid...');
    await dbUpdate('students', matDocId(matNo), {
      // authUid: user.uid,
      lastSignInAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Student record updated successfully');

    console.log('Deleting OTP record...');
    await dbDelete('otps', matDocId(matNo));
    console.log('OTP record deleted successfully');

    sessionStorage.setItem('attendpro_role', 'student');
    sessionStorage.setItem('attendpro_matNo', matNo);

    window.location.href = '../student-dashboard.html';
  } catch (err) {
    console.error('Error verifying code:', err);
    showAlert(err.message === 'expired'
      ? 'That code has expired — request a new one.'
      : 'That code is incorrect.');
  } finally {
    setSubmitting(btn, false, 'Verify & Sign In');
  }
});

/* ------------------------------------------------------------------
   LECTURER SIGN UP
   Only succeeds if the Staff ID + email were already pre-approved
   by an admin in lecturerAllowlist/{staffId} (see js/admin.js).
-------------------------------------------------------------------*/
const lecturerSignupForm = document.getElementById('lecturerSignupForm');
lecturerSignupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (password !== confirmPassword) {
    showAlert('Passwords do not match.');
    return;
  }

  const btn = document.getElementById('submitBtn');
  setSubmitting(btn, true, 'Create Lecturer Account');

  const staffId = document.getElementById('staffId').value.trim();
  const email = document.getElementById('email').value.trim();

  try {
    console.log('Checking lecturer allowlist for staffId:', staffId);
    const approved = await dbGet('lecturerAllowlist', staffId);
    console.log('Allowlist check result:', approved);
    if (!approved || approved.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error('not-approved');
    }

    console.log('Checking if lecturer already exists...');
    const alreadyExists = await dbGet('lecturers', staffId);
    if (alreadyExists) throw new Error('already-exists');

    const lastName = document.getElementById('lastName').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const photoFile = document.getElementById('passportPhoto').files[0];
    const passportUrl = photoFile
      ? await compressImageToBase64(photoFile, { maxSize: 300, quality: 0.7 })
      : null;

    console.log('Creating Firebase Auth user with email:', email);
    const { user } = await auth.createUserWithEmailAndPassword(email, password);
    console.log('Firebase Auth user created successfully:', user.uid);

    await dbSet('lecturers', staffId, {
      staffId,
      firstName,
      lastName,
      middleName,
      fullName: [firstName, middleName, lastName].filter(Boolean).join(' '),
      email,
      passportUrl,
      authUid: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    showAlert('Account created! Redirecting to sign in...', 'success');
    setTimeout(() => { window.location.href = 'lecturer-signin.html'; }, 1200);
  } catch (err) {
    console.error('Lecturer signup failed:', err);
    if (err.message === 'not-approved') {
      showAlert('That Staff ID / email combination has not been pre-approved. Contact your admin.');
    } else if (err.message === 'already-exists') {
      showAlert('An account already exists for that Staff ID.');
    } else if (err.code === 'auth/email-already-in-use') {
      showAlert('That email is already registered.');
    } else if (err.code === 'auth/weak-password') {
      showAlert('Choose a password with at least 8 characters.');
    } else {
      showAlert('Could not create your account. Check your details and try again.');
    }
  } finally {
    setSubmitting(btn, false, 'Create Lecturer Account');
  }
});

/* ------------------------------------------------------------------
   LECTURER SIGN IN
   Accepts a Staff ID or an email as the identifier — Firebase Auth
   only understands email, so a Staff ID is resolved to an email via
   the lecturers/{staffId} document first.
-------------------------------------------------------------------*/
const lecturerSigninForm = document.getElementById('lecturerSigninForm');
lecturerSigninForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const btn = document.getElementById('submitBtn');
  setSubmitting(btn, true, 'Sign In');
  try {
    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;

    let email = identifier;
    if (!identifier.includes('@')) {
      const lecturer = await dbGet('lecturers', identifier);
      if (!lecturer) throw new Error('not-found');
      email = lecturer.email;
    }

    await auth.signInWithEmailAndPassword(email, password);
    window.location.href = '../lecturer-dashboard.html';
  } catch (err) {
    console.error('Lecturer signin failed:', err);
    showAlert('Incorrect Staff ID/email or password.');
  } finally {
    setSubmitting(btn, false, 'Sign In');
  }
});

document.getElementById('forgotPasswordLink')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const identifier = document.getElementById('identifier')?.value.trim();
  if (!identifier || !identifier.includes('@')) {
    showAlert('Enter your email above first, then click "Forgot password?" again.');
    return;
  }
  try {
    await auth.sendPasswordResetEmail(identifier);
    showAlert('Password reset email sent — check your inbox.', 'success');
  } catch (err) {
    console.error('Password reset failed:', err);
    showAlert('Could not send a reset email for that address.');
  }
});
