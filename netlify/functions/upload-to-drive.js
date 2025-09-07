// netlify/functions/upload-to-drive.js
const { google } = require("googleapis");
const Busboy = require("busboy");
const { Readable } = require("stream");

const SERVICE_KEY_JSON = process.env.GDRIVE_SERVICE_KEY; // service account JSON (string)
const DRIVE_FOLDER_ID  = process.env.DRIVE_FOLDER_ID || ""; // optional

if (!SERVICE_KEY_JSON) {
  throw new Error("GDRIVE_SERVICE_KEY env var is missing");
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(SERVICE_KEY_JSON),
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});
const drive = google.drive({ version: "v3", auth });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse multipart form
    const busboy = Busboy({ headers: event.headers });
    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileName = "upload.bin";
    let mimeType = "application/octet-stream";

    await new Promise((resolve, reject) => {
      busboy.on("file", (_name, file, info) => {
        fileName = info?.filename || fileName;
        mimeType = info?.mimeType || mimeType;

        file.on("data", (data) => {
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });
        file.on("end", resolve);
      });

      busboy.on("field", (name, val) => (fields[name] = val));
      busboy.on("error", reject);

      // Body may be base64-encoded
      const body =
        event.isBase64Encoded && typeof event.body === "string"
          ? Buffer.from(event.body, "base64")
          : event.body;

      busboy.end(body);
    });

    // Optional: preflight check if a folder ID was provided (works for My Drive or Shared Drives)
    if (DRIVE_FOLDER_ID) {
      await drive.files.get({
        fileId: DRIVE_FOLDER_ID,
        fields: "id",
        supportsAllDrives: true,
      });
    }

    // Upload
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        ...(DRIVE_FOLDER_ID ? { parents: [DRIVE_FOLDER_ID] } : {}),
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer), // stream to satisfy googleapis multipart
      },
      fields: "id, webViewLink",
      supportsAllDrives: true, // <- IMPORTANT for Shared Drives
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        fileId: res.data.id,
        webViewLink: res.data.webViewLink,
      }),
    };
  } catch (err) {
    console.error("Upload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, stack: err.stack }),
    };
  }
};
