# Libra Library Management System

A bilingual (English / Amharic) library management application built with React, Vite, Express, Prisma, and PostgreSQL.

## Requirements

- Node.js 20 or later
- npm
- PostgreSQL

## Local setup

1. Install dependencies: `npm install`
2. Create a PostgreSQL database named `library_management` (or choose another name and update `DATABASE_URL`).
3. Copy `.env.example` to `.env`, then set the PostgreSQL connection string, a random `JWT_SECRET` of at least 32 characters, and the administrator email and password.
4. Generate the Prisma client and synchronize the PostgreSQL schema: `npm run db:generate` and `npm run db:push`.
5. Create or update the administrator account: `npm run seed` (or `npm run db:seed`).
6. Start the web app and API: `npm run dev`.

The web app runs at `http://localhost:5173`; the API runs at `http://localhost:4000`. The administrator signs in with the credentials configured in `.env`. The local frontend API URL is set in the ignored `.env.local`; `CLIENT_ORIGIN` can contain a comma-separated list of allowed frontend origins. Do not use development credentials in production.

## Features

- English and Amharic interface with persisted language preference.
- Authenticated librarian/admin workspace, role-aware API, request throttling for sign-in, and audit logs.
- Dashboard statistics, monthly circulation trends, category summaries, and recent activity.
- Searchable book and patron catalogs, inventory tracking, digital media uploads, and XLSX/DOCX import and export. DOCX imports require a table whose first row contains the exported field names. XLSX uses the patched official SheetJS 0.20.3 release from the SheetJS CDN; the outdated npm registry package is intentionally not used.
- Multi-book circulation transactions and per-book return processing with configurable daily late fees (`FINE_PER_DAY`, default 5 ETB).
- Dedicated active-returns workspace with borrower search, single returns, and atomic batch returns; each return updates availability and calculates late fees.
- Admin-configurable library name, browser app title, and English/Amharic interface text, persisted in PostgreSQL.
- Persistent global light/dark theme switch and animated page transitions.
- Admin-managed additional fields for books, patrons, and inventory, stored as serialized JSON text separately from typed core fields; fines and asset values use PostgreSQL double-precision fields.
- Fine calculation and payment collection; daily circulation statistics refresh automatically while the dashboard is open.
- Protected, validated PDF/audio uploads and delivery; uploads are limited to PDF and common audio formats and 50 MB. XLSX/DOCX imports are capped at 5 MB and 5,000 rows.
- Categorized digital resources (Textbooks, Reference, Fiction, Research Papers, Course Material, or Other), with media-type/category filters and staff deletion of both the media record and its uploaded file.
- Camera-based QR/barcode scanning for checkout and returns (requires HTTPS or localhost and camera permission).
- Daily overdue reminder emails with persisted per-book/per-day delivery records; configure SMTP to enable delivery.
- Separate staff and student/teacher sign-in with distinct role tabs; members can use their member code or email and are restricted to their personal portal. Admins can set or reset a portal password while adding or editing a patron, or use the dedicated password action; member codes can be custom or auto-generated. Passwords are stored as hashes on linked portal accounts; there is no public account registration.
- Member dashboard with active loans, due dates, currently accrued overdue fines, and returned-loan history; searchable catalog with online reservation requests and cancellation. Staff have a live-refreshing reservation queue to approve, issue (creating an active loan and updating book availability), or cancel requests.
- Authenticated PDF and audio previews in the member portal, with the same staff-only restrictions applied to all library management views and APIs.

## API outline

All endpoints below (except health and sign-in) require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Sign in and receive an 8-hour access token |
| GET | `/api/auth/me` | Read the signed-in account |
| GET | `/api/public/settings` | Read public library branding and interface text |
| GET, POST, PUT | `/api/admin/settings` | Read or update branding, default language, footer notices, and English/Amharic interface text (admin only) |
| PUT | `/api/settings` | Legacy update route for library settings (admin only) |
| POST, PUT | `/api/admin/change-password` | Verify the current password and set a new administrator password |
| GET | `/api/dashboard` | Dashboard aggregates and circulation charts |
| GET, POST | `/api/books` | Search and create books |
| PUT, DELETE | `/api/books/:id` | Update and remove books |
| GET, POST | `/api/patrons` | Search and create students or teachers; create accepts optional `memberCode` and portal `password` |
| PUT, DELETE | `/api/patrons/:id` | Update and remove patrons; update accepts an optional portal `password` to set/reset credentials |
| POST | `/api/patrons/:id/account` | Provision or reset a patron portal password (staff only) |
| GET | `/api/portal/loans` | Read the signed-in patron's own active loans, accrued fines, and history |
| GET, POST | `/api/portal/reservations` | Read the patron's reservations or submit a reservation request |
| POST | `/api/portal/reservations/:id/cancel` | Cancel the patron's own active reservation |
| GET, PUT | `/api/reservations` | Staff reservation queue and status management; fulfilling a reservation atomically creates a loan and decrements book availability |
| GET, POST | `/api/loans` | Search circulation history and issue multiple books |
| POST | `/api/loans/items/:id/return` | Return an item and calculate late fees |
| POST | `/api/loans/return` | Atomically return 1–100 active items and calculate late fees |
| POST | `/api/loans/scan/return` | Find a book by barcode/ISBN and return its oldest active loan |
| POST | `/api/loans/items/:id/fines/pay` | Record a fine payment |
| GET, POST | `/api/inventory` | Browse and register assets |
| PUT, DELETE | `/api/inventory/:id` | Update and remove assets |
| GET | `/api/media` | List uploaded digital resources (staff and signed-in members) |
| POST | `/api/media/upload` | Upload a PDF or audio resource with an optional category |
| DELETE | `/api/media/:id` | Delete a media resource and its stored file (staff only) |
| GET | `/api/media/:id/file` | Authenticated media file delivery |
| GET, POST | `/api/custom-fields` | Read fields or (admin only) add fields |
| DELETE | `/api/custom-fields/:id` | Remove a field (admin only) |
| GET | `/api/audit-logs` | Read audit history (admin only) |

`npm run db:reset` drops all data in the configured PostgreSQL database and recreates the schema; use it only when you intend to reset the database. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` in `.env` to enable daily overdue reminders; reminders are skipped with an explicit warning if SMTP is not configured. The client accepts `VITE_API_URL` as either the deployed API origin or its `/api` root; all frontend API requests, including borrowing and reservation deletes, use this centralized base URL. Configure `CLIENT_ORIGIN`, `UPLOAD_DIR`, and the database and signing secrets for the deployment environment. Store uploaded media on persistent private storage in production and back it up with the database. The browser-only document and spreadsheet parsers are build dependencies; the production API can be installed with `npm ci --omit=dev` after building the client and server.

Existing databases must apply the `MediaAsset.category` schema addition before running the updated API. For this project’s local setup, run `npm run db:generate` followed by `npm run db:push`; migration-based deployments can apply the included migration with Prisma Migrate.

## Notes for production deployment

For a production build, install all dependencies, configure the database URL, run `npm run db:generate`, `npm run db:push`, and `npm run build`; seed the admin account before pruning development dependencies. The build emits the static client in `dist/` and the compiled API in `dist-server/`. The API can then run with production dependencies using `npm start`.

Use HTTPS, a managed database, private persistent file storage, and a secret manager. Restrict CORS to the deployed client origin. Back up the database and uploaded media, rotate JWT secrets, and configure monitoring and a trusted SMTP relay. Camera access only works in secure browser contexts. Student/teacher login accounts must be created by library staff; patrons sign in with their member code or email and the password provided by staff. Distribute initial passwords securely and request a password change through approved operational procedures. Patron self-service password reset/email verification, push notifications, and a dedicated camera barcode scanner peripheral are outside this starter.

## Cloudflare Workers setup (configuration only)

The repository includes a Wrangler configuration with `nodejs_compat` and configures Prisma to use the PostgreSQL driver adapter. Before deploying, add the production values as Worker secrets:

```sh
npx wrangler secret put DATABASE_URL
npx wrangler secret put DIRECT_URL
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

These commands do not make the existing API Worker-compatible. The configured entrypoint is the current Express server, which calls `app.listen()` and uses Node filesystem-backed uploads; it is not a Workers module handler and cannot run on Workers as-is. Port the API to a Workers-compatible `fetch` entrypoint and replace local-disk uploads with persistent object storage before expecting deployment to work. For PostgreSQL connectivity from Workers, use Cloudflare Hyperdrive and initialize `PrismaPg` with its connection string in the Worker request environment; the current Node-style Prisma initializer reads `DATABASE_URL` and is suitable for local Node execution, not a substitute for wiring a Hyperdrive binding.
