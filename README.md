# Gaming Login & GCash Payment Portal

A Node.js + Express + SQLite website with a customer order flow and a private admin dashboard. Payments are **manually verified** by the admin; uploading a screenshot does not prove that money was received.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env`.
5. Set `SESSION_SECRET` to a long random value (at least 32 characters). Example generation:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
6. Create your private admin account:
   ```bash
   npm run setup-admin
   ```
   There is no public admin registration.
7. Start:
   ```bash
   npm start
   ```
8. Open `http://localhost:3000`.

## First setup
- Visit the website and use **ADMIN LOGIN** at the bottom.
- Log in with the account created in step 6.
- In Website Settings, set your website name and prices, then upload your GCash QR image.
- Customers can now submit orders and payment screenshots.

## Deploy online
Deploy to a Node.js host that supports Node 20+ and persistent writable storage (for example, a VPS or a platform with a persistent disk).
- Set `NODE_ENV=production`.
- Set `SESSION_SECRET` to a strong random secret.
- Set `APP_ORIGIN` to your exact HTTPS site origin, e.g. `https://example.com` (no trailing slash).
- Set `PORT` if your host requires it.
- Run `npm install` and `npm run setup-admin` once against the persistent disk.
- Start with `npm start`.
- Use HTTPS. Never expose the admin password or `.env`.
- Back up `data/site.sqlite` and the `uploads/` directory together.

**Important storage note:** SQLite and uploaded images are stored on the server's local disk. Do not deploy on a serverless/free host with an ephemeral filesystem; orders and uploads may disappear after redeploy/restart. Use persistent disk or migrate database and file storage to managed services.

## Security notes
- Admin passwords are bcrypt-hashed.
- Admin pages and proof images require an authenticated session.
- Session cookies are HTTP-only and SameSite strict; secure cookies are enabled in production.
- Login and order endpoints are rate-limited.
- Image uploads are limited to JPG/PNG and 5 MB.
- Customer submissions are pending until you manually check the payment in your GCash account.
- Change the default site prices and upload your own QR before accepting orders.

## Project structure
- `server.js` — API, authentication, database, upload handling
- `create-admin.js` — one-time admin creation utility
- `public/` — customer page, admin dashboard, CSS and browser scripts
- `data/` — SQLite database and sessions (created at runtime)
- `uploads/` — QR code and payment proof images (created at runtime)
