# Gorilla QuickTees – Architecture

_Last updated: YYYY-MM-DD_

## 1. Purpose
Web app for customer t‑shirt mockups. Future phases: accept payments via Stripe, upload full‑resolution artwork to Google Cloud, and send completed orders to production with automatic notifications.

---

## 2. Repo Layout

```
ARCHITECTURE.md
docs/
  index.html
  app.js
  style.css
  assets/
    shirt_blanks/
      Heavy_Black_Cotton_T.png
      Heavy_White_Cotton_T.png
      manifest.json
  js/
    bagel-select.js
    fitline.js
netlify/
  functions/
    create-checkout.js
    get-upload-url.js
    stripe-webhook.js
```

- **docs/** → site frontend (served by Netlify)
- **netlify/functions/** → serverless backend logic
- **ARCHITECTURE.md** → this reference file (not deployed)

---

## 3. Current Frontend Responsibilities
- Render shirt blanks + overlay uploaded artwork.
- Provide UI for sizes, placements, and mockup adjustments.
- Runs entirely client‑side at this stage.

Key files:
- `index.html` → app shell
- `app.js` → main app logic
- `style.css` → styling
- `js/bagel-select.js` → custom select UI
- `js/fitline.js` → text/fit helper
- `assets/shirt_blanks/*` → shirt blank images and manifest

---

## 4. Planned Backend Functions
Located in `netlify/functions/`.

- **get-upload-url.js** → returns a signed Google Cloud Storage URL for uploads.
- **create-checkout.js** → creates a Stripe Checkout Session with order metadata.
- **stripe-webhook.js** → triggered by Stripe after payment success; logs order, moves artwork into Google Drive (optional), and sends internal notification.

---

## 5. Customer Flow (Planned)
1. Customer uploads artwork → file stored in Google Cloud Storage via signed URL.
2. Customer enters specs + shipping info.
3. Netlify function creates Stripe Checkout Session.
4. Customer completes payment on Stripe.
5. Stripe webhook fires → order logged, artwork copied to Drive, internal email sent.
6. Customer redirected to success page; Stripe issues receipt.

---

## 6. Configuration (Secrets in Netlify)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GCP_PROJECT_ID`
- `GCS_BUCKET`
- `GCS_SERVICE_ACCOUNT_JSON`
- `INTERNAL_NOTIFY_EMAIL`

(No secrets committed to the repo.)

---

## 7. Maintenance Notes
- This file (`ARCHITECTURE.md`) is updated manually whenever structure or flow changes.
- Keep it short and high‑level: enough for collaborators (and ChatGPT) to catch up quickly.
