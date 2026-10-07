# Shree Yash Diamond & Jewels

The storefront uses a small Express API. It saves valid cart leads, contact submissions, and orders to `data/submissions.jsonl` on the backend server. Email notifications are optional: without SMTP credentials, requests are still accepted and saved, and email sending becomes active once credentials are configured. There is no database, admin login, payment processing, SMS provider, or analytics backend.

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

The contact form, saved-cart requests, and orders are saved locally on the backend first. Checkout includes a **Save Cart & Request a Call** option that sends the customer's name, phone, optional email, selected products, quantities, and gold types to the API. When SMTP is configured, each submission also emails the owner. Email errors do not discard saved leads or orders. New order records include a generated order ID, customer details, delivery address, canonical product description/material/diamond details, selected gold purity, quantity, and date/time. Email notification status is returned as `sent`, `failed`, or `not_configured`.

## Email configuration

Optional backend variables:

- `OWNER_EMAIL`: where form submissions and order notifications should be delivered.
- `SMTP_HOST`: for Gmail, use `smtp.gmail.com`.
- `SMTP_PORT`: use `465` for SSL or `587` for STARTTLS.
- `SMTP_USER`: the sender email address.
- `SMTP_PASS`: an email-provider app password (for Gmail, create one after enabling 2-Step Verification). Leave blank until the client supplies credentials.

Optional:

- `MAIL_FROM`: sender display name/address.
- `CLIENT_ORIGINS`: comma-separated exact frontend origins allowed to call the API, e.g. `https://your-site.vercel.app,https://www.yourdomain.com`. Production checks each origin exactly. Local development accepts both `localhost` and `127.0.0.1` on the configured port.
- `VITE_API_BASE_URL`: empty locally; for production frontend builds, set this to the deployed Express API origin.
- `SUBMISSIONS_FILE`: JSONL file path; defaults to `data/submissions.jsonl`.

Never expose SMTP credentials through `VITE_` variables.

## Deployment

The Vercel project serves the Vite website only. Deploy the Express service separately to a Node.js host such as Render, Railway, or a VPS:

- Build command: `npm install`
- Start command: `npm start`
- Set `CLIENT_ORIGINS` to the exact Vercel website origin(s) in that service's environment settings. Add the production domain and any preview domain you actually use; separate values with commas. Set the SMTP settings later when credentials are available.
- Attach a persistent disk to the Express host and set `SUBMISSIONS_FILE` to a file on that disk; otherwise local JSONL submissions may be lost when the host replaces its instance.
- In Vercel → Project Settings → Environment Variables, set `VITE_API_BASE_URL` to the Express service's HTTPS URL (for example `https://your-api.onrender.com`) for Production and Preview as needed, then redeploy the website so the frontend bundle uses that URL.

There is no database. For local use, submissions remain in `data/submissions.jsonl` across restarts. For deployment, attach persistent disk storage and set `SUBMISSIONS_FILE` to that disk path. If SMTP is not configured, the backend still saves and acknowledges submissions; notification emails begin only after valid credentials are set.

API routes: `POST /api/cart-leads`, `POST /api/orders`, and `POST /api/contact`. These require no maps, database, payments, SMS, or login service.
