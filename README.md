# Shree Yash Diamond & Jewels

The storefront uses a small Express API. It saves valid contact and product enquiries to Supabase `inquiries`, cart leads to `cart_leads`, and orders to `orders`. Email notifications are optional: without SMTP credentials, requests are still accepted and saved, and email sending becomes active once credentials are configured. Admin login uses existing Supabase Auth accounts; there is no payment processing, SMS provider, or analytics backend.

## Run locally

Requirements: Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env` if it does not exist. Set the backend-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the existing project. For admin login, also configure the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as described below. SMTP settings are optional; leave them blank to test saving submissions without email. Do not commit `.env` or expose the service role key through a `VITE_` variable.
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

Adding a product to the cart only saves it in the visitor's browser and does not send an email; customer details and a cart notification are sent when the visitor chooses **Save Cart & Request a Call**.

Contact enquiries can also notify the owner through Meta WhatsApp Cloud API; setup is required below. The existing WhatsApp links remain visitor-initiated chats. The API reports `whatsappNotificationStatus` separately from email. `sent` means Meta accepted the request, not that it was delivered; delivery requires webhook verification.

The Supabase URL is available in the project dashboard's Connect or API settings. The legacy `service_role` key is in Project Settings → API Keys → Legacy API Keys. It bypasses row-level security and must remain on the backend. Run `npx tsx server\test-supabase.ts` for a read-only connection check.

## Admin sign-in and dashboard

1. Review and apply `supabase/migrations/003_admin_dashboard.sql` in the Supabase SQL Editor for the project. It adds a separate `admin_status` to the three existing tables, enables RLS, and revokes direct client access. It does not change order fulfilment status. Do not rerun migrations 001 or 002 for this setup. The submission API uses the service role and remains responsible for writes.
2. The existing `public.admins` table authorizes accounts by email. In Authentication → Users, copy each authorized user's UID to the backend `.env` as `ADMIN_USER_IDS=<uid>`; separate multiple explicitly authorized UIDs with commas. A user must match both the UID allow-list and an email in `public.admins`. No registration system is provided. Set backend `SUPABASE_ANON_KEY` to the project's public anon key (or use `VITE_SUPABASE_ANON_KEY`). Never put the service role key in a `VITE_` variable.
3. Set `VITE_SUPABASE_URL` to the same project URL as `SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` to the same project's public anon or publishable key. These two values are included in the frontend build and must not contain secret or service-role keys. Restart both the frontend and backend after changing local settings.
4. Open `/admin/login` (or use the Admin icon in the navbar) and sign in with an existing authorized account. The Supabase client stores the access and refresh tokens in browser local storage and refreshes the session automatically. A session can survive browser restarts until it expires, is revoked, or the admin logs out. The old per-tab session cannot be upgraded automatically; sign in once after deploying this change. The backend still revalidates the Supabase user, configured UID allow-list, and `public.admins` email on every admin API request. The dashboard's New/Read/Replied status is independent of order fulfilment status.

Logout clears the session on the current browser and attempts to revoke its refresh token. If the network is unavailable, the local session is removed but server-side revocation may fail; the error is displayed. Supabase access tokens cannot be revoked before expiry, so a copied token may remain usable until expiry unless authorization is removed. Local storage is accessible to scripts running on the site, so use trusted devices, protect against injected scripts, and log out on shared devices. Passwords and the service-role key are never stored in browser storage. Use HTTPS wherever credentials and tokens travel over a network.

Admins can permanently delete individual enquiries, orders, and cart requests after confirming the action. This deletes the underlying Supabase record and cannot be undone.

The dashboard counts all saved inquiries, orders, and cart leads, regardless of the current list page. “New” counts use `admin_status = 'new'`, not order fulfilment status. Counts refresh on dashboard entry, every 15 seconds while it is open, when the tab becomes visible, and after a status change or deletion. A count error is shown instead of treating a failed query as zero.

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
- `VITE_API_BASE_URL`: leave empty locally and for the recommended same-origin Vercel API. Set it at frontend build time to a separately hosted Express API's HTTPS origin only if intentionally using one.

Never expose SMTP credentials through `VITE_` variables.

For notification troubleshooting, inspect `notificationStatus` in the submission API response: `not_configured` means required SMTP settings are missing, `failed` means the send failed, and `sent` means the SMTP server accepted the message, not that it reached the inbox. Runtime logs identify the submission type, missing setting names, and safe SMTP error codes without logging credentials or customer details. For Gmail, check the app password and account security when the code is `EAUTH`; for connection errors check the hostname, port, and function duration. Check Spam and the recipient address if the SMTP server accepted the email. Environment changes on Vercel require a redeployment.

## WhatsApp contact notifications

1. Set up a Meta business, a WhatsApp Business Account, a registered sender number and an app with WhatsApp messaging permission. Obtain a server-side access token and phone number ID. The owner must opt in to receive notifications; during Meta testing add the recipient to the allowed test numbers. Template messaging may incur Meta charges.
2. Create and obtain approval for a body-only template with exactly four **positional** parameters in this order:

   ```text
   New enquiry
   Name: {{1}}
   Email: {{2}}
   Phone: {{3}}
   Message: {{4}}
   ```

   Use no header, buttons, or extra variables. For testing, use the same template name and language configured below.
3. Configure these backend-only environment variables on the host running the Express API: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OWNER_NUMBER` (international digits without `+`), `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` (for example `en`), and `WHATSAPP_API_VERSION` (a currently supported Graph API version, such as `vXX.0` as specified by Meta). Never use a `VITE_` prefix for the token. Redeploy after setting these variables.
4. Submit a test enquiry and inspect `whatsappNotificationStatus`: `not_configured` means settings are missing, `failed` means Meta did not accept the request or the message was too long, and `sent` means acceptance only. Safe logs contain configuration names, HTTP status or Meta error code, not customer data or tokens.

Template parameter whitespace is normalized to spaces. To avoid sending multiple chargeable messages, messages over 500 characters after normalization are not sent to WhatsApp and are reported as `failed`; the full enquiry remains in Supabase and Gmail is attempted independently. Saving always happens before either notification; a notification failure never deletes the enquiry.

## Deployment

The Vercel project serves the Vite website and rewrites `/api/*` to the Vercel Function in `api/index.ts`, which runs the existing Express app directly. The current function does not use `API_BACKEND_ORIGIN`.

- In Vercel → Project Settings → Environment Variables, configure backend `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_USER_IDS`, `CLIENT_ORIGINS`, and the SMTP and WhatsApp variables described above. Also configure frontend build variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same project's public URL and anon or publishable key. Set them for the appropriate Production or Preview environment. `ADMIN_USER_IDS` must contain the UID of an existing Supabase Auth user whose email is also in `public.admins`; include the exact website origins in `CLIENT_ORIGINS`.
- Leave `VITE_API_BASE_URL` empty for same-origin requests. If it points to a separate Express service, configure its backend variables and CORS on that service instead; Vercel variables do not configure a separately hosted API.
- Redeploy after changing variables or application code. Never expose the service role key, SMTP password, or WhatsApp access token in a `VITE_` variable.

After deployment, `POST /api/admin/login` with `{}` should return a JSON 400 validation error, and unauthenticated `GET /api/admin/session` should return JSON 401. These checks do not require credentials or modify customer data. A real login requires the configured Supabase project and authorized account; verify login, refresh, logout, and denied access for an unauthorized user. For API failures, inspect Vercel Function logs without sharing credentials.

Existing local JSONL files are not imported automatically. If SMTP is not configured, the backend still saves and acknowledges submissions; notification emails begin only after valid credentials are set.

API routes: `POST /api/cart-leads`, `POST /api/orders`, and `POST /api/contact`. These require Supabase but no maps, payments, SMS, or login service.
