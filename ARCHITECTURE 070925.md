# QuickTees — Architecture & Ops Guide

> Snapshot for future assistants: this repo powers a single‑page shirt mockup + upload flow, deployed on Netlify. Frontend lives in `docs/`, serverless functions in `netlify/functions/`. File uploads go to Google Drive via a service account.

---

## 1) High‑Level Overview

```mermaid
flowchart TD
  A[User Browser] -->|selects art & interacts| B[docs/app.js]
  B -->|fetch POST multipart/form-data| C[Netlify Function: upload-to-drive.js]
  C -->|Service Account JWT| D[Google Drive API v3]
  D -->|stores file in folder| E[Shared Drive/Folder]
  B -->|receives JSON {id, webViewLink}| A
```

- **Frontend**: `docs/index.html` + `docs/app.js`
  - Canvas mockup (drag, pinch‑zoom, size readout).
  - Background‑removal (corner sampling, threshold/wand, feather).
  - File upload: `<input type="file" id="artFile">` + button `#artFileBtn`.
  - On file select: preview locally, then POST to `/.netlify/functions/upload-to-drive`.
- **Backend**: Netlify Functions (Node 18/20/22 compatible)
  - `netlify/functions/upload-to-drive.js` parses multipart with **busboy** and streams to **Google Drive API** using a **Service Account**.
- **Deployment**: Netlify CD from GitHub `gorilla-screenprinting/QuickTees`
  - **Publish directory**: `docs`
  - **Functions directory**: `netlify/functions`
  - Environment vars configured in Netlify UI.

---

## 2) Repo Layout

```
/docs
  index.html                # loads ./app.js (same folder)
  app.js                    # all canvas + upload client JS
  assets/shirt_blanks/...   # mockup images + manifest.json
/netlify/functions
  upload-to-drive.js        # Drive upload endpoint
  create-checkout.js        # (present, not covered here)
  stripe-webhook.js         # (present, not covered here)
.gitignore                  # excludes node_modules, .env, logs, .netlify
netlify.toml                # [build] settings + redirects (if any)
package.json                # deps: googleapis, busboy, etc.
```

---

## 3) Frontend Flow (docs/app.js)

**Key elements**: `#artFile`, `#artFileBtn`, `#stage`, `#blankSelect`, background removal controls.

**Process**:
1. User selects an image → immediate local preview on canvas.
2. Corner colors are sampled → optional background mask built (threshold/wand + feather).
3. Upload:
   - Build `FormData` with `file`, plus optional `customer_email`, `order_note`.
   - `fetch('/.netlify/functions/upload-to-drive', { method:'POST', body: form })`.
4. On 200 OK: save `{ fileId, webViewLink }` to `window.orderState` and render link.

---

## 4) Backend: upload-to-drive.js

### Responsibilities
- Validate **POST**.
- Parse **multipart/form-data** with **busboy**.
- Accumulate the file stream into a **Buffer** (or stream it; current impl buffers).
- Create Drive file in the configured **folder** (supports Shared Drive).
- Return `{ id, webViewLink }` JSON.

### Notes
- Uses **Service Account** via env `GDRIVE_SERVICE_KEY` (JSON string) and `DRIVE_FOLDER_ID`.
- Passes `supportsAllDrives: true` for Shared Drives.
- Optionally sets `parents: [DRIVE_FOLDER_ID]` if provided.
- Minimal body shape returned to the browser.

---

## 5) Environment Variables (Netlify UI → Site configuration → Environment variables)

| Name                 | Example / Format                                                                 | Required | Notes |
|----------------------|-----------------------------------------------------------------------------------|----------|-------|
| `GDRIVE_SERVICE_KEY` | The **entire** Service Account JSON, pasted as one‐line JSON (no newlines).      | ✅        | Includes `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, etc. |
| `DRIVE_FOLDER_ID`    | e.g. `1AbCDefG...`                                                                | ✅        | ID of destination folder. For **Shared Drive** folders, also share the drive/folder with the SA. |
| `NODE_VERSION`       | `20`                                                                              | ⛔️ optional | Only if pinning runtime. |
| (legacy) `GOOGLE_SERVICE_ACCOUNT` | *Not used*                                                           | ❌        | Replaced by `GDRIVE_SERVICE_KEY`. Remove to avoid confusion. |

**Shared Drive Reminder**: In Google Drive UI, add the **service account email** as a member of the **Shared Drive or folder** with at least **Content manager**. If you only share a *subfolder*, also ensure the SA has access to the parent drive when needed.

---

## 6) Netlify Build/Deploy Settings

- **Repository**: `github.com/gorilla-screenprinting/QuickTees`
- **Publish directory**: `docs`
- **Functions directory**: `netlify/functions`
- **Build command**: *(none needed for pure static + functions)*
- **Redirects**: If used, keep `/app.js` served from `docs/` (index loads `./app.js`).

`netlify.toml` minimal example:
```toml
[build]
  publish = "docs"
  functions = "netlify/functions"
```

---

## 7) API Contract

### Request (multipart/form-data)
- **file**: the image file (required)
- **customer_email**: string (optional)
- **order_note**: string (optional)

### Response (JSON)
```json
{
  "id": "1xyz...",
  "webViewLink": "https://drive.google.com/file/d/1xyz/view?usp=drivesdk"
}
```

### cURL Test
```bash
curl -i -X POST "https://<your-site>.netlify.app/.netlify/functions/upload-to-drive"   -F "file=@/absolute/path/to/test.png"   -F "customer_email=test@example.com"   -F "order_note=hello"
```

Replace `<your-site>` with the actual Netlify site subdomain.

---

## 8) Known Pitfalls & Fixes

- **`uploadToDriveViaAppsScript is not defined`**  
  *Cause*: old client referencing a removed Apps Script helper.  
  *Fix*: client now POSTS directly to Netlify Function; ensure `docs/app.js` includes the `fetch('/.netlify/functions/upload-to-drive', …)` path and that `index.html` loads `./app.js` from `docs`.

- **`part.body.pipe is not a function`** (*Google API multipart with non-stream body*)  
  *Cause*: Passing a non‑stream / wrong shape to `googleapis` multipart.  
  *Fix*: Provide `media.body` as a proper `Readable` **stream** or a `Buffer`. Current working code buffers the upload then uses a Buffer.

- **`File not found: <folder-id>`** when setting `parents`  
  *Cause*: Service account lacks access to the target folder/Shared Drive.  
  *Fix*: Share the folder/drive with the **service account email** (from the JSON) and set `supportsAllDrives: true` in API calls.

- **502 from Netlify function**  
  *Cause*: runtime error (bad env var name or JSON parse).  
  *Fix*: Confirm `GDRIVE_SERVICE_KEY` is valid JSON. If pasting multi‑line, ensure it’s not truncated and contains the full key (including `-----BEGIN PRIVATE KEY-----` block escaped as `\n`).

- **404 for `/app.js` or syntax error in browser**  
  *Cause*: index referencing wrong path or JS contained literal backslashes before template literals (e.g., `\`` or `\${}`) from prior manipulation.  
  *Fix*: Ensure `<script defer src="./app.js"></script>` and clean the file of stray backslashes.

---

## 9) Ops: One‑liners

### Stage & push a single file
```bash
git add docs/app.js && git commit -m "chore: update app.js" && git push
```

### Stage & push function
```bash
git add netlify/functions/upload-to-drive.js && git commit -m "fix: drive upload function" && git push
```

### Stage & push multiple
```bash
git add docs/app.js netlify/functions/upload-to-drive.js netlify.toml package*.json && git commit -m "sync: client + function + config" && git push
```

### Verify deployment assets
```bash
curl -I https://<your-site>.netlify.app/app.js
curl -s https://<your-site>.netlify.app/app.js | head
```

### Test function locally (via cURL)
```bash
curl -i -X POST "https://<your-site>.netlify.app/.netlify/functions/upload-to-drive"   -F "file=@/absolute/path/to/test.png"
```

---

## 10) Troubleshooting Checklist

- [ ] Netlify site → **Environment variables**: `GDRIVE_SERVICE_KEY`, `DRIVE_FOLDER_ID` present and correct.
- [ ] Service account email **shared** on the **Shared Drive or folder**.
- [ ] `docs/index.html` includes `<script defer src="./app.js"></script>`.
- [ ] `docs/app.js` uses `fetch('/.netlify/functions/upload-to-drive', …)`.
- [ ] Function logs (Netlify → Deploys → **Functions** → `upload-to-drive`) show no parse/auth errors.
- [ ] cURL upload test works; browser upload shows Drive link.

---

## 11) Future Work (Nice‑to‑haves)

- Stream file directly (avoid buffering large files in memory).
- Virus/image validation step before upload.
- Persist order metadata (email, note, fileId) to a DB or spreadsheet.
- Add progress UI for uploads.
- S3 or Cloudflare R2 staging before Drive (optional).

---

**Contact surface**: the only server entry point required by the frontend is:
```
POST /.netlify/functions/upload-to-drive
```

This document should be sufficient context for any assistant to reason about the code, configuration, and standard failure modes.
