# QuickTees — Architecture & Ops Guide (Stripe + Drive)  
_Date: 2025-11-26_

> Canonical snapshot of the current flow: single-page app in `docs/`, uploads to Drive, Stripe Checkout for garments + DTF decoration, webhook writes paid rows only.

---

## 0) TL;DR
- Frontend (in `docs/`) lets users pick a blank, upload art, preview on canvas, and launch Stripe Checkout.
- Uploads go to Google Drive via Netlify function `upload-to-drive.js`; response `fileId` is stored in `window.orderState`.
- Checkout is created by `create-checkout.js`: one garment line item (SKU-driven) + one DTF decoration line item (tier + placement) + shipping from table. Uses per-product Stripe price IDs.
- Webhook (`stripe-webhook.js`) listens for `checkout.session.completed` and writes **PAID** rows to Google Sheets (idempotent on `session.id`). No pending/quote rows and no `create-order.js` in the live path.

---

## 1) Repo Map
```
/docs
  index.html                 # main UI
  js/
    app.js                   # canvas, bg removal, uploads, blank selector, checkout launcher
    order-panel.js           # slide-out panel wiring (legacy; main flow uses app.js place button)
    bagel-select.js, fitline.js, order-panel-shell.js, rmv-bckd.js
  assets/shirt_blanks/
    manifest.json            # blank selector source; has sku + file for preview
    *.png/jpg                # front/back mockups (shared by value/premium)
/netlify/functions
  upload-to-drive.js         # multipart → Drive
  create-checkout.js         # Stripe Checkout (garment + DTF + shipping)
  stripe-webhook.js          # handles checkout.session.completed → Sheets
  config/prices.js           # Stripe price IDs (garments + DTF tiers)
  config/shipping.json       # count-based UPS Ground table
netlify.toml                 # publish/docs + functions path
package.json                 # deps: stripe, googleapis, busboy, etc.
```

---

## 2) Environment Variables (Netlify → Site → Environment variables)
| Name | Example | Required | Notes |
|---|---|:--:|---|
| `GDRIVE_SERVICE_KEY` | entire SA JSON (one line; `\n` in key) | ✅ | Used for Drive & Sheets auth |
| `DRIVE_FOLDER_ID` | `1AbCDefG…` | ✅ | Destination folder; SA must be shared (Content Manager+) |
| `STRIPE_SECRET_KEY` | `sk_test_…` | ✅ | Match mode to price IDs in `config/prices.js` |
| `SITE_URL` | `https://designer.gorillaprintshop.com` | ✅ | Used for success/cancel URLs |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | ✅ | From Stripe dashboard webhook |
| `ORDERS_SPREADSHEET_ID` | `1xYz…` | ✅ | Google Sheet `Orders` tab |
| (legacy) `PRICE_ID` | `price_…` | ❌ | Replaced by per-SKU pricing; keep unset |
| (optional) `NODE_VERSION` | `20` | ⛔ | Only if pinning runtime |

Shared Drive reminder: add the **service account email** to the Shared Drive/folder; use `supportsAllDrives: true` (already set in code).

---

## 3) Frontend Flow (docs/js/app.js)
1. User picks a blank (`#blankSelect`) → selector uses `manifest.json`; option value is the garment SKU, dataset holds preview filename for canvas.
2. User uploads art (`#artFile`/`#artFileBtn`) → local preview on canvas → POST multipart to `/.netlify/functions/upload-to-drive`; saves `fileId`, `orderNote`, `pendingEmail` in `window.orderState`.
3. App measures art size (inches) and derives DTF tier (`docs/config/tiers.js` → `orderState.currentTier`) and placement (front/back toggle).
4. User clicks “Checkout” → POST JSON to `/.netlify/functions/create-checkout` with `{ email, customerName, customerPhone, productId: <SKU>, placement, sizeRun, fileId, orderNote, tierIn?, readoutIn }`.
5. On success, browser is redirected to Stripe Checkout (`session.url`). Success/cancel return to `${SITE_URL}/success.html` or `/?canceled=1`.

---

## 4) Functions
### upload-to-drive.js
- Validates POST multipart via busboy; buffers/streams to Drive using SA credentials.
- Respects `DRIVE_FOLDER_ID` (if provided); sets `supportsAllDrives: true`.
- Response: `{ id, webViewLink }`. Common issues: malformed SA JSON, missing folder access.

### create-checkout.js
- Builds `line_items` per item: garment price (from SKU) + DTF decoration price (tier + placement). Validates quantity and art size (blocks >16" and qty ≥36).
- Shipping: count-based UPS Ground from `config/shipping.json`.
- Stripe Checkout session: `mode: 'payment'`, `automatic_tax: { enabled: true }`, metadata includes fileId/orderNote/customer info + items snapshot.
- Errors: “Unknown garment SKU” if selector value isn’t one of the four SKUs; size >16" throws 400; qty ≥36 throws screenprint-only error.

### stripe-webhook.js
- Verifies Stripe signature using raw body + `STRIPE_WEBHOOK_SECRET`.
- On `checkout.session.completed`, writes **PAID** row to Google Sheet (idempotent on `session.id`). No pending/quote rows anywhere.

---

## 5) Pricing & Shipping Maps
- **Garment SKUs (UI value → Stripe price lookup in `config/prices.js`):** `tee-light-white`, `tee-light-black`, `tee-heavy-white`, `tee-heavy-black`.
- **Decoration SKUs:** `dtf-<tier>-<placement>` where `tier` ∈ {4,8,12,16} from art size/readout; `placement` ∈ {front, back}. Prices in `config/prices.js` `DTF_PRICE_IDS`.
- **Manifest:** `docs/assets/shirt_blanks/manifest.json` holds `sku` + `file` for preview; front/back entries share same SKU so pricing stays correct while reusing art.
- **Shipping:** `netlify/functions/config/shipping.json` count brackets → fixed UPS Ground rate (tax exclusive).
- If you get “Unknown garment SKU”, sync manifest `sku` values with `GARMENT_PRICE_IDS`.

---

## 6) API Contracts (quick reference)
- `POST /.netlify/functions/upload-to-drive` — multipart `file`, optional `customer_email`, `order_note`. Returns `{ id, webViewLink }`.
- `POST /.netlify/functions/create-checkout` — JSON body (see §3 step 4). Returns `{ url }` on success or plain-text error.
- `POST /.netlify/functions/stripe-webhook` — Stripe-signed events; no direct client use.

---

## 7) Troubleshooting (fast)
- Upload fails/502 → check Netlify logs; confirm `GDRIVE_SERVICE_KEY` JSON is intact; ensure SA has Drive access; ensure multipart field is `file`.
- Checkout error “Unknown garment SKU” → selector value not in `GARMENT_PRICE_IDS`; check manifest `sku` and `config/prices.js`.
- Artwork too large (>16") or qty ≥36 → intentional validation; message returned as 400.
- Stripe “Invalid API key/price” → ensure `STRIPE_SECRET_KEY` matches mode/account of price IDs in `config/prices.js`.
- Webhook no-op → verify `STRIPE_WEBHOOK_SECRET`, that the dashboard endpoint points to your site, and Sheet ID/tab name `Orders` exists with column layout expected by code.

---

## 8) Ops Quickies
```bash
# Reachability (405 is OK on GET for POST-only functions)
curl -I https://<site>/.netlify/functions/create-checkout
curl -I https://<site>/.netlify/functions/upload-to-drive

# Test upload (replace file path)
curl -i -X POST "https://<site>/.netlify/functions/upload-to-drive" -F "file=@/tmp/test.png"
```

---

## 9) Legacy / Cleanup Notes
- `create-order.js` and any “pending”/quote flow are retired; paid-only path is live.
- `documentation_and_goals/ARCHITECTURE 070925.md` is older; use this doc as canonical. Keep the old file only if you need its historical ops snippets.
- `documentation_and_goals/cart v1 checklist.txt` appears legacy; safe to ignore unless reviving that flow.
