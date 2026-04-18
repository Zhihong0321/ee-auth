# EE-auth Service

Centralized Authentication Service for *.atap.solar.

## Features
- **WhatsApp OTP Login**: Authenticates users via WhatsApp message.
- **Shared Session**: Issues a JWT cookie (`auth_token`) scoped to `.atap.solar`.
- **User Validation**: Checks if the phone number is linked to a valid Agent Profile in the database.

## Prerequisites
- Node.js & npm
- PostgreSQL Database
- WhatsApp API Service URL

## Environment Variables (.env)
```bash
PORT=3000
DATABASE_URL="postgresql://user:pass@host:port/dbname"
JWT_SECRET="complex_secret_key"
WHATSAPP_API_URL="https://your-wa-api.com"
COOKIE_DOMAIN=".atap.solar"
```

You can also configure Postgres with split env vars instead of `DATABASE_URL`:

```bash
PGHOST="db.example.com"
PGPORT=5432
PGUSER="postgres"
PGPASSWORD="your-rotated-password"
PGDATABASE="app_db"
```

If you keep using `DATABASE_URL`, URL-encode special characters in the password. Raw characters like `@`, `:`, `/`, or `%` can break the connection string after a password reset.

## API Endpoints

### POST /auth/send-otp
Body: `{ "phoneNumber": "0123456789" }`
- Sends a 6-digit OTP to the user's WhatsApp.
- Returns 200 OK or error.

### POST /auth/verify-otp
Body: `{ "phoneNumber": "0123456789", "code": "123456" }`
- Verifies the code.
- Sets `auth_token` cookie.
- Returns user details.

### GET /auth/me
Headers: `Cookie: auth_token=...`
- Returns current user info if authenticated.

### POST /auth/logout
- Clears the session cookie.

### GET /health/live
- Liveness probe.
- Returns 200 if the Node process is running.

### GET /health/ready
- Readiness probe.
- Returns component status for configuration, PostgreSQL, and WhatsApp session.
- Returns 503 if a required dependency is unavailable.

### GET /health
- Full health summary.
- Returns 200 for `ok` or `degraded`, and 503 for `fail`.

## Development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm start
```
