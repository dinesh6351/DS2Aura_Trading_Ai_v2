# DS2AuraTrading AI — User Setup Guide

A step-by-step, **error-free** walkthrough to connect your own Binance account and
Telegram bot, test the bot safely in **Paper** mode, and then go **Live**.

Everything is configured from one web page: **Setup** (top nav) → `/settings`.
There are no environment variables to edit — each field validates before it saves.

---

## What you'll need (5 minutes)

1. A **Binance** account with the **USDⓈ-M Futures** wallet funded with USDT.
2. (Optional but recommended) the **Telegram** app, to receive trade alerts.

---

## Step 1 — Log in

1. Open the app (`http://localhost:3000` in local dev, or your deployed URL).
2. Register, or sign in. New accounts get a **30-day free trial**.
3. Click **Setup** in the top navigation.

---

## Step 2 — Connect your Binance Futures API key

> Your keys are validated against Binance, then stored **AES-256-GCM encrypted**.
> Plaintext keys are never logged or sent back to the browser. The bot only ever
> needs **trade** permission — **never withdrawals**.

1. Log in to Binance → profile menu → **API Management**.
2. **Create API** → **System generated** → name it (e.g. `DS2Aura bot`) → verify with 2FA.
3. Copy the **API Key** and **Secret Key** (the secret is shown only once — save it now).
4. **Edit restrictions** on the key:
   - ✅ **Enable Futures**
   - ❌ **Enable Withdrawals** — leave this **OFF**.
   - (Recommended) Restrict to your IP address.
5. Fund your **Futures (USDⓈ-M)** wallet with USDT.
6. Back in **Setup → Binance Futures API key**, paste both keys → **Validate & connect**.
   - If the key is wrong or missing Futures permission, you'll see a clear error — fix and retry.
   - After connecting, click **🔌 Test connection** to confirm — it shows your live balance.
   - If a ⚠ *withdrawal permission enabled* warning appears, go back to Binance and disable it.

---

## Step 3 — Connect Telegram alerts (optional)

Get a message in **your** Telegram every time the bot opens or closes a trade.

**Create your bot:**
1. In Telegram, open **@BotFather** → send `/newbot`.
2. Pick a name, then a username ending in `bot` (e.g. `my_ds2aura_bot`).
3. BotFather replies with a **token** like `123456789:ABCdef...` — copy it.
4. Open **your new bot** and press **Start** (send any message) so it's allowed to message you.

**Find your chat id:**
5. Message **@userinfobot** — it replies with your numeric **chat id**.
   - For a group chat: add **@RawDataBot** to the group and read the `chat.id` value.

**Connect it:**
6. In **Setup → Telegram alerts**, paste the **bot token** and **chat id** → **Save & send test**.
7. You'll get a confirmation message in Telegram. Done. (Use **Send test message** any time, or **Disable** to turn alerts off.)

---

## Step 4 — Configure trading

In **Setup → Trading configuration**:

- **Paper / Live toggle** (top):
  - **🧪 Paper** — simulated fills on live market data. **No real orders.** Start here.
  - **🔴 Live** — places **real** orders on your Binance account.
  - You can't switch modes while a position is open — close positions first.
- **Risk preset** — Conservative / Balanced / Aggressive (sets sensible defaults).
- **Numeric parameters** (tune freely):

  | Field | Meaning |
  |---|---|
  | Score threshold | Minimum 0–100 quality score to take a trade (higher = pickier) |
  | Leverage (×) | Futures leverage per position |
  | Margin / trade ($) | USDT margin committed per position |
  | Stop loss (%) | Hard stop distance from entry |
  | Take profit (R:R) | Reward:risk multiple of the stop (e.g. 3 = 1:3) |
  | Max positions | Concurrent open positions allowed |
  | Max trades / day | Daily trade cap |
  | Max consec. losses | Auto-pause after this many losses in a row |
  | Loss cooldown (min) | Pause window after a loss |
  | Margin guard (%) | Refuse new trades if used margin exceeds this % of balance |

- **Strategy filters & protection** — toggle the ADX/EMA/RSI/Volume/ATR filters and
  break-even / trailing-stop protection (mirrors the 19-condition engine).
- **Watchlist** — comma-separated symbols (e.g. `BTCUSDT, ETHUSDT, SOLUSDT`).
- Click **Save all settings**.

---

## Step 5 — Test in Paper mode (do this first!)

1. Make sure the toggle shows **🧪 Paper Trading**.
2. **Setup → Activate → ▶ Start bot.**
3. Watch the **Dashboard**:
   - **Live Signals** scores every watchlist coin in real time.
   - When a coin clears your score threshold, a **[PAPER]** position opens — visible in
     **Open Positions**, with SL/TP in **Protection Status**.
   - On exit you'll see it in **Trade History**, **Per-Symbol P&L**, and (if connected) a
     Telegram alert tagged **[PAPER]**.
4. Let it run through a few trades. Confirm signals, fills, SL/TP, and alerts all behave.

> Paper mode uses your **real balance** for display and the margin guard, but never
> sends an order to Binance — it's completely risk-free.

---

## Step 6 — Go Live

1. In **Trading configuration**, switch the toggle to **🔴 Live** (no open paper positions).
2. Double-check **margin / trade**, **leverage**, **max positions**, and **daily cap**.
3. **Setup → Activate → ▶ Start bot.**
4. The bot now trades your real Binance Futures account. Monitor the dashboard and Telegram.
5. **Pause** or **Stop** any time from Setup or the dashboard header.

---

## Reference — old Railway env vars → new web form

If you ran the original `claude-execute` bot on Railway, here's where each variable lives now
(everything is **per-user** in the database, set from the **Setup** page):

| Railway variable | Now configured as |
|---|---|
| `BINANCE_API_KEY`, `BINANCE_SECRET_KEY` | Setup → Binance (encrypted vault) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Setup → Telegram (token encrypted) |
| `LEVERAGE` | Leverage (×) |
| `MARGIN_PER_TRADE_USD` | Margin / trade ($) |
| `SCORE_THRESHOLD` | Score threshold |
| `SL_PERCENT` | Stop loss (%) |
| `TP_RR` | Take profit (R:R) |
| `MAX_CONCURRENT_POSITIONS` | Max positions |
| `MAX_TRADES_PER_DAY` | Max trades / day |
| `MAX_CONSECUTIVE_LOSSES` | Max consec. losses |
| `LOSS_COOLDOWN_MIN` | Loss cooldown (min) |
| `SYMBOL`, `WATCHLIST` | Watchlist |
| `PAPER_TRADING`, `TRADE_MODE` | Paper / Live toggle |
| `BINANCE_BASE_URL`, `BINANCE_FAPI_URL`, `BOT_PUBLISH_TOKEN`, `DASHBOARD_URL` | Platform-level (set by the operator, not per user) |
| `TRADING_HOURS_ENABLED` | Not used — the bot trades 24/7 |
| `MULTI_TF_CHECK`, `MIN_TF_AGREEMENT` | Built into the strategy engine |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not validate Binance key" | Re-copy key & secret; ensure **Enable Futures** is on; check IP restriction. |
| "This key cannot trade futures" | Enable **Futures** permission on the key in Binance API Management. |
| ⚠ "withdrawal permission enabled" | Edit the key on Binance and turn **Enable Withdrawals OFF**. |
| "Invalid Telegram bot token" | Copy the full token from @BotFather (format `digits:letters`). |
| "Telegram test failed — check chat id" | Press **Start** in your bot first; verify the numeric chat id from @userinfobot. |
| Bot won't start | Connect a valid Binance key first (Setup → Binance). |
| Can't switch Paper/Live | Close all open positions, then switch. |
| Bot paused after losses | It auto-pauses after *Max consec. losses*; review, then Start again. |
| Trades blocked / no entries | Normal — the score threshold keeps it patient. Lower it slightly or wait for setups (see the dashboard's "Why the bot held back" cards). |
