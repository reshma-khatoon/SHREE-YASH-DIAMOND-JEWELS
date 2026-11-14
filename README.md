# Shree Yash Diamond & Jewels

The storefront uses a small Express API. It saves valid contact and product enquiries to Supabase `inquiries`, cart leads to `cart_leads`, and orders to `orders`. Email notifications are optional: without SMTP credentials, requests are still accepted and saved, and email sending becomes active once credentials are configured. There is no admin login, payment processing, SMS provider, or analytics backend.

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
3. Restart the backend and open `/admin/login` (or use the Admin icon in the navbar). Sign in with an existing authorized Supabase Auth account. The frontend keeps only a short-lived server-issued session reference in per-tab `sessionStorage` so refreshes stay signed in; the backend revalidates the Supabase user, configured UID allow-list, and `public.admins` email on each admin API request. The dashboard's New/Read/Replied status is independent of order fulfilment status.

Admin sessions expire after at most one hour and are cleared on logout. The server-side session registry is in memory, so sessions end after a backend restart and are not shared across instances. Use HTTPS wherever credentials and tokens travel over a network. The browser clears its session reference even if logout fails; if the request cannot reach the server, its server-side session remains valid until expiry or restart.

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

Never expose SMTP credentials through `VITE_` variables.

## Deployment

The Vercel project serves the Vite website only. Deploy the Express service separately to a Node.js host such as Render, Railway, or a VPS:

- Build command: `npm install`
- Start command: `npm start`
- Set `CLIENT_ORIGINS` to the exact Vercel website origin(s) in that service's environment settings. Add the production domain and any preview domain you actually use; separate values with commas. Set the SMTP settings later when credentials are available.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as backend environment variables; never place the service role key in Vercel frontend variables.
- In Vercel → Project Settings → Environment Variables, set `VITE_API_BASE_URL` to the Express service's HTTPS URL (for example `https://your-api.onrender.com`) for Production and Preview as needed, then redeploy the website so the frontend bundle uses that URL.

Existing local JSONL files are not imported automatically. If SMTP is not configured, the backend still saves and acknowledges submissions; notification emails begin only after valid credentials are set.

API routes: `POST /api/cart-leads`, `POST /api/orders`, and `POST /api/contact`. These require Supabase but no maps, payments, SMS, or login service.
