// netlify/functions/upload-to-drive.js
// Uploads multipart/form-data to Google Drive using a Service Account.

const { google } = require('googleapis');
const Busboy = require('busboy');

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const ct = event.headers['content-type'] || event.headers['Content-Type'];
    if (!ct || !ct.startsWith('multipart/')) return reject(new Error('Expected multipart/form-data'));

    const bb = Busboy({ headers: { 'content-type': ct } });
    const chunks = [];
    let filename = 'upload.bin';
    let mimeType = 'application/octet-stream';
    const fields = {};

    bb.on('file', (_name, file, info) => {
      filename = info?.filename || filename;
      mimeType = info?.mimeType || mimeType;
      file.on('data', d => chunks.push(d));
    });

    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('error', reject);
    bb.on('close', () => resolve({ buffer: Buffer.concat(chunks), filename, mimeType, fields }));

    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');
    bb.end(body);
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { buffer, filename, mimeType, fields } = await parseMultipart(event);
    if (!buffer?.length) return { statusCode: 400, headers: CORS, body: 'No file data' };

    const svcJSON  = process.env.GOOGLE_SERVICE_ACCOUNT;
    const folderId = process.env.DRIVE_FOLDER_ID;
    if (!svcJSON || !folderId) return { statusCode: 500, headers: CORS, body: 'Missing env vars' };

    const creds = JSON.parse(svcJSON);

    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.file'], // create/manage files it owns
    });

    const drive = google.drive({ version: 'v3', auth });

    const uploadRes = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body: Buffer.from(buffer) },
      fields: 'id, webViewLink',
      supportsAllDrives: true, // works for Shared Drives too
    });

    const out = {
      ok: true,
      fileId: uploadRes.data.id,
      webViewLink: uploadRes.data.webViewLink,
      name: filename,
      size: buffer.length,
      meta: fields,
    };

    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
  } catch (err) {
    console.error('Upload error:', err);
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: String(err) }) };
  }
};
