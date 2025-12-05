// netlify/functions/create-upload-url.js
// Returns a short-lived signed URL for uploading directly to Google Cloud Storage.
// This bypasses Netlify's request size/timeout limits.
//
// Env vars required:
// - GDRIVE_SERVICE_KEY : JSON for the service account (same one you use for Drive)
// - GCS_BUCKET         : target bucket name (service account needs storage.objects.create)
// - GCS_UPLOAD_PREFIX  : optional folder/prefix inside the bucket (e.g., "uploads")

const crypto = require('crypto');

const SERVICE_KEY = process.env.GDRIVE_SERVICE_KEY;
const BUCKET = process.env.GCS_BUCKET;
const PREFIX = (process.env.GCS_UPLOAD_PREFIX || 'uploads').replace(/^\/+|\/+$/g, ''); // trim slashes

if (!SERVICE_KEY) throw new Error('GDRIVE_SERVICE_KEY env var is missing');
if (!BUCKET) throw new Error('GCS_BUCKET env var is missing');

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function timestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildSignedUrl({ objectName, expiresIn = 600 }) {
  const { private_key: privateKey, client_email: clientEmail } = JSON.parse(SERVICE_KEY);
  const now = new Date();
  const datestamp = yyyymmdd(now);
  const amzDate = timestamp(now); // e.g., 20241028T123456Z

  const host = 'storage.googleapis.com';
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;
  const credential = `${clientEmail}/${credentialScope}`;
  const signedHeaders = 'host';
  const canonicalUri = `/${BUCKET}/${encodeURIComponent(objectName).replace(/%2F/g, '/')}`;
  const queryParams = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', encodeURIComponent(credential)],
    ['X-Goog-Date', amzDate],
    ['X-Goog-Expires', String(expiresIn)], // seconds
    ['X-Goog-SignedHeaders', signedHeaders],
  ]
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    queryParams,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const hash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [
    'GOOG4-RSA-SHA256',
    amzDate,
    credentialScope,
    hash,
  ].join('\n');

  const signature = crypto.createSign('RSA-SHA256').update(stringToSign).sign(privateKey, 'hex');
  const url = `https://${host}${canonicalUri}?${queryParams}&X-Goog-Signature=${signature}`;

  const publicUrl = `https://${host}/${BUCKET}/${encodeURIComponent(objectName).replace(/%2F/g, '/')}`;
  return { url, expiresIn, publicUrl, objectName, bucket: BUCKET };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const origName = (body.fileName || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const prefix = PREFIX ? `${PREFIX}/` : '';
    const objectName = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${origName}`;

    const signed = buildSignedUrl({ objectName, expiresIn: 600 });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    };
  } catch (err) {
    console.error('create-upload-url error:', err);
    return { statusCode: 500, body: 'Failed to create upload URL' };
  }
};
