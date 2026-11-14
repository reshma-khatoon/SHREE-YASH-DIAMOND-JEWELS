# Shree Yash Diamond & Jewels

The storefront uses a small Express API. It saves valid contact and product enquiries to Supabase `inquiries`, cart leads to `cart_leads`, and orders to `orders`. Email notifications are optional: without SMTP credentials, requests are still accepted and saved, and email sending becomes active once credentials are configured. Admin login uses existing Supabase Auth accounts; there is no payment processing, SMS provider, or analytics backend.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env` if it does not exist. Set the backend-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the existing project. SMTP settings are optional; leave them blank to test saving submissions without email. Do not commit `.env` or expose the service role key through a `VITE_` variable.
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

The contact form, saved-cart requests, and orders are saved to Supabase before a success response is returned. Checkout includes a **Save Cart & Request a Call** option that sends the customer's name, phone, optional email, selected products, quantities, and gold types to the API. When SMTP is configured, each submission also emails the owner. Email errors do not discard saved leads or orders. New order records include a generated order ID, customer details, delivery address, canonical product description/material/diamond details, selected gold purity, quantity, and date/time. Email notification status is returned as `sent`, `failed`, or `not_configured`.

The Supabase URL is available in the project dashboard's Connect or API settings. The legacy `service_role` key is in Project Settings → API Keys → Legacy API Keys. It bypasses row-level security and must remain on the backend. Run `npx tsx server\test-supabase.ts` for a read-only connection check.

## Admin sign-in and dashboard

1. Review and apply `supabase/migrations/003_admin_dashboard.sql` in the Supabase SQL Editor for the project. It adds a separate `admin_status` to the three existing tables, enables RLS, and revokes direct client access. It does not change order fulfilment status. Do not rerun migrations 001 or 002 for this setup. The submission API uses the service role and remains responsible for writes.
2. The existing `public.admins` table authorizes accounts by email. In Authentication → Users, copy each authorized user's UID to the backend `.env` as `ADMIN_USER_IDS=<uid>`; separate multiple explicitly authorized UIDs with commas. A user must match both the UID allow-list and an email in `public.admins`. No registration system is provided. Set `SUPABASE_ANON_KEY` to the project's public anon key (or keep the existing `VITE_SUPABASE_ANON_KEY`). Never put the service role key in a `VITE_` variable.
3. Restart the backend and open `/admin/login` (or use the Admin icon in the navbar). Sign in with an existing authorized Supabase Auth account. The frontend stores the Supabase access token in per-tab `sessionStorage` so refreshes stay signed in; the backend revalidates the Supabase user, configured UID allow-list, and `public.admins` email on each admin API request. The dashboard's New/Read/Replied status is independent of order fulfilment status.

The access token expires according to the Supabase project's JWT expiry setting; there is no automatic refresh. Logout clears the browser token and calls Supabase sign-out, but Supabase access tokens cannot be revoked before expiry. A copied token may therefore remain usable until it expires, unless the user or admin authorization is removed. Use HTTPS wherever credentials and tokens travel over a network.

## Email configuration

Optional backend variables:

- `OWNER_EMAIL`: where form submissions and order notifications should be delivered.
- `SMTP_HOST`: for Gmail, use `smtp.gmail.com`.
- `SMTP_PORT`: use `465` for SSL or `587` for STARTTLS.
- `SMTP_USER`: the sender email address.
- `SMTP_PASS`: an email-provider app password (for Gmail, create one after enabling 2-Step Verification). Leave blank until the client supplies credentials.

Optional:

- `MAIL_FROM`: sender display name/address.
- `CLIENT_ORIGINS`: comma-separated exact frontend origins allowed to call the API, e.g. `https://your-site.vercel.app,https://www.yourdomain.com`. Production checks each origin exactly, including requests forwarded by the Vercel proxy. Local development accepts both `localhost` and `127.0.0.1` on the configured port.
- `VITE_API_BASE_URL`: leave empty locally and for the recommended same-origin Vercel proxy. Set it at frontend build time to the separate Express API's HTTPS origin only if intentionally bypassing the proxy.

Never expose SMTP credentials through `VITE_` variables.

For notification troubleshooting, inspect `notificationStatus` in the submission API response: `not_configured` means required SMTP settings are missing, `failed` means the send failed, and `sent` means the SMTP server accepted the message, not that it reached the inbox. Runtime logs identify the submission type, missing setting names, and safe SMTP error codes without logging credentials or customer details. For Gmail, check the app password and account security when the code is `EAUTH`; for connection errors check the hostname, port, and function duration. Check Spam and the recipient address if the SMTP server accepted the email. Environment changes on Vercel require a redeployment.

## Deployment

The Vercel project serves the Vite website and forwards `/api/*` through a Vercel Function to the **existing, separately hosted Express service**. It does not host the Express service itself. Deploy Express to a Node.js host such as Render, Railway, or a VPS:

- Build command: `npm install`; start command: `npm start`. Admin authorization does not depend on an in-memory session registry.
- On the Express host, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (or the existing `VITE_SUPABASE_ANON_KEY`), `ADMIN_USER_IDS`, and `CLIENT_ORIGINS`. `ADMIN_USER_IDS` must contain the UID of an existing Supabase Auth user whose email is also in `public.admins`. Add exact production and preview website origins to `CLIENT_ORIGINS`. Set SMTP variables only if notifications are required.
- In Vercel → Project Settings → Environment Variables, set `API_BACKEND_ORIGIN` to the Express service's **HTTPS origin**, for example `https://your-api.onrender.com`, with no path or `/api`. Set it separately for Production and Preview as needed. Leave `VITE_API_BASE_URL` empty for the same-origin proxy. `API_BACKEND_ORIGIN` is a runtime setting, not a credential; never put the service role key or SMTP credentials in any `VITE_` variable.
- If an existing `VITE_API_BASE_URL` is set in Vercel, the frontend sends requests directly to that origin instead of through the proxy. Remove it or leave it empty to use the proxy; alternatively keep it pointed at the same Express service and configure CORS accordingly.
- Redeploy Vercel after setting variables or changing this configuration. Redeploy/restart the Express service after backend changes or environment changes. Vercel's environment settings do not automatically configure the separate backend.

After deployment, `POST /api/admin/login` with `{}` should return a JSON 400 validation error, and unauthenticated `GET /api/admin/session` should return JSON 401. These checks do not require credentials or modify customer data. A real login requires the configured Supabase project and authorized account; verify login, refresh, logout, and denied access for an unauthorized user. If a proxy request returns 503, check `API_BACKEND_ORIGIN`; for 502, inspect Vercel Function logs and backend availability without sharing credentials.

Existing local JSONL files are not imported automatically. If SMTP is not configured, the backend still saves and acknowledges submissions; notification emails begin only after valid credentials are set.

API routes: `POST /api/cart-leads`, `POST /api/orders`, and `POST /api/contact`. These require Supabase but no maps, payments, SMS, or login service.
