# 🛡️ Dynamic Profit Protection — how it works

Dynamic Profit Protection is the bot's **trailing stop**. Its one job: once a trade
is in profit, **lock that profit in and let it keep growing — without ever giving
it all back**. It replaces a fixed "take profit at X / stop at Y" with a stop that
**ratchets up as the trade runs and never moves backwards**.

It is fully **tunable per user** from **⚙️ Bot Settings** with two numbers, and it
runs on every open position automatically.

---

## The two controls (⚙️ Bot Settings)

| Setting | What it means | Default |
|---|---|---|
| **Arm trailing +%** (`trailArmPct`) | The profit level where the trailing stop "wakes up" and starts protecting. Below this, only the initial stop-loss applies. | **0.5%** |
| **Trail gap %** (`trailGapPct`) | How far **behind** the running profit the stop sits. Smaller = locks more/tighter; larger = gives the trade more room to breathe. | **0.5%** |

Two more values come from your existing settings:

| Value | Meaning | Default |
|---|---|---|
| **Initial stop** (`SL %`) | The hard stop before the trail arms. | **−1%** |
| **Take-profit cap** | Profit level where the trade auto-closes (locks the win). | **+5%** |

> Dynamic Profit Protection is active when **Break-even** or **Trailing stop** is
> turned ON in settings (both default ON).

---

## The rule (plain English)

1. A trade opens. The stop sits at the **initial stop** (e.g. −1%).
2. The moment profit reaches **Arm %**, the stop jumps up to **break-even or better**.
   From here, **the trade can no longer become a loss.**
3. As profit keeps rising, the stop **follows it, staying `Trail gap %` behind** —
   always moving **up, never down**.
4. If price pulls back to the stop, the trade **closes at that locked-in profit**.
5. If profit reaches the **+5% cap**, the trade **closes immediately** with the full win.

The exact formula once armed:

```
locked profit % = max( 0 , current profit % − Trail gap % )
stop price (long)  = entry × (1 + locked profit %)
```

…and the stop **only ever ratchets up** — a dip in price never lowers it.

---

## ✅ Worked example (defaults: Arm 0.5% · Gap 0.5% · Initial stop −1%)

LONG **BTCUSDT**, entry **$100.00**:

| Price | Profit | What the stop does | Stop is now |
|---|---|---|---|
| $100.00 | 0.0% | Trade opens — initial stop only | **$99.00** (−1%) |
| $100.50 | +0.5% | **Armed!** lock = max(0, 0.5−0.5)=0 → break-even | **$100.00** (0% — can't lose now) |
| $101.00 | +1.0% | lock = 1.0 − 0.5 = **0.5%** | **$100.50** (+0.5% locked) |
| $101.50 | +1.5% | lock = 1.5 − 0.5 = **1.0%** | **$101.00** (+1.0% locked) |
| $101.20 | +1.2% | price **dips** → lock would be 0.7%, but the stop **never moves back** | **$101.00** (held) |
| $102.00 | +2.0% | lock = 2.0 − 0.5 = **1.5%** | **$101.50** (+1.5% locked) |
| $101.50 | +1.5% | price falls back **to the stop** → **CLOSE** | ✅ **closed at +1.5%** |

Net result: the trade ran to +2.0%, pulled back, and you **banked +1.5%** — instead
of riding it all the way back to a loss.

Alternative ending — if instead the price kept climbing to **$105.00 (+5%)**, the
**take-profit cap** closes it there for the full **+5%** win.

SHORT trades work the same way, mirrored (stop ratchets **down** as price falls).

---

## Tuning it for your style

| Goal | Arm % | Trail gap % | Effect |
|---|---|---|---|
| **Lock profit fast / scalp** | 0.3% | 0.2% | Protects very early, tight trail — banks small wins, exits quickly on a wobble. |
| **Balanced (default)** | 0.5% | 0.5% | Break-even at +0.5%, then trails 0.5% behind. Good all-rounder. |
| **Let winners run** | 1.0% | 0.8% | Arms later, wide trail — survives bigger pullbacks, aims for larger moves. |
| **Match the earlier "+0.5% → +0.1%" idea** | 0.5% | 0.4% | At +0.5% it locks +0.1%, then trails 0.4% behind. |

Rule of thumb:
- **Smaller Trail gap %** → locks more profit, but a normal wobble can stop you out sooner.
- **Larger Trail gap %** → more breathing room, but you give back more before the stop triggers.
- **Arm %** is just *when* protection starts — set it a little above typical 1-minute noise so you don't arm on a random tick.

---

## How it's enforced (so it actually works)

- **Server-side first:** when your Binance API key has **"Futures Algo Orders"**
  enabled, the bot places a real `STOP_MARKET` order on Binance at the locked level
  and **moves it up** as the trail ratchets — so it triggers **instantly**, even
  between checks.
- **Software watchdog fallback:** if the exchange-side stop can't be placed, the bot
  re-checks every position **every ~60 seconds** and closes it with a market order
  if price has crossed the locked stop. Safe, just not instant.

> Enable **Futures Algo Orders** on your Binance key for the tightest protection
> (no 60-second gap).

---

## What you see on the dashboard

The **🛡️ Dynamic Profit Protection** card shows, per open position:
- current profit %,
- the **locked stop** (the real, ratcheted stop — it never drops on screen, matching the engine),
- the live trail status ("arms at +X%" → "trailing Y% behind" → "closing at +5%").

The locked figure reflects your **actual** protective stop, so what you see is what
will execute.

---

*Implementation: `backend/src/modules/bot/engine.ts` (`evaluateProtection`) reads
`trailArmPct` / `trailGapPct` from your bot config; the +5% cap is `PROFIT_TAKE_CAP`
in `shared/src/index.ts`. The dashboard card lives in
`frontend/app/(app)/dashboard/page.tsx` (`DynamicProtection`).*
