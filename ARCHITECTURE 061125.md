# QuickTees — Architecture & Ops Guide (Stripe + Paid‑Only Orders)
_Date: 2025‑11‑06_

> **Purpose**: This is everything a new assistant needs to understand the current QuickTees implementation and continue development — with **Stripe Checkout**, **Google Drive uploads**, and **Google Sheets write on paid orders only**.

---

## 0) TL;DR (Current State)
- **Frontend** (single page in `/docs`) lets the user pick a shirt blank, upload art, tweak placement, and open Checkout.
- **Uploads** go to **Google Drive** via Netlify function `upload-to-drive.js`; we store the returned `fileId` in `window.orderState`.
- **Stripe Checkout** is created by `create-checkout.js` using a **fixed `PRICE_ID`** (for now).
- **After payment succeeds**, `stripe-webhook.js` writes a **PAID** work order row to a Google Sheet (idempotent by `session.id`).
- We **do not** write pending/quote rows anymore (no `create-order.js` in the live path).

---

## 1) Repo Map
```
/docs
  assets/
    branding/
    shirt_blanks/
      manifest.json
      Heavy_Black_Cotton_T.png
      Heavy_White_Cotton_T.png
  js/
    app.js                 ← canvas + bg-removal + upload; stores fileId; calls checkout
    bagel-select.js
    fitline.js
    order-panel-shell.js
    order-panel.js         ← controls the slide-out order panel & buttons
  index.html               ← main UI; includes order panel
  style.css
  success.html             ← post-payment landing page

/netlify/functions
  upload-to-drive.js       ← parses multipart; uploads to Google Drive
  create-checkout.js       ← creates Stripe Checkout Session
  stripe-webhook.js        ← verifies signature; writes PAID rows to Google Sheet

netlify.toml               ← sets publish & functions dirs
package.json               ← deps: googleapis, busboy, stripe, etc.
```

_If you still see `create-order.js`, it’s legacy. It’s not used by the paid-only flow._

---

## 2) Environment Variables (Netlify → Site → Environment variables)
| Name | Example | Required | Notes |
|---|---|:--:|---|
| `GDRIVE_SERVICE_KEY` | Entire Service Account JSON (one line; `\n` in key) | ✅ | Used for Drive & Sheets auth |
| `DRIVE_FOLDER_ID` | `1AbCDefG…` | ✅ | Destination folder (SA must have access) |
| `STRIPE_SECRET_KEY` | `sk_test_…` | ✅ | Test for now; swap to live later |
| `PRICE_ID` | `price_…` | ✅ | Single price used by Checkout today |
| `SITE_URL` | `https://designer.gorillaprintshop.com` | ✅ | For Checkout success/cancel URLs |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | ✅ | From Stripe → Webhooks → your endpoint |
| `ORDERS_SPREADSHEET_ID` | `1xYz…` | ✅ | Google Sheet with an `Orders` tab |

**Drive sharing**: Add the **service account email** to the Shared Drive/folder with **Content Manager** or better.

---

## 3) Frontend Flow (`docs/js/app.js` + order panel)
- **User actions**:
  1. Choose blank (`#blankSelect`), upload art (`#artFile` / `#artFileBtn`), adjust placement.
  2. App samples corner colors; shows swatches & controls for background removal.
  3. On file choose: app uploads the original file → `/.netlify/functions/upload-to-drive` → saves `window.orderState.fileId`.
  4. **User clicks “Place”** (`#qtPlaceBtn`) → app POSTs to `/.netlify/functions/create-checkout` with `{ email, fileId, orderNote }` → browser redirects to Stripe Checkout.
  5. Stripe redirects back to **`/success.html`** after payment.

- **State**:
  - `window.orderState.fileId` ← Drive `id` from upload response.
  - `window.orderState.orderNote` ← from `#qtNotes`.

- **Key DOM IDs**: `#qtEmail`, `#qtNotes`, `#qtPlaceBtn`, `#artFile`, `#artFileBtn`, `#artFileName`, `#blankSelect`, `#stage`.

---

## 4) Drive Upload Function (`upload-to-drive.js`)
- **POST** multipart form with `file`, plus optional `customer_email`, `order_note`.
- Buffers/streams file into Google Drive using service account from `GDRIVE_SERVICE_KEY`.
- **Response** JSON: `{ "id": "<fileId>", "webViewLink": "https://drive.google.com/file/d/<id>/view" }`
- Common issues:
  - 403/404 “File/Folder not found” → SA not shared to Drive/folder.
  - 502 on Netlify → malformed env JSON (escape `\n` in private key).

---

## 5) Checkout Creator (`create-checkout.js`)
- **Input (JSON)**: `{ email?, fileId, orderNote?, priceId? }`
- Uses `priceId || process.env.PRICE_ID`, `mode: 'payment'`.
- Attaches `metadata: { fileId, orderNote }` to the session.
- `success_url = ${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`
- `cancel_url   = ${SITE_URL}/?canceled=1`
- **Return**: `{ url }` to redirect the browser to Checkout.

**Note**: We don’t override `apiVersion` on the Stripe SDK (prevents “Invalid API version” errors).

---

## 6) Webhook (`stripe-webhook.js`) — Paid‑Only Sheet Write
- Verifies the Stripe signature with `STRIPE_WEBHOOK_SECRET` using the **raw** request body.
- On **`checkout.session.completed`**:
  1. Log the event (email, amount, metadata).
  2. **Append a row** to Google Sheets (`Orders` tab) with **status `PAID`** only after payment.
  3. Row schema (columns **A:P**):
     - **A** `orderId` (`QT-<timestamp>`)
     - **B** `createdAt` (ISO)
     - **C** `status` = `PAID`
     - **D** `email`
     - **E** `name`
     - **F** `phone`
     - **G** `itemsJson` (minimal: `[{ price, qty:1 }]`)
     - **H** `fileId` (from metadata)
     - **I** `webViewLink` (empty for now)
     - **J** `notes` (from metadata)
     - **K** `subtotal` (Stripe cents → dollars)
     - **L** `tax` (Stripe cents → dollars)
     - **M** `shipping` (Stripe cents → dollars)
     - **N** `grandTotal` (Stripe cents → dollars)
     - **O** `session.id` (idempotency key)
     - **P** `source` = `QuickTees+Stripe`
  4. **Idempotency**: check column **O** first; if a row with this `session.id` exists, skip.

_This replaced any use of `create-order.js`; there are no pending rows._

---

## 7) Testing
**Drive upload**
1. Choose a small file → confirm the upload completes and a Drive link appears in the UI.

**Checkout**
1. Click **Place** → Stripe Checkout opens.
2. Use test card **4242 4242 4242 4242**, any future date, any CVC, any ZIP.
3. After success, you land on `/success.html`.

**Webhook & Sheet**
1. Netlify → Deploys → Functions → `stripe-webhook` → check latest log for `PAID:` and `Sheet row written`.
2. Open the Google Sheet (`Orders` tab) → new **PAID** row present.

---

## 8) Troubleshooting (Fast)
- **405 Method Not Allowed** hitting function via GET → fine; functions expect POST.
- **Upload fails** → check Netlify logs for `upload-to-drive`. Confirm `GDRIVE_SERVICE_KEY` formatting and Drive sharing.
- **Stripe “Invalid API version”** → ensure we do **not** pass a hard-coded `apiVersion` to `new Stripe(...)`.
- **Webhook not writing** → verify `STRIPE_WEBHOOK_SECRET`, `ORDERS_SPREADSHEET_ID`, and that the Stripe dashboard webhook endpoint points to `https://<site>/.netlify/functions/stripe-webhook`.
- **Duplicate rows** → confirm column **O** contains unique `session.id`; idempotency check uses that.

---

## 9) Near‑Term Roadmap (Owner Priorities)
- **Size runs** (collect S/M/L/XL/XXL counts in the order panel). Add to `metadata` and write to the Sheet.
- **Multiple products** (tees, hoodies, colors). Pass specific `priceId` from UI; map product → Stripe price.
- **Mobile UI fixes** (panel ergonomics, gestures). Make a quick device test matrix.
- **Better background removal** (improved wand/threshold, speed, preview quality).
- **Stripe scenarios**: refunds, partial refunds, cancel, retry flows — log and reflect in Sheet if desired.

---

## 10) Handy One‑Liners
```bash
# Trigger a deploy without code changes
git commit --allow-empty -m "deploy" && git push

# Quick reachability (405 is expected on GET for POST-only functions)
curl -I https://<site>/.netlify/functions/create-checkout
curl -I https://<site>/.netlify/functions/upload-to-drive
curl -I https://<site>/app.js
```

---

## 11) What a future assistant might still need from you
- The **Sheet URL/ID** (already in `ORDERS_SPREADSHEET_ID`) and confirmation the tab is named `Orders`.
- The list of **Stripe prices** for products you want to offer.
- The exact **size grid** to collect and where to store it in the Sheet.
- Any **mobile bugs** you notice (screenshots + device).

---

**Contact surface (server endpoints)**
```
POST /.netlify/functions/upload-to-drive
POST /.netlify/functions/create-checkout
POST /.netlify/functions/stripe-webhook
```
