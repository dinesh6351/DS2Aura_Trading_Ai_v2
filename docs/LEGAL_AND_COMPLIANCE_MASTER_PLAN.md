# ⚖️ LEGAL & COMPLIANCE — MASTER PLAN

**Positioning, the funds model, forbidden claims, and the required legal documents — the survival layer.**

> 🚨 **NOT legal advice.** This is the **highest-stakes** area for an AI crypto-trading product. A wrong positioning or claim can mean fines, bans, or being reclassified as an unlicensed financial service. **You MUST have a FinTech lawyer review positioning + every document before launch.** Crypto regulation differs by country and changes fast.
>
> See also: [Founder](./FOUNDER_MASTER_PLAN.md) · [Global](./GLOBAL_EXPANSION_MASTER_PLAN.md) · [Payments](./PAYMENT_GATEWAY_MASTER_PLAN.md).

---

## Executive Summary

Three decisions keep you on the safe side of the law:

1. **Funds model = Option A: NEVER touch customer funds (non-custodial).** Users connect their *own* exchange with *their own* trade-only API keys. You never hold, move, or pool funds. (Already how it's built — **do not change this**.) This single choice avoids custody, PMS/AIF, money-transmitter, and most fund-regulation.
2. **Positioning = "Trading Automation & Risk-Management Software" (a SaaS tool).** NOT investment advice, NOT a broker, NOT a fund, NOT "signals/tips." The user configures and controls their own strategy; you provide software.
3. **Claims = zero profit/return promises, ever.** Heavy, prominent risk disclosure. Crypto leverage trading can lose 100%+; say so.

---

## 1. User funds model (review + recommendation)

| Option | What | Regulation | Verdict |
|---|---|---|---|
| **A · Non-custodial software** ✅ | user's own account + keys; you never touch funds | lowest — you're a software vendor | **RECOMMENDED — keep** |
| B · Managed funds | you trade pooled customer money | **heavy**: PMS/AIF/fund licensing, custody, audits | ❌ avoid (years + crores) |
| C · Copy trading | users mirror a leader's trades | often **regulated as advice/portfolio mgmt** in many regions | ⚠️ avoid early |
| D · Signal-only | you publish buy/sell calls | "signals" can = **investment advice** (SEBI RIA / FCA) | ⚠️ riskier than A |

**Why A wins:** you are selling *automation software*, not managing money or giving personalized advice. No custody = no money-transmitter/fund rules; no advice = lower investment-adviser exposure. **B is a licensing mountain; C/D drift toward "advice" regulation.** Stay A.

> Implication: the platform earns **subscription fees** (ordinary service income). It does **not** earn a profit-share and does **not** hold crypto → the user's 30%/1%-TDS VDA crypto tax is **their** problem, not yours ([Tax doc](./TAX_AND_ACCOUNTING_MASTER_PLAN.md)). Another reason to stay non-custodial.

---

## 2. Positioning (what to call it)

| Candidate | Risk | Use? |
|---|---|---|
| **Trading Automation Platform** | low (software framing) | ✅ **primary** |
| **Risk Management Platform** | low, on-message (capital-preservation) | ✅ **co-primary** |
| Portfolio Analytics Platform | low | ✅ supporting |
| AI Research Platform | low–med (don't imply advice) | ⚠️ supporting |
| **Signal Platform** | **higher** — "signals" ≈ advice | ❌ avoid as the label |

**Recommended positioning:** *"A non-custodial **trading-automation and risk-management** software platform. You connect your own exchange, configure your own rules, and keep full control of your funds and decisions. It is **software, not financial advice**, and does **not** manage money or guarantee outcomes."*

---

## 3. Forbidden claims (legal landmines)

🚫 **Never** say: "guaranteed profit", "guaranteed returns", "no-loss", "risk-free", "X% monthly returns", "you will earn", "double your money", "passive income guaranteed", "beats the market", "can't lose."

**Why:** misleading/deceptive financial promotions → consumer-protection, fraud, securities/financial-promotion violations (e.g., UK FCA crypto-promotion rules, US FTC/SEC/CFTC, India consumer + advertising codes). Even *implying* it (testimonials showing big gains without disclaimers) is risky.

✅ **Safer alternatives:** "automate your strategy", "tools to help manage risk", "you stay in control", "designed to help avoid bad trades", "for educational/automation purposes", always paired with **"trading involves substantial risk of loss; past performance ≠ future results; only trade what you can afford to lose."**

---

## 4. Required legal documents (checklist)

> Start from reputable **templates** (Termly/iubenda/lawyer kits), then get a **FinTech lawyer** to review for the crypto-trading context.

| Document | Purpose | When required | Risk if missing |
|---|---|---|---|
| **Terms of Service** | the contract; limits liability; "as-is", arbitration, no-advice | **before any user** | unbounded liability, no recourse |
| **Privacy Policy** | data use/rights (GDPR, UK-GDPR, India **DPDP Act 2023**, CCPA) | before collecting any data | fines, app-store/processor rejection |
| **Cookie Policy** + consent | tracking disclosure/consent (EU/UK) | before EU/UK traffic | GDPR fines |
| **Risk Disclosure** | spells out crypto/leverage loss risk | **before any live trading** | liability when users lose; fraud exposure |
| **Trading Disclaimer** | "software, not advice; not a broker/fund; you decide" | sitewide + at signup/live-activation | reclassification as adviser |
| **Refund Policy** | refund terms (SaaS, not trading losses) | before taking payment | chargebacks, disputes, processor issues |
| **AML Policy** | anti-money-laundering stance | if you handle value / scale / KYC | regulatory exposure |
| **KYC Policy** | identity-verification approach | when required by law/processor | onboarding fraud, compliance gaps |
| **Acceptable Use Policy** | prohibited uses (abuse, illegal markets) | before launch | misuse liability |
| **Data Processing Agreement** | for processors/sub-processors (GDPR Art.28) | when serving EU business / using vendors | GDPR non-compliance |

**Mandatory UX gates:** a **Risk Disclosure + Disclaimer consent checkbox** at **live-activation** (explicit, logged in `AuditLog`), and a persistent footer disclaimer. Paper mode should also disclaim "simulated, not indicative of live results (fees/slippage differ)."

---

## 5. Regulatory radar (know your exposure)

| Jurisdiction | What to watch |
|---|---|
| **India** | SEBI Investment Adviser regs (avoid "advice"); VDA tax is the *user's*; FIU-IND VASP rules (you're non-custodial software, but confirm); DPDP Act 2023 (privacy) |
| **EU** | MiCA (crypto), GDPR, financial-promotion rules |
| **UK** | **FCA crypto financial-promotion regime is strict** — be very careful marketing to UK retail |
| **US** | SEC/CFTC if it looks like managed trading/advice; **state money-transmitter** (avoided by non-custodial); FTC on claims |
| **UAE / Singapore** | VARA/ADGM (UAE), MAS/PSA (Singapore) — crypto-aware regimes, licensing if you go custodial/advisory |

→ Detailed per-region in [Global Expansion](./GLOBAL_EXPANSION_MASTER_PLAN.md).

## Cost Estimates

- Templates: ₹0–10k. Lawyer review (FinTech): **₹30k–1.5L** (worth it). Ongoing: periodic review as you add regions.

## Risks

- Being reclassified as an **investment adviser / PMS / broker** → positioning + non-custodial + disclaimers mitigate.
- A single bad **marketing claim** → fraud/promotion liability → strict copy review.
- Privacy non-compliance (DPDP/GDPR) → fines + processor/app-store rejection.

## Alternatives

- If you ever want B/C/D models → expect **licensing** (don't, early).
- Geo-restrict the strictest markets (UK retail, certain US states) at launch.

## Step-by-Step Actions

1. Lock **Option A + software positioning + no-guarantee** rules across the whole product/site.
2. Draft all 10 documents from templates.
3. **FinTech lawyer review** before public launch.
4. Add the **live-activation risk-consent gate** (logged).
5. Geo-restrict where unsure; expand per [Global doc](./GLOBAL_EXPANSION_MASTER_PLAN.md).

## Timeline

Drafts during beta (Phase 3); lawyer-reviewed + published before **first revenue (Phase 4–5)**.

## Priority Checklist

- [ ] Non-custodial (Option A) — never touch funds.
- [ ] "Software, not advice" positioning everywhere.
- [ ] Zero profit/guarantee claims (enforce in copy review).
- [ ] ToS + Privacy + Risk Disclosure + Disclaimer + Refund live before payment.
- [ ] Risk-consent gate at live activation (audited).
- [ ] FinTech lawyer sign-off pre-launch.
