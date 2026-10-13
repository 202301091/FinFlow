# FinFlow

FinFlow is a full-stack financial transaction platform built to handle atomic money transfers between accounts with real-time updates, strict double-spend prevention, and guaranteed event delivery.

- **Live Application:** [https://fin-flow-taupe-alpha.vercel.app](https://fin-flow-taupe-alpha.vercel.app/)
- **Live Backend API:** [https://finflow-tcax.onrender.com](https://finflow-tcax.onrender.com)

---

## Why I Built This

Handling money in software is very different from building standard CRUD applications. If two users transfer funds to each other at the exact same millisecond, or if a user double-clicks "Submit" while on a slow mobile connection, standard database queries easily lead to deadlocks, negative balances, or duplicate charges.

I built FinFlow to work through the engineering challenges behind real payment ledgers:
- Preventing race conditions and deadlocks under concurrent load
- Ensuring payment requests are idempotent (retries never double-charge)
- Guaranteeing event publishing without dual-write bugs using the Transactional Outbox pattern
- Delivering real-time debit and credit notifications over Server-Sent Events (SSE)
- Enforcing secondary security authorization (6-digit transaction PIN) before money leaves an account

---

## System Architecture & How It Works

```
                     ┌─────────────────────────────┐
                     │     Next.js 16 Frontend     │
                     │  (Vercel - App Router, UI)  │
                     └──────────────┬──────────────┘
                                    │
                                    │ HTTPS + SSE Stream
                                    ▼
                     ┌─────────────────────────────┐
                     │    Node / Express Backend   │
                     │  (Render - Web Service)     │
                     └──────┬───────────────┬──────┘
                            │               │
            Row Locks + ACID│               │ Cache-Aside / Rate Limits
                            ▼               ▼
              ┌──────────────────┐    ┌─────────────────┐
              │ PostgreSQL (Pool)│    │  Upstash Redis  │
              │   (Supabase)     │    └─────────────────┘
              └─────────┬────────┘
                        │
                        │ Transactional Outbox (Polling with SKIP LOCKED)
                        ▼
              ┌──────────────────┐
              │   Apache Kafka   │
              │  Event Streaming │
              └─────────┬────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
   ┌─────────────────┐    ┌───────────────────┐
   │  Notification   │    │   Fraud Detection │
   │     Worker      │    │       Worker      │
   └─────────────────┘    └───────────────────┘
```

---

## Core Engineering Highlights

### 1. Atomic Transfers & Deadlock Prevention
All balance mutations run inside an isolated PostgreSQL transaction client. To prevent deadlocks when two accounts transfer money to each other simultaneously, account IDs are sorted lexicographically before acquiring row-level locks:

```javascript
// Deadlock-free row locking: always lock IDs in deterministic order
const [firstId, secondId] = [senderAccountId, receiverAccountId].sort();

SELECT id, balance, status FROM accounts 
WHERE id IN ($1, $2) 
ORDER BY id 
FOR UPDATE;
```

Inside that single database transaction:
1. Sender balance is checked under the lock (`balance >= transferAmount`).
2. Sender balance is debited and receiver balance is credited.
3. An immutable record is created in the `transactions` ledger.
4. A domain event is written to the `transaction_outbox` table.
5. All changes are committed together to guarantee complete consistency.

### 2. Idempotency (Double-Spend Protection)
Network requests can fail after the server processes a transfer but before the client receives the receipt. 

- The client generates and persists an `Idempotency-Key` UUID in `sessionStorage` for each transfer draft. Multiple rapid clicks or connection retries reuse the exact same key.
- The backend records the key and a SHA-256 hash of the request payload in PostgreSQL:
  - If a second request with the same key arrives while the first is running, it receives an immediate `409 Conflict`.
  - If a retry arrives after completion, the server returns the cached response from the database without re-debiting any balance.
  - If the payload differs for the same key, it returns `400 Bad Request`.

### 3. Transactional Outbox Pattern
Directly publishing to a message broker (Kafka) inside a database transaction causes dual-write bugs if Kafka is temporarily unreachable. 

Instead of calling Kafka directly during checkout:
1. The domain event (`TRANSACTION_COMPLETED`) is written directly into the `transaction_outbox` table inside the same atomic database commit.
2. An asynchronous background relay polls the outbox using `SELECT ... FOR UPDATE SKIP LOCKED`.
3. The relay delivers events to Kafka. If Kafka is down, the transfer still succeeds, and events safely publish once the broker recovers.
4. Consumers use a `processed_events` table for exactly-once processing deduplication.

### 4. Real-Time Notifications over SSE
Instead of clients polling the server every few seconds, the frontend maintains a single Server-Sent Events (SSE) connection:
- When a transfer completes, the sender and receiver accounts receive live debit/credit alerts.
- Includes a 25-second keepalive heartbeat (`: keepalive\n\n`) to prevent cloud proxies and load balancers (like Render or Cloudflare) from terminating idle connections.

### 5. Transaction PIN Security
Knowing an account password is not enough to send money. Each user sets up a separate 6-digit transaction PIN (bcrypt hashed). Any transfer attempt must supply the valid PIN to be authorized by the ledger.

---

## Tech Stack

- **Backend:** Node.js (ES Modules), Express 5, PostgreSQL (`pg` connection pool), Upstash Redis, KafkaJS, Pino logging.
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Framer Motion.
- **Database & Infrastructure:** Supabase (PostgreSQL with transaction pooler), Upstash (Serverless Redis), Render, Vercel (Edge Deployment).

---

## Project Structure

```
FinFlow/
├── backend/
│   ├── src/
│   │   ├── config/          # Database pool, Redis, Kafka, logger, Prometheus
│   │   ├── controllers/     # Route handlers (auth, accounts, transactions, SSE)
│   │   ├── database/        # schema.sql and database setup scripts
│   │   ├── events/          # Domain event definitions and payload validation
│   │   ├── middleware/      # JWT auth, rate limiting, error handling
│   │   ├── routes/          # Express route definitions
│   │   ├── services/        # Core ledger, outbox relay, idempotency, fraud scoring
│   │   ├── utils/           # ApiError, ApiResponse, Redis cache utilities
│   │   ├── workers/         # Kafka consumer workers (notifications, fraud)
│   │   ├── app.js           # Express application configuration
│   │   └── index.js         # Server bootstrapper & process signal handling
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── app/
│   │   ├── dashboard/       # Main overview with account cards & balances
│   │   ├── transactions/    # Ledger audit history with keyset cursor pagination
│   │   ├── create-account/  # Form to open savings/checking/investment accounts
│   │   ├── login/           # User authentication
│   │   ├── signup/          # User registration with password security rules
│   │   └── page.js          # Marketing landing page
│   ├── components/          # Navbar, TransferModal, SetPinModal, NotificationBell
│   ├── lib/                 # api.js client wrapper and idempotency storage helpers
│   └── package.json
│
└── README.md
```

---

## Database Tables

The database schema is defined in [`backend/src/database/schema.sql`](backend/src/database/schema.sql):

| Table | Purpose |
|---|---|
| `users` | User credentials, password hash, and 6-digit transaction PIN hash |
| `accounts` | Bank accounts linked to users with `CHECK (balance >= 0)` constraint |
| `transactions` | Immutable double-entry ledger records |
| `idempotency_keys` | Locks and cached responses for duplicate request suppression |
| `transaction_outbox` | Stored domain events for reliable asynchronous Kafka publishing |
| `processed_events` | Consumer idempotency deduplication per consumer group |
| `consumer_dlq` | Dead Letter Queue for poison-pill or repeatedly failing messages |
| `notifications` | User notification records and unread state |
| `fraud_evaluations` | Risk scores, heuristic trigger logs, and compliance review flags |
| `audit_logs` | Security and administrative audit trail with sensitive credential redaction |

---

## API Overview

### Authentication & Users
- `POST /api/v1/users/register` - Create a user account
- `POST /api/v1/users/login` - Authenticate and receive JWT
- `POST /api/v1/users/set-pin` - Configure or update 6-digit transaction PIN
- `GET /api/v1/users/pin-status` - Check if user has an active transaction PIN

### Accounts
- `GET /api/v1/accounts` - Fetch authenticated user's accounts (Redis cached)
- `POST /api/v1/accounts` - Open a new account (savings, checking, investment)

### Transactions
- `POST /api/v1/transactions/transfer` - Send money (requires `Idempotency-Key` and `transactionPin`)
- `GET /api/v1/transactions` - Fetch transaction ledger (supports Keyset Cursor or Offset pagination)
- `GET /api/v1/transactions/:id` - Fetch cryptographic transaction receipt

### Real-Time & Notifications
- `GET /api/v1/notifications/stream` - SSE stream for instant transfer alerts
- `GET /api/v1/notifications` - Paginated notification history
- `PATCH /api/v1/notifications/:id/read` - Mark single notification as read
- `PATCH /api/v1/notifications/read-all` - Mark all notifications as read

### Health & Observability
- `GET /health` - Database, Redis, and Kafka connectivity check
- `GET /metrics` - Prometheus metrics (transaction count, total amounts, latency)

---

## Running Locally

### Prerequisites
- Node.js 18 or higher
- PostgreSQL (local or cloud instance like Supabase)
- Redis (local or Upstash Redis URL)
- Kafka (optional, system falls back gracefully if Kafka is not present)

### 1. Backend Setup
```bash
cd backend
npm install

# Create environment file
cp .env.example .env # or configure values manually
```

Sample `.env` configuration:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/finflow
DB_POOL_MAX=20
JWT_Access_SECRET=your_jwt_secret_here
CORS_ORIGIN=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

Initialize tables and seed demo accounts:
```bash
npm run db:init
```

Start the backend API server:
```bash
npm run dev
```

### 2. Frontend Setup
```bash
cd ../frontend
npm install
```

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
```

Start the frontend development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---
