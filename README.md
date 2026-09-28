# Pure Vegi ordering platform

Online ordering, delivery slots, table ordering and booking, kitchen screen and admin for
Pure Vegi, 324 Soho Rd, Handsworth, Birmingham.

| Folder | What | Status |
| --- | --- | --- |
| `backend/` | Python FastAPI API, PostgreSQL | First version (this commit) |
| `admin/` | Staff web app: kitchen screen + admin panel (React + Vite) | First version |
| `web/` | Customer website: 3D hero, menu, delivery slots, checkout, tracking, table QR, booking (React + Vite) | First version |
| `app/` | Pure Vegi store app for Android + iPhone (Expo): website + push notifications | First version, see `app/README.md` |

## Loading animation photo

The loading circle shows `web/public/boy-photo.png` (the little Sikh boy eating Pure Vegi pizza).
Until that file exists it shows the animated drawing `web/public/loading-boy.svg` instead.
Use a square image; the face should be in the middle because it is cropped to a circle.

## Try it on GitHub (Codespaces)

1. On the repo page: **Code → Codespaces → Create codespace on main**.
2. Wait for setup to finish (first time a few minutes): it installs everything, creates a test database and an owner login.
3. The customer website opens on port 5173 (else **Ports** tab → 5173). Staff app (kitchen + admin): port 3000, log in with `owner@purevegi.co.uk` / `Test12345`.
   Place an order on the website, press the test **Pay** button, and watch it arrive on the kitchen screen.
4. API docs: Ports tab → port 8000 → add `/docs` to the address.

Codespaces is for testing; stop it when done (it uses the account's free monthly hours).

## Run locally

```bash
cp backend/.env.example backend/.env      # set PV_JWT_SECRET
docker compose up --build -d
docker compose exec api python -m app.seed --owner-email you@example.com --owner-password 'choose-one'
open http://localhost:8000/docs          # every endpoint, try them in the browser
```

Tests: `cd backend && pip install ".[dev]" && pytest`

Staff app (kitchen screen + admin):

```bash
cd admin
cp .env.example .env        # VITE_API_URL = where the API runs
npm install
npm run dev                 # http://localhost:3000, log in with the owner account from the seed step
```

Kitchen staff see only the kitchen screen; drivers see only **Deliveries** (made for phones: navigation,
call customer, picked up / delivered, live location). Owner and managers get everything.
On a phone, use the browser's **Add to Home screen** to install it like an app.

## What the backend does

- **Delivery slots**: 5–10 pm, 15-minute slots, capacity = drivers on shift x orders per driver. A full slot shows
  as booked; first come, first served (slot booking is locked so two people can't take the last place). A slot is held
  5 minutes while the customer pays. Orders placed early (1 pm for 7 pm) are pre-orders.
- **Delivery fee**: free within 2 miles, £2 beyond, up to the delivery radius (5 miles, to confirm).
- **Order steps**: placed → accepted (staff set ready time, or auto-accept) → cooking → ready →
  out for delivery / collected / served. Kitchen can add minutes when busy; customers are told the new time.
- **Notifications** at every step (app push, or SMS for guests), sent by the worker (`python -m app.worker`).
- **Google review prompt** after every delivered or collected order and after a table pays. Sent to everyone,
  no rewards (Google's review policy).
- **Dine-in**: QR per table opens a shared tab; bookings with a deposit that comes off the final bill.
- **Admin**: every number above is a setting (`PATCH /admin/settings`), plus menu, sold-out switch, offers and
  promo codes, staff roles, tables and QR codes, orders, sales report.
- **Payments**: Stripe PaymentIntents (card, Apple Pay, Google Pay) confirmed by webhook; refunds on reject/cancel.

## Before launch

- [ ] Real menu, prices, allergens, photos
- [ ] Stripe account + live keys, webhook URL
- [ ] Firebase (push) and Twilio (SMS) keys in `app/services/notify.py` `Sender`
- [ ] Google review link from Google Business Profile → admin setting `google_review_url`
- [ ] Confirm restaurant coordinates, delivery radius, minimum order, booking deposit
- [ ] Alembic migrations for production; Redis pub/sub if running more than one API server
- [ ] Tracking socket (`/ws/orders/{id}`) should require the customer's token before launch
