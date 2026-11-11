# H2WO STORE - Gaming Top-Up & Payment Platform

H2WO STORE is a full-stack web application designed for gaming top-ups featuring an integrated GCash manual verification payment workflow and admin approval panel for generating PAID receipts.

---

## Features
* **Catalog & Checkout:** Instant selection for Honor of Kings, Mobile Legends, and Crossfire Legends top-up packages.
* **GCash Payment Workflow:** Customers submit GCash reference numbers for verification upon checkout.
* **Admin Approval Panel:** Secure admin dashboard requiring authorization token (`x-admin-token`) to review, approve, or reject orders. Approval transitions order status to `PAID_APPROVED`.
* **Transaction Tracker:** Customers can look up real-time status and admin notes using their Transaction ID.

---

## Local Installation & Development

1. **Clone or extract the project repository.**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run the development server:**
   ```bash
   npm run dev
   ```
   *or*
   ```bash
   npm start
   ```
4. **Access in browser:**
   Open `http://localhost:3000` for the store frontend and `http://localhost:3000/admin.html` for the admin portal.

---

## Render Deployment Instructions

To deploy H2WO STORE on [Render](https://render.com):

1. **Create a New Web Service:**
   * Connect your GitHub repository containing the project files.
2. **Configure Build & Start Settings:**
   * **Environment:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
3. **Environment Variables:**
   * Add an environment variable in the Render dashboard:
     * `PORT` = `3000` (Render will also automatically assign `PORT`)
     * `ADMIN_TOKEN` = `h2wo_secure_admin_2026` (or your preferred secure password for the admin portal)
4. **Deploy:** Click **Create Web Service**. Render will build and deploy your application live!

---

## Project Structure
```text
h2wo-store/
├── package.json
├── server.js
├── database/
│   ├── db.js
│   └── migrations/
│       └── 001_initial_schema.js
├── routes/
│   ├── orders.js
│   └── admin.js
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── style.css
│   └── script.js
└── README.md
```
