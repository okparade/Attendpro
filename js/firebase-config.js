/* ==================================================================
   AttendPro — js/firebase-config.js
   Fill in the placeholders below from:
     Firebase console → Project settings → General → Your apps → SDK
     setup and configuration
     EmailJS console  → Account → General → Public Key

   Load order matters — this file must come AFTER the Firebase/EmailJS
   <script> tags and BEFORE js/common.js, js/auth.js, js/admin.js, etc.
   (see the <head> of each page for the include order).
=================================================================== */

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC0n0NCuIpqPjhMe-Cr4nSzhHqZQHHqnOA",
  authDomain: "student-attendance-syste-69714.firebaseapp.com",
  projectId: "student-attendance-syste-69714",
  storageBucket: "student-attendance-syste-69714.firebasestorage.app",
  messagingSenderId: "871127951556",
  appId: "1:871127951556:web:c2e69d2b3e7db717840191",
  measurementId: "G-5208DC629Q"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

/* EmailJS — used to send the student sign-in code from the browser.
   
   IMPORTANT: The variable names below MUST match exactly what's in your
   EmailJS template. Go to EmailJS Console → Email Templates → Edit template
   and check the variable names in {{brackets}}.
   
   Common variable names:
   - Recipient email: to_email, email, recipient_email
   - Recipient name: to_name, name, recipient_name
   - OTP code: otp_code, code, verification_code, passcode */
if (typeof emailjs !== 'undefined') {
  emailjs.init({ publicKey: "81XFepMO_MwvFaNWE" });
}
const EMAILJS_SERVICE_ID = "service_vt0o0pr";
const EMAILJS_OTP_TEMPLATE_ID = "template_z9ele1h";

// UPDATE THESE to match your EmailJS template variable names:
const EMAILJS_TO_EMAIL_VAR = "to_email";   // Check your template's "To Email" field
const EMAILJS_TO_NAME_VAR = "to_name";     // Check your template's "To Name" field  
const EMAILJS_OTP_VAR = "otp_code";         // Check your template's content for {{...}}
