// docs/js/upload.js
// Uploads a file to your Google Apps Script Web App, which saves it to Drive.
// REPLACE the URL below with your deployed Apps Script Web App URL (must end with /exec).
const APPS_SCRIPT_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbxwU538f5z18k880KM61iO11hWmhZ7sND-JxFGQNjv2ulBJSgtLuPsDI3Iygfnhn1jKvg/exec';

// Call this to send a file to Drive via Apps Script.
// Returns JSON: { ok, fileId, webViewLink, folderPath, ... }
async function uploadToDriveViaAppsScript(file, extra = {}) {
  if (!file) throw new Error('No file selected');

  // Practical Apps Script limit ~50 MB
  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error('File too large for Drive/App Script route (50MB max).');
  }

  const form = new FormData();
  form.append('file', file, file.name);
  Object.entries(extra).forEach(([k, v]) => form.append(k, String(v)));

  const res = await fetch(APPS_SCRIPT_UPLOAD_URL, {
    method: 'POST',
    body: form
    // no custom headers → avoids CORS preflight
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: HTTP ${res.status} ${text}`);
  }

  const result = await res.json();
  if (!result || result.ok !== true) {
    throw new Error(result && result.error ? result.error : 'Upload failed (no ok:true)');
  }

  // ⬇️ make it easy to inspect in DevTools
  window.lastUploadResult = result;

  return result;
}

// Optional convenience handler you can wire to your <input type="file"> change event
// If you use this, ensure #artFileName exists in the DOM.
async function handleFileInputChange(ev) {
  const file = ev.target.files?.[0];
  const nameEl = document.getElementById('artFileName');
  const btnEl  = document.getElementById('artFileBtn');

  if (!file) {
    if (nameEl) nameEl.textContent = '(No file selected)';
    return;
  }

  // Collect any optional metadata fields you’ve added to the page.
  const meta = {
    customer_email: document.querySelector('#email')?.value || '',
    order_note: document.querySelector('#note')?.value || ''
  };

  try {
    if (btnEl) btnEl.disabled = true;
    if (nameEl) nameEl.textContent = `Uploading: ${file.name}…`;

    const result = await uploadToDriveViaAppsScript(file, meta);

    // Save for later (Stripe checkout metadata, webhook, etc.)
    window.orderState = window.orderState || {};
    window.orderState.driveFileId   = result.fileId;
    window.orderState.driveViewLink = result.webViewLink;

    // ✅ “success line” in the UI: filename + clickable Drive link
    if (nameEl) {
      const safeName = file.name.replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
      nameEl.innerHTML = `${safeName} ✓ uploaded — <a href="${result.webViewLink}" target="_blank" rel="noopener">Open in Drive</a>`;
    }
  } catch (err) {
    console.error('Upload error:', err);
    if (nameEl) nameEl.textContent = `Upload failed: ${err.message}`;
    // Clear saved IDs on failure
    if (window.orderState) {
      window.orderState.driveFileId = null;
      window.orderState.driveViewLink = null;
    }
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}
