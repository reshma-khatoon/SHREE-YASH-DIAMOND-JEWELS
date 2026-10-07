# Shree Yash Diamond & Jewels

The storefront uses a small Express API. It saves valid contact submissions and orders to `data/submissions.jsonl` on the backend server. Email notifications are optional: without SMTP credentials, requests are still accepted and saved, and email sending becomes active once credentials are configured. There is no database, admin login, payment processing, SMS provider, or analytics backend.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env`. SMTP settings are optional; leave them blank to test saving submissions without email. Do not commit `.env`.
2. Run:

   ```powershell
   npm install
   npm run dev
   ```

   Open `http://localhost:4173`. Vite forwards `/api` requests to Express on port `3001`.

3. Run checks:

   ```powershell
   npm test
   npm run build
   ```

The contact form, price inquiries, and orders are saved locally on the backend first. When SMTP is configured, each submission also emails the owner. Email errors do not discard saved forms or orders. New order records include a generated order ID, customer details, delivery address, canonical product description/material/diamond details, selected gold purity, quantity, and date/time. Email notification status is returned as `sent`, `failed`, or `not_configured`.

## Email configuration

Optional backend variables:

- `OWNER_EMAIL`: where form submissions and order notifications should be delivered.
- `SMTP_HOST`: for Gmail, use `smtp.gmail.com`.
- `SMTP_PORT`: use `465` for SSL or `587` for STARTTLS.
- `SMTP_USER`: the sender email address.
- `SMTP_PASS`: an email-provider app password (for Gmail, create one after enabling 2-Step Verification). Leave blank until the client supplies credentials.

Optional:

- `MAIL_FROM`: sender display name/address.
- `CLIENT_ORIGIN`: frontend origin allowed to call the API. Local development accepts both `localhost` and `127.0.0.1` on the configured port; production requires an exact origin match.
- `VITE_API_BASE_URL`: empty locally; for production frontend builds, set this to the deployed Express API origin.
- `SUBMISSIONS_FILE`: JSONL file path; defaults to `data/submissions.jsonl`.

Never expose SMTP credentials through `VITE_` variables.

## Deployment

The Vercel project serves the Vite website only. Deploy the Express service separately to a Node.js host such as Render, Railway, or a VPS:

- Build command: `npm install`
- Start command: `npm start`
- Set `CLIENT_ORIGIN` in that service's environment settings. Set the SMTP settings later when credentials are available.
- Attach a persistent disk to the Express host and set `SUBMISSIONS_FILE` to a file on that disk; otherwise local JSONL submissions may be lost when the host replaces its instance.
- Set `VITE_API_BASE_URL` to the Express service's HTTPS URL in Vercel, then redeploy the website.

There is no database. For local use, submissions remain in `data/submissions.jsonl` across restarts. If SMTP is not configured, the backend still saves and acknowledges submissions; notification emails begin only after valid credentials are set.
