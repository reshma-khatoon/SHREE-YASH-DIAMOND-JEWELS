# 💎 SHREE YASH DIAMOND JEWELS

A modern, elegant and responsive jewellery website designed for **Shree Yash Diamond Jewels**, featuring a premium shopping experience with beautiful jewellery collections, smooth navigation and an aesthetic luxury-focused interface.

## ✨ About The Project

**SHREE YASH DIAMOND JEWELS** is a premium jewellery website created to showcase different jewellery collections in an attractive and user-friendly way.

The website focuses on:

* 💍 Rings
* 📿 Necklaces
* 👂 Earrings
* 💎 Bracelets
* ✨ Diamond Jewellery
* 🌟 Featured Collections
* 🛍️ Product browsing and ordering

The design combines a clean modern interface with a luxurious jewellery aesthetic to create an engaging experience for customers.

## 🚀 Features

* ✨ Premium and elegant UI design
* 📱 Fully responsive design
* 💍 Multiple jewellery categories
* 🛍️ Product browsing experience
* 🔎 Easy navigation and product discovery
* 🖼️ High-quality jewellery imagery
* 💎 Price-on-request product details with configurable 14K, 18K and 22K purity options
* 📦 Product ordering experience
* 📞 Customer contact options
* 💬 WhatsApp/contact integration
* 📱 Mobile, tablet and desktop support
* 🎨 Smooth animations and interactive elements

## Backend Notifications

The site uses Vercel Node functions in `api/` for visitor sessions, contact inquiries, price inquiries, and confirmed orders. Supabase stores events and notification delivery status. Gmail SMTP sends email; Twilio sends SMS and approved WhatsApp Business template messages. Provider credentials are server-only and must never use a `VITE_` prefix.

Runtime packages: `@supabase/supabase-js`, `nodemailer`, `twilio`, and `zod`. Local development uses `express`, `dotenv`, `tsx`, and `concurrently`; tests use `vitest`.

### Local Setup

Requirements: Node.js 20.19+ or 22.12+.

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. Copy `.env.example` to `.env` and replace the placeholders with your provider settings. In PowerShell:

	```powershell
	Copy-Item .env.example .env
	```

3. Install packages and start the Vite frontend plus local API adapter:

	```powershell
	npm install
	npm run dev
	```

	The site is at `http://localhost:4173`; the local API listens on `http://127.0.0.1:3001` and Vite proxies `/api` requests to it. Do not run a separate Vite server on port 4173 at the same time.

4. Run automated checks:

	```powershell
	npm test
	npm run build
	```

### Environment Variables

`.env.example` contains the complete placeholder-only template. Required server variables are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, `SITE_ORIGIN`, `OWNER_EMAIL`, `OWNER_PHONE`, `OWNER_WHATSAPP`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_FROM`, and `TWILIO_WHATSAPP_CONTENT_SID`. `MAIL_FROM`, `CORS_ORIGINS`, and `VITE_API_BASE_URL` are optional; leave `VITE_API_BASE_URL` empty for same-origin APIs. Visitor SMS and WhatsApp are independently opt-in with `VISITOR_SMS_ENABLED` and `VISITOR_WHATSAPP_ENABLED`; both default to `false`, so a new browser session only sends an email alert.

### Provider Setup

**Supabase:** Create a project, run `supabase/schema.sql`, and copy the project URL and service-role key into server environment variables. The schema enables row-level security and grants no direct anonymous or authenticated table access. Never expose the service-role key to the browser.

**Gmail:** Enable 2-Step Verification on the owner account and create a Google App Password. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER` to the sender Gmail, and `SMTP_PASS` to the App Password. `OWNER_EMAIL` is the notification destination. Do not use the normal Gmail password.

**SMS:** Configure a Twilio SMS-capable sender and its account SID/auth token. Set the owner destination in `OWNER_PHONE` and the sender number in `TWILIO_PHONE_NUMBER`, both in E.164 format. Account verification, destination permissions, and any applicable regional sender/DLT registration must be completed in Twilio.

**WhatsApp Business:** Configure an approved Twilio WhatsApp Business sender and an approved Content Template containing one variable, `{{1}}`, for the concise alert text. Set the WhatsApp sender, owner destination, and template SID in `TWILIO_WHATSAPP_FROM`, `OWNER_WHATSAPP`, and `TWILIO_WHATSAPP_CONTENT_SID`. The backend sends template messages through Twilio's WhatsApp API; arbitrary browser-generated WhatsApp automation is not used. Template approval and recipient opt-in are required by WhatsApp/Twilio.

### Vercel Deployment

1. Import this repository into Vercel. `vercel.json` configures the Vite build output; files under `api/` deploy as serverless functions on the same origin.
2. Add all required backend variables from `.env.example` in the Vercel project's Environment Variables settings. Set `SITE_ORIGIN` to the production site's exact origin and `CORS_ORIGINS` to the production and permitted preview origins. Vercel's current deployment origin is also allowed using `VERCEL_URL`.
3. Keep `VITE_API_BASE_URL` unset/empty for same-origin production APIs. Never add Supabase service-role, SMTP, or Twilio secrets as `VITE_*` variables.
4. Deploy, then check the Vercel function logs for server-side provider failures. Do not add the local `.env` file to Vercel or Git; `.gitignore` excludes it.

### API Behavior And Verification

- `POST /api/visitors` records each page view and sends only one default email alert per browser session. SMS/WhatsApp visitor alerts are opt-in.
- `POST /api/inquiries` and `POST /api/price-inquiries` save sanitized form data before attempting notifications. The latter validates product-level purity availability.
- `POST /api/orders` validates products/purities server-side, creates a unique order ID, stores customer/order details, and uses the `Idempotency-Key` header to prevent duplicate orders and notifications on retries. Notifications are only attempted after the order is stored. Jewellery totals remain “To be confirmed (Price on Request)”.
- API limits are enforced atomically in Supabase: 120 visitor requests per IP per minute and 5 inquiry/order submissions per IP per hour. Only a salted hash of the IP is used for rate limiting; raw IP addresses are not stored.
- Notification providers are attempted independently. Failed/skipped/sent statuses are stored in `notification_deliveries`; a provider outage does not undo a saved inquiry/order or fail its successful response.
- `npm test` covers input validation, provider failure isolation, and WhatsApp template usage. To test real delivery, first configure Supabase, Gmail, and Twilio, then submit the Contact form, request a product price, and place an order. Confirm database rows and delivery statuses in Supabase and inspect the owner inbox/SMS/WhatsApp. Repeat an order request with the same idempotency key to verify it does not create a second order or alert. Disable one provider credential temporarily to check the others still deliver; restore it immediately afterward.

## 🛠️ Technologies Used

* **HTML5**
* **CSS3**
* **JavaScript**
* **Responsive Web Design**

## 📂 Project Structure

```text
SHREE-YASH-DIAMOND-JEWELS/
│
├── index.html
├── style.css
├── script.js
├── images/
├── assets/
├── pages/
└── README.md
```

> The exact folder structure may vary depending on the project's implementation.

## 🎯 Project Goals

The main goal of this project is to create a professional online presence for a jewellery brand where customers can:

1. Explore different jewellery categories.
2. Browse multiple jewellery designs.
3. View product information.
4. Easily navigate between collections.
5. Contact the jewellery store.
6. Place product enquiries/orders.

## 📱 Responsive Design

The website is designed to provide a smooth experience across:

* 💻 Desktop
* 💻 Laptop
* 📱 Mobile
* 📲 Tablet

## 🌐 Live Website

**Live Demo:**
https://shree-yash-diamond-jewels.vercel.app/

## 📸 Preview

Add screenshots of the website here:

```text
Add your website screenshots / GIF here
```

## 🔮 Future Improvements

Planned improvements may include:

* 🔐 User authentication
* 🛒 Advanced shopping cart
* ❤️ Wishlist functionality
* 🔎 Advanced product filtering
* 🗄️ Product database
* 👨‍💼 Admin dashboard
* 📦 Order management
* 💳 Payment gateway integration
* 📧 Order confirmation system
* 📊 Customer and order management

## 👩‍💻 Developer

**Reshma Khatoon**

Frontend / Full-Stack Developer

* GitHub: https://github.com/reshma-khatoon
* LinkedIn: https://www.linkedin.com/in/reshma-khatoon-dev/

---

⭐ If you like this project, feel free to explore the repository and check out the live website.
