// netlify/functions/upload-to-drive.js
const { google } = require("googleapis");
const Busboy = require("busboy");
const { Readable } = require("stream");

// Google Drive auth (service account JSON stored in Netlify env var)
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});
const drive = google.drive({ version: "v3", auth });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const busboy = Busboy({ headers: event.headers });
    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileName = "upload.bin";
    let mimeType = "application/octet-stream";

    await new Promise((resolve, reject) => {
      busboy.on("file", (name, file, info) => {
        fileName = info.filename || fileName;
        mimeType = info.mimeType || mimeType;

        file.on("data", (data) => {
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });

        file.on("end", resolve);
      });

      busboy.on("field", (name, val) => {
        fields[name] = val;
      });

      busboy.on("error", reject);

      busboy.end(
        event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
      );
    });

    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        parents: [process.env.DRIVE_FOLDER_ID], // upload into your folder
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer), // ✅ fixed: stream from buffer
      },
      fields: "id, webViewLink",
    });

    return {
      statusCode: 200,
      body: JSON.stringify(res.data),
    };
  } catch (err) {
    console.error("Upload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
