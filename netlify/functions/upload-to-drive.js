const { google } = require('googleapis');
const Busboy = require('busboy');
const { Readable } = require('stream');

// Auth client with service account
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});
const drive = google.drive({ version: 'v3', auth });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const busboy = Busboy({ headers: event.headers });
    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileInfo = {};

    await new Promise((resolve, reject) => {
      busboy.on('file', (name, file, info) => {
        fileInfo = info;
        file.on('data', (data) => {
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });
      });

      busboy.on('field', (name, val) => {
        fields[name] = val;
      });

      busboy.on('finish', resolve);
      busboy.on('error', reject);

      busboy.end(event.body, event.isBase64Encoded ? 'base64' : 'binary');
    });

    if (!fileBuffer.length) {
      return { statusCode: 400, body: 'No file uploaded' };
    }

    const fileStream = Readable.from(fileBuffer);

    const driveRes = await drive.files.create({
      requestBody: {
        name: fileInfo.filename || 'upload',
        parents: [process.env.GDRIVE_FOLDER_ID],
      },
      media: {
        mimeType: fileInfo.mimeType || 'application/octet-stream',
        body: fileStream,
      },
      fields: 'id, webViewLink',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        fileId: driveRes.data.id,
        webViewLink: driveRes.data.webViewLink,
      }),
    };
  } catch (err) {
    console.error('Upload error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};