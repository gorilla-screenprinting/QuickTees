// netlify/functions/upload-to-drive.js
const { google } = require("googleapis");
const Busboy = require("busboy");
const { Readable } = require("stream");

// ENV REQUIRED:
// - GDRIVE_SERVICE_KEY  (stringified JSON of the service account key)
// - DRIVE_FOLDER_ID     (optional; a folder ID the service account can write to)
const SERVICE_KEY = process.env.GDRIVE_SERVICE_KEY;
if (!SERVICE_KEY) {
  // Fail fast with a clear error if the env var isn't set
  throw new Error("GDRIVE_SERVICE_KEY env var is missing");
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(SERVICE_KEY),
  scopes: ["https://www.googleapis.com/auth/drive.file"],
});

const drive = google.drive({ version: "v3", auth });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "content-type": "text/plain" },
      body: "Method Not Allowed",
    };
  }

  try {
    // ---------- Parse multipart form ----------
    const busboy = Busboy({
      headers: event.headers,
    });

    const fields = {};
    let fileBuffer = Buffer.alloc(0);
    let fileName = "upload.bin";
    let mimeType = "application/octet-stream";
    let fileSizeBytes = 0;

    await new Promise((resolve, reject) => {
      busboy.on("file", (fieldname, file, info) => {
        if (info && info.filename) fileName = info.filename;
        if (info && (info.mimeType || info.mimetype)) {
          mimeType = info.mimeType || info.mimetype;
        }

        file.on("data", (chunk) => {
          fileBuffer = Buffer.concat([fileBuffer, chunk]);
          fileSizeBytes += chunk.length;
        });
        file.on("end", () => {
          // noop — finished reading file stream
        });
      });

      busboy.on("field", (name, val) => {
        fields[name] = val;
      });

      busboy.on("error", reject);
      busboy.on("finish", resolve);

      // Feed body to busboy
      const body = event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64")
        : Buffer.from(event.body || "", "utf8");

      busboy.end(body);
    });

    // Basic guards before hitting Drive
    if (!fileSizeBytes) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "No file data received" }),
      };
    }

    // Netlify Functions hard-limit around 10MB; bail early with a clear message.
    const MAX_BYTES = 9 * 1024 * 1024; // ~9MB
    if (fileSizeBytes > MAX_BYTES) {
      return {
        statusCode: 413,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error: `File too large (${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB). Max 9 MB.`,
        }),
      };
    }

    console.info("Upload request", { fileName, mimeType, bytes: fileSizeBytes });

    // ---------- Build Drive create request ----------
    const parents = [];
    const folderEnv = process.env.DRIVE_FOLDER_ID && String(process.env.DRIVE_FOLDER_ID).trim();
    if (folderEnv) parents.push(folderEnv);

    const createReq = {
      requestBody: {
        name: fileName,
        mimeType,
        ...(parents.length ? { parents } : {}),
      },
      media: {
        mimeType,
        // IMPORTANT: googleapis expects a stream here; Buffer alone can trigger
        // "part.body.pipe is not a function". Wrap Buffer as a Readable stream:
        body: Readable.from(fileBuffer),
      },
      fields: "id, webViewLink, parents",
      supportsAllDrives: true,
    };

    let createRes;
    try {
      createRes = await drive.files.create(createReq);
    } catch (driveErr) {
      console.error("Drive create failed", {
        message: driveErr.message,
        errors: driveErr.errors,
        code: driveErr.code,
      });
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error: driveErr.message || "Drive upload failed",
          code: driveErr.code,
          errors: driveErr.errors,
        }),
      };
    }

    // If we set a parent in a Shared Drive, ensure it's actually used and visible
    // (not strictly required; added for robustness)
    const fileId = createRes.data.id;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileId,
        webViewLink: createRes.data.webViewLink,
        savedWhere: parents.length ? `folder:${parents[0]}` : "service-account-my-drive",
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
        stack: (err && err.stack) || undefined,
      }),
    };
  }
};
