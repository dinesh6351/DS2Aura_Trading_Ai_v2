# 💰 SAAS MONETIZATION — MASTER PLAN

**Pricing tiers, limits, and unit margins for an AI crypto-trading SaaS.**

> ⚠️ Pricing is strategy, not law — but **how** you describe paid features has legal weight (no profit guarantees). See [Legal doc](./LEGAL_AND_COMPLIANCE_MASTER_PLAN.md). The *technical* plan-gating is in [SaaS Platform](./SAAS_PLATFORM_MASTER_PLAN.md); this doc is the **business** pricing + margin model.
>
> See also: [Founder](./FOUNDER_MASTER_PLAN.md) · [Finance](./FINANCIAL_PROJECTION_MASTER_PLAN.md) · [Payments](./PAYMENT_GATEWAY_MASTER_PLAN.md).

---

## Executive Summary

- **Value metric = capability + protection (exchanges, strategies, AI, risk, analytics) — NEVER trade count or "profit."** Charging per trade incentivizes overtrading (against the core principle) and "profit-share" creates custody/regulatory + tax nightmares. **Flat subscription only.**
- A **generous Free (paper-only) tier** is the growth engine: users watch the bot work risk-free, then upgrade to go live. It costs ~₹0 (shared data) and converts skeptics.
- Target **80–90%+ gross margins** (classic SaaS) — costs are mostly flat/shared; the variable cost is payment fees + a little AI.
- Recommended blended ARPU target: **~$20–30/user/mo**.

---

## 1. Plans

| | 🆓 **Free** | 🚀 **Starter** | 💎 **Pro** | 👥 **Team** | 🏢 **Enterprise** |
|---|---|---|---|---|---|
| **Price** | $0 | **$15/mo** | **$39/mo** ($390/yr) | **$99/mo** | custom |
| Mode | **Paper only** | Live | Live | Live | Live + dedicated |
| Exchanges | 1 (paper) | 1 | **5** | 5 | 5 + priority |
| Concurrent positions | 1 | 3 | 10 | 25 | custom |
| Strategies | 1 | 3 | full + clone | full + private | bespoke |
| Risk engine | basic | full | full + custom limits | full | bespoke |
| ML conviction | ❌ | ✅ gate | ✅ gate + ranking | ✅ | ✅ priority |
| LLM sentiment | ❌ | shared | shared | shared | + custom feeds |
| Backtesting | ❌ | limited | full | full | bulk |
| Seats | 1 | 1 | 1 | **up to 5** | custom |
| Notifications | in-app | + Telegram/email | + Discord/push | all | + SMS/webhooks |
| Analytics | basic | standard | advanced + export | advanced | API + raw export |
| API tokens | ❌ | ❌ | ✅ | ✅ | ✅ higher limits |
| Support | community | email | priority | priority | SLA + dedicated |

> **Team tier rationale:** small trading groups / signal communities / families who want shared billing + multiple seats. It's a cheap upsell (same infra) with high willingness-to-pay.

---

## 2. Unit economics & margins

Assume blended fee ~$30/mo. Per-user variable cost is tiny because infra/AI are **shared**.

| Cost per paying user/mo | Estimate |
|---|---|
| Payment processing (~3–5%) | ~$1.0–1.5 |
| Infra share (compute/DB) | ~$0.10–0.50 |
| AI (LLM sentiment, shared) | ~$0.05–0.20 |
| Support (amortized) | ~$0.5–2 (founder time → tool later) |
| **Total variable** | **~$2–4** |
| **Gross margin** | **~85–93%** |

> Margins are SaaS-classic because the heavy parts (regime, sentiment, models) are computed **once and shared** ([trading §18](./FINAL_TRADING_AGENT_MASTER_PLAN.md)). Costs grow **sub-linearly** with users.

---

## 3. Pricing tactics

- **Annual discount** (~2 months free) → improves cash + retention.
- **Free → Starter** is the key conversion (paper → live). Nudge after N successful paper trades.
- **Regional pricing (PPP)** for India/emerging markets to widen the funnel (e.g., ₹999/₹2,999 INR tiers).
- **Founding-member lifetime/locked price** for first 50 customers (early-revenue + loyalty).
- **No per-trade fees, no profit share** — ever.

---

## Cost Estimates

Build cost ≈ $0 (billing engine exists; only payment-provider integration needed — [Payments doc](./PAYMENT_GATEWAY_MASTER_PLAN.md)). Ongoing = payment fees + the flat infra/AI above.

## Risks

- **Profit-implying pricing copy** ("earn $X/mo") = legal risk → forbidden ([Legal](./LEGAL_AND_COMPLIANCE_MASTER_PLAN.md)).
- **Processor caps/holds** on "high-risk" crypto businesses → may withhold a rolling reserve; price in 3–5% fees + possible reserve.
- **Free tier abuse** → cap paper compute per free user; rate-limit.
- **Underpricing** a real-money tool → most users will pay more than $15 for something protecting capital; test higher.

## Alternatives

- **Usage-add-ons** (extra exchanges/seats) instead of pure tiers — optional later.
- **One-time lifetime deal** for early cash — risky long-term (support liability); use sparingly.

## Step-by-Step Actions

1. Ship **Free (paper)** + **Pro** first (simplest funnel), add Starter/Team/Enterprise after.
2. Wire entitlements as **config** (not hard-coded) so limits are admin-tunable.
3. Add annual + regional (PPP) pricing.
4. Instrument conversion (paper→live) + churn.

## Timeline

Pricing live with the payment integration in **Phase 4–5**.

## Priority Checklist

- [ ] Flat subscription only — **no** per-trade / profit-share.
- [ ] Free **paper** tier as the funnel.
- [ ] Pro + Free first; Starter/Team/Enterprise next.
- [ ] Annual + PPP pricing.
- [ ] All marketing copy passes the "no-guarantee" review.
