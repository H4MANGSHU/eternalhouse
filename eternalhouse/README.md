# EternalHouse — Style Never Dies

```
eternalhouse/
├── frontend/              ← everything the customer sees
│   ├── views/             EJS page templates (home, shop, product, cart, checkout, orders, admin…)
│   └── public/
│       ├── css/app.css    styles
│       ├── js/app.js      browser code
│       └── media/<ID>/    product films (product.mp4) and, optionally, your own photos (1.jpg … 5.jpg)
└── backend/               ← server, data and tooling
    ├── src/               Express app: routes/, services/ (cart, orders, mail, art), auth/, db/, cache/, middleware/, config/
    ├── db/schema.sql      PostgreSQL schema
    ├── data/catalog.csv   918 products (118 original + 800 EternalHouse house line)
    ├── scripts/           seed, verify, gen-catalog, make-videos, reprice, test-mail
    └── .env.example       copy to .env
```
The backend renders the frontend templates and serves its static files (`src/config/paths.js` is the only place that
knows where `frontend/` is; override with `FRONTEND_DIR`).

## Run
```
cd backend
cp .env.example .env            # fill in DATABASE_URL, VALKEY_URL, keys
npm install
npm run seed                    # applies db/schema.sql and seeds the catalog
npm start                       # http://localhost:3000   (use localhost, not 127.0.0.1)
npm run verify                  # 81 end-to-end checks
node scripts/test-mail.js you@example.com   # real Brevo SMTP test
```
Manual accounts use name, email and a scrypt password hash; Google OAuth accounts are also stored in `users` and do not have a password hash. Both signup methods create a session. A signed-in user is required to view or change the cart. Run `npm run seed` after schema changes to apply migrations and seed the catalog.

Prices are ₹199–₹499 (enforced by a DB constraint). Photos/videos are generated illustrations; drop real files into
`frontend/public/media/<ID>/` and re-run `npm run seed` to use them.
