/* ==================================================================
   AttendPro — js/api-config.js
   Update this once your Python backend is deployed
   (see /backend/README.md).
=================================================================== */

const API_BASE_URL =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : 'https://attendpro-i7n8.onrender.com';
