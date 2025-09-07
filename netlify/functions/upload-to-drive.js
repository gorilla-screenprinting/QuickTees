// netlify/functions/upload-to-drive.js
const { google } = require("googleapis");
const Busboy = require("busboy");
const { Readable } = require("stream"); // <-- add this

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const rawKey = process.env.GDRIVE_SERVICE_KEY;
    if (!rawKey || !rawKey.trim()) throw new Error("Missing env var GDRIVE_SERVICE_KEY");

    let credentials;
    try { credentials = JSON.parse(rawKey); }
    catch { throw new Error("GDRIVE_SERVICE_KEY is not valid JSON"); }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const drive = google.drive({ version: "v3", auth });

    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new Error("Request must be multipart/form-data");
    }

    const busboy = Busboy({ headers: { "content-type": contentType } });

    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileName = "upload.bin";
    let mimeType = "application/octet-stream";

    await new Promise((resolve, reject) => {
      busboy.on("file", (name, file, info) => {
        fileName = info?.filename || fileName;
        mimeType = info?.mimeType || mimeType;
        file.on("data", (data) => { fileBuffer = Buffer.concat([fileBuffer, data]); });
      });
      busboy.on("field", (name, val) => { fields[name] = val; });
      busboy.once("finish", resolve);
      busboy.once("error", reject);

      const body =
        event.isBase64Encoded && event.body
          ? Buffer.from(event.body, "base64")
          : Buffer.from(event.body || "", "utf8");
      busboy.end(body);
    });

    if (!fileBuffer.length) throw new Error("No file received");

    const parents = [];
    if (fields.folder_id) parents.push(fields.folder_id);
    else if (process.env.DRIVE_FOLDER_ID) parents.push(process.env.DRIVE_FOLDER_ID);

    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
        ...(parents.length ? { parents } : {}),
      },
      media: {
        mimeType,
        body: Readable.from(fileBuffer), // <-- use a stream, not Buffer
      },
      fields: "id, webViewLink, name, mimeType, parents",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        fileId: res.data.id,
        webViewLink: res.data.webViewLink,
        name: res.data.name,
        mimeType: res.data.mimeType,
        parents: res.data.parents || [],
      }),
      headers: { "content-type": "application/json" },
    };
  } catch (err) {
    console.error("Upload error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message, stack: err.stack }),
      headers: { "content-type": "application/json" },
    };
  }
};
