// docs/js/upload.js

const APPS_SCRIPT_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbwLUpEofVXKXFqkzjnasx_LDqHOlMmL7AmdHnGX8yX25IEiNvbpGPP-LSj2Whx1MQICbQ/exec'; // ends with /exec

async function uploadToDriveViaAppsScript(file, extra = {}) {
  if (!file) throw new Error('No file selected');

  // Optional client-side size gate
  const MAX_BYTES = 50 * 1024 * 1024; // ~50MB
  if (file.size > MAX_BYTES) {
    throw new Error('File too large for Drive/App Script route (50MB max).');
  }

  const form = new FormData();
  form.append('file', file, file.name);
  Object.entries(extra).forEach(([k, v]) => form.append(k, String(v)));

  const res = await fetch(APPS_SCRIPT_UPLOAD_URL, {
    method: 'POST',
    body: form
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function handleFileInputChange(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const meta = {
    customer_email: document.querySelector('#email')?.value || '',
    order_note: document.querySelector('#note')?.value || ''
  };
  const result = await uploadToDriveViaAppsScript(file, meta);
  console.log('Drive upload result:', result);
  // Save result.fileId in your in-memory order state
}
