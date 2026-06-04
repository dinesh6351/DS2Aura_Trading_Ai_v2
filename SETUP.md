# Complete Setup Guide (zero → running locally)

Follow top to bottom. Windows PowerShell commands. ~20–30 min.

> ✅ Already done for you: dependencies installed, Prisma client generated, `shared` built,
> and `backend/.env` created with your JWT + encryption secrets filled in.
> ❗ You only need to: (1) create a Supabase DB and paste 2 connection strings, (2) migrate, (3) run.

---

## Step 1 — Create the database (Supabase, free)

1. Go to **https://supabase.com** → **Start your project** → sign in with GitHub/Google/email.
2. Click **New project**.
   - **Name:** `claude-trading` (anything)
   - **Database Password:** click *Generate* → **COPY AND SAVE IT** (you'll need it in the URLs).
   - **Region:** pick the one closest to you.
   - **Plan:** Free.
3. Click **Create new project** and wait ~2 minutes while it provisions.

### Get the 2 connection strings
4. In your project: left sidebar → **⚙ Project Settings** → **Database**.
5. Scroll to **Connection string**. You'll see tabs/options. Grab these two **URI** values:

   | Put in `.env` as | Use this Supabase option | Port |
   |---|---|---|
   | `DATABASE_URL` | **Transaction pooler** (a.k.a. "Connection pooling") | 6543 |
   | `DIRECT_URL` | **Session pooler** *(or* **Direct connection** *if your network has IPv6)* | 5432 |

6. Each URI looks like:
   `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres`
   → replace **`[YOUR-PASSWORD]`** with the password from step 2.
7. For `DATABASE_URL` only, append **`?pgbouncer=true`** at the end (helps Prisma with the pooler).

> 💡 Free tier note: the plain **Direct connection** is IPv6-only. If your home network is IPv4,
> use the **Session pooler** string for `DIRECT_URL` — it works over IPv4 and is fine for migrations.

### Paste them into `.env`
8. Open [backend/.env](backend/.env) and replace the two `PASTE_…` placeholders. Example:
   ```env
   DATABASE_URL=postgresql://postgres.abcd:MyPass123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
   DIRECT_URL=postgresql://postgres.abcd:MyPass123@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```

---

## Step 2 — Create the tables (migrate) + seed admin

From `saas-platform/` in PowerShell:

```powershell
npm run db:migrate --workspace=backend
```
- When prompted for a migration name, type `init` and press Enter.
- This creates all 19 tables in your Supabase DB.

```powershell
npm run db:seed --workspace=backend
```
- Creates your first **ADMIN** login. Default: `admin@platform.local` / `ChangeMe!2026`
  (override with `$env:ADMIN_EMAIL` / `$env:ADMIN_PASSWORD` before running if you like).

> Verify in Supabase: **Table Editor** should now list `users`, `positions`, `bot_configs`, etc.

---

## Step 3 — Frontend env

```powershell
Copy-Item frontend\.env.example frontend\.env.local
```
(Default `NEXT_PUBLIC_API_URL=http://localhost:4000` is already correct for local.)

---

## Step 4 — Run it (two terminals)

**Terminal A — backend (API + bot worker + realtime):**
```powershell
npm run dev:backend
```
Wait for: `🚀 API listening { port: 4000 }`. Sanity check in a 3rd shell or browser:
`http://localhost:4000/healthz` → `{"ok":true}`.

**Terminal B — frontend:**
```powershell
npm run dev:frontend
```
Open **http://localhost:3000**.

---

## Step 5 — Use the platform

1. **http://localhost:3000** → redirects to **/login**.
2. Log in as the seeded admin (`admin@platform.local` / `ChangeMe!2026`) → lands on **/admin** (CRM).
3. To try the trader flow: open **/register**, create a normal user → you'll be sent to **/onboarding**:
   - **Step 2:** paste a Binance Futures API key + secret.
     - 🔑 Recommended first: use **Binance Testnet** keys (https://testnet.binancefuture.com) so no real
       money moves. The key is validated, then stored **encrypted**.
   - **Step 3:** pick a mode (Conservative / Balanced / Aggressive).
   - **Step 4:** Activate → you land on the live **/dashboard**.
4. The bot worker ticks every 60s; signals + positions stream in live over WebSocket.

> ⚠️ With real (non-testnet) keys and the bot active, it **will place real trades** on that account.
> Start tiny. Watch `/dashboard` and the bot log first.

---

## Common issues

| Symptom | Fix |
|---|---|
| `npm.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (done already) |
| `Environment variable not found: DATABASE_URL` | you didn't paste the Supabase URLs into `backend/.env` |
| `P1001 Can't reach database server` | wrong password in the URL, or use the **Session pooler** for `DIRECT_URL` (IPv4) |
| migrate hangs / `prepared statement` errors | make sure `DATABASE_URL` has `?pgbouncer=true` and `DIRECT_URL` is the 5432 string |
| backend boot crash about a secret | a secret in `.env` is blank — all three (JWT x2 + ENC) are pre-filled, don't clear them |
| `npm error code 1` on `argon2` | already installed fine here; if it recurs, `npm rebuild argon2` |

---

## Step 6 — Deploy (later, optional)

Local-first is enough to learn the system. When ready to go 24/7 for real users, follow
[docs/05-deployment-guide.md](docs/05-deployment-guide.md): **Backend → Railway**, **Frontend → Vercel**,
**DB → the same Supabase project** (or a separate prod one). Mind the **Binance 451** region note there.
