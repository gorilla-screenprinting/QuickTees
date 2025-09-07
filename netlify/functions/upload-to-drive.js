// netlify/functions/upload-to-drive.js
const { google } = require("googleapis");
const Busboy = require("busboy");

// ----- Auth (service account JSON in env var GDRIVE_SERVICE_KEY) -----
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});
const drive = google.drive({ version: "v3", auth });

// Small helper: upload buffer to Drive (optionally inside a folder)
async function uploadBufferToDrive({ fileName, mimeType, buffer, folderId }) {
  const params = {
    requestBody: {
      name: fileName,
      mimeType,
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType,
      body: Buffer.from(buffer),
    },
    fields: "id, webViewLink, parents",
    supportsAllDrives: true,
  };
  return await drive.files.create(params);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // ---------- Parse multipart form ----------
    const busboy = Busboy({ headers: event.headers });
    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileName = "upload.bin";
    let mimeType = "application/octet-stream";

    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "");

    await new Promise((resolve, reject) => {
      busboy.on("file", (_name, file, info) => {
        fileName = info?.filename || fileName;
        mimeType = info?.mimeType || mimeType;
        file.on("data", (d) => (fileBuffer = Buffer.concat([fileBuffer, d])));
        file.on("end", () => resolve());
      });

      busboy.on("field", (name, val) => {
        fields[name] = val;
      });

      busboy.on("error", reject);

      // IMPORTANT: feed busboy the raw Buffer
      busboy.end(bodyBuf);
    });

    if (!fileBuffer.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No file received" }),
      };
    }

    const folderId = process.env.DRIVE_FOLDER_ID?.trim();
    let result, savedWhere = "unknown";

    try {
      // First try: upload into the configured folder (Shared Drive supported)
      result = await uploadBufferToDrive({
        fileName,
        mimeType,
        buffer: fileBuffer,
        folderId: folderId || undefined,
      });
      savedWhere = folderId ? `folder:${folderId}` : "no-folder";
    } catch (err) {
      // If folder is not found/accessible (common 404 with Shared Drives), retry WITHOUT parents
      // so it goes into the service account's My Drive. This proves auth + upload path work.
      if (folderId) {
        // Retry outside the folder
        result = await uploadBufferToDrive({
          fileName,
          mimeType,
          buffer: fileBuffer,
          folderId: undefined,
        });
        savedWhere = "service-account-my-drive";
      } else {
        throw err;
      }
    }

    const data = result.data || {};
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileId: data.id,
        webViewLink: data.webViewLink,
        savedWhere,
        // echo a couple fields in case you want them in the UI later
        customer_email: fields.customer_email || "",
        order_note: fields.order_note || "",
      }),
    };
  } catch (err) {
    console.error("Upload error:", err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: err.message || String(err),
      }),
    };
  }
};
