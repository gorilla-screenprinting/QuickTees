// docs/js/upload.js
// Resolves the Apps Script /exec redirect, then POSTs directly to the final URL
const APPS_SCRIPT_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbxwU538f5z18k880KM61iO11hWmhZ7sND-JxFGQNjv2ulBJSgtLuPsDI3Iygfnhn1jKvg/exec';

// Cache for the resolved googleusercontent URL
let __RESOLVED_EXEC_URL__ = null;

// Resolve the redirect (GET is fine) and cache the final absolute URL
async function resolveExecUrl() {
  if (__RESOLVED_EXEC_URL__) return __RESOLVED_EXEC_URL__;
  const res = await fetch(APPS_SCRIPT_UPLOAD_URL, {
    method: 'GET',
    redirect: 'follow',
    // No headers => simple request
  });
  // After following, res.url is the final googleusercontent.com URL
  __RESOLVED_EXEC_URL__ = res.url || APPS_SCRIPT_UPLOAD_URL;
  return __RESOLVED_EXEC_URL__;
}

// Upload a file to Drive via Apps Script web app (multipart/form-data)
async function uploadToDriveViaAppsScript(file, extra = {}) {
  if (!file) throw new Error('No file selected');

  // Practical Apps Script limit ~50 MB
  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) throw new Error('File too large (>50MB).');

  // Build multipart body
  const form = new FormData();
  form.append('file', file, file.name);
  Object.entries(extra).forEach(([k, v]) => form.append(k, String(v)));

  // 1) Resolve the final exec URL to avoid POST->GET redirect body loss
  const finalUrl = await resolveExecUrl();

  // 2) POST the form to the final URL
  const res = await fetch(finalUrl, {
    method: 'POST',
    body: form,         // let the browser set the multipart boundary header
    redirect: 'follow', // OK now; we're already at final host
  });

  // Read once, then parse
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}

  if (!res.ok) {
    // Surface the raw body for debugging
    window.lastUploadResult = { ok: false, status: res.status, body: text };
    throw new Error(`Server error ${res.status}`);
  }
  if (!data || data.ok !== true) {
    window.lastUploadResult = data || { ok: false, body: text };
    throw new Error(data?.error || 'Upload failed (no ok:true)');
  }

  // Success
  window.lastUploadResult = data;
  // Store for checkout later
  window.orderState = window.orderState || {};
  window.orderState.driveFileId   = data.fileId;
  window.orderState.driveViewLink = data.webViewLink;
  return data;
}

// Optional convenience handler (used by app.js or you can wire it directly)
async function handleFileInputChange(ev) {
  const file = ev.target.files?.[0];
  const nameEl = document.getElementById('artFileName');
  const btnEl  = document.getElementById('artFileBtn');

  if (!file) { if (nameEl) nameEl.textContent = '(No file selected)'; return; }

  const meta = {
    customer_email: document.querySelector('#email')?.value || '',
    order_note: document.querySelector('#note')?.value || ''
  };

  try {
    if (btnEl) btnEl.disabled = true;
    if (nameEl) nameEl.textContent = `Uploading: ${file.name}…`;

    const result = await uploadToDriveViaAppsScript(file, meta);

    if (nameEl) {
      const safeName = file.name.replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
      nameEl.innerHTML = `${safeName} ✓ uploaded — <a href="${result.webViewLink}" target="_blank" rel="noopener">Open in Drive</a>`;
    }
  } catch (err) {
    if (nameEl) nameEl.textContent = `Upload failed: ${err.message}`;
    console.error(err);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}
