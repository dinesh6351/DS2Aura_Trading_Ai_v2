# 🌍 GLOBAL EXPANSION — MASTER PLAN

**Region-by-region readiness for a non-custodial crypto-trading SaaS.**

> ⚠️ **NOT legal/tax advice.** Crypto-promotion and trading-software rules vary sharply by country and change fast. Confirm each region with **local counsel** before marketing there. Geo-restrict where unsure.
>
> See also: [Legal](./LEGAL_AND_COMPLIANCE_MASTER_PLAN.md) · [Tax](./TAX_AND_ACCOUNTING_MASTER_PLAN.md) · [Payments](./PAYMENT_GATEWAY_MASTER_PLAN.md) · [Founder](./FOUNDER_MASTER_PLAN.md).

---

## Executive Summary

- **Stay non-custodial + software-positioned everywhere** → that's what keeps you out of per-country licensing. The variable across regions is mainly **(a) marketing/promotion rules, (b) privacy law, (c) tax collection.**
- **Launch order (easiest → hardest):** **India → Singapore/UAE → EU → UK → US (cautious).** The **UK (FCA crypto-promotion) and US (state + SEC/CFTC + sales tax)** are the strictest for retail crypto — approach last and carefully (or geo-restrict initially).
- **Use a Merchant of Record (if it accepts you)** to neutralize global tax complexity in one move ([Payments](./PAYMENT_GATEWAY_MASTER_PLAN.md)).

---

## Region matrix

| Region | Legal considerations | Tax | Privacy | Payments | Risk |
|---|---|---|---|---|---|
| 🇮🇳 **India** | SEBI (avoid "advice"); FIU-VASP (non-custodial software — confirm); VDA tax is the *user's* | GST 18% domestic; LUT exports | **DPDP Act 2023** | Razorpay/Cashfree | 🟢–🟡 home base |
| 🇸🇬 **Singapore** | MAS/PSA (licensing if custodial/advisory — you're neither); crypto-aware | GST (digital services) | PDPA | Stripe/MoR | 🟢 friendly |
| 🇦🇪 **UAE** | VARA (Dubai)/ADGM — crypto-progressive; licensing if custodial | VAT 5% | data-protection laws | Stripe/MoR | 🟢 friendly |
| 🇪🇺 **EU** | **MiCA**; financial-promotion rules; consumer protection | **VAT (OSS)** B2C digital | **GDPR** (strict) | MoR strongly preferred | 🟡 moderate |
| 🇬🇧 **UK** | **FCA crypto financial-promotion regime — strict**; clear-warnings, cooling-off | VAT 20% | UK-GDPR | MoR/Stripe | 🟠 high (marketing) |
| 🇺🇸 **US** | SEC/CFTC if it looks like advice/managed trading; **state money-transmitter** (avoided by non-custodial); FTC on claims | **state sales-tax nexus** | CCPA/CPRA (+states) | Stripe (US entity) / MoR | 🔴 highest (fragmented) |

```mermaid
flowchart LR
  IN["🇮🇳 India (home)"] --> SG["🇸🇬 SG"] --> AE["🇦🇪 UAE"] --> EU["🇪🇺 EU"] --> UK["🇬🇧 UK"] --> US["🇺🇸 US (cautious)"]
```

---

## Cross-region requirements (do once, reuse)

| Need | Solution |
|---|---|
| Privacy compliance | one strong **Privacy Policy** + DPDP/GDPR/CCPA rights (export/delete already partly built); cookie consent for EU/UK |
| Tax collection | **MoR** (Paddle/Lemon Squeezy) handles VAT/sales-tax globally — *if approved*; else register per-region at scale |
| Promotion compliance | **no-guarantee** copy + risk warnings everywhere; extra-strict for UK |
| Geo controls | IP-based **geo-restriction** for regions you're not ready for; region-aware disclaimers |
| Localization | currency display + PPP pricing; English first, localize later |

## Cost Estimates

- Privacy/legal templates + counsel review per region: **₹30k–2L** spread out.
- MoR fee (~5%) replaces most per-region tax cost.
- Geo-restriction + multi-currency: engineering time (low).

## Risks

- 🔴 **UK/US retail crypto promotion** → fines/bans if non-compliant → **geo-restrict until counsel clears**.
- Reclassification as adviser/broker in a strict region → keep non-custodial + software framing.
- Tax registration thresholds crossed silently → MoR or proactive monitoring.
- Data-transfer rules (EU→India) → DPA + appropriate safeguards.

## Alternatives

- **India + crypto-friendly regions only** (SG/UAE) for a long time — simplest, still a large market.
- Use MoR to "be everywhere" on tax without entities everywhere.

## Step-by-Step Actions

1. Launch **India** first (home tax/legal/payments).
2. Add **Singapore/UAE** (friendly, English).
3. Add **EU** with **GDPR + VAT (MoR)**.
4. Add **UK** only after **FCA-compliant** promotion review.
5. Add **US** last; consider US entity + state sales-tax (or MoR); geo-restrict strict states if needed.
6. Geo-restrict everything you haven't cleared.

## Timeline

India at launch (Phase 5–6); SG/UAE/EU over **months 10–18**; UK/US after counsel (Phase 7+).

## Priority Checklist

- [ ] Non-custodial + software positioning enforced globally.
- [ ] Privacy (DPDP/GDPR/CCPA) + cookie consent live.
- [ ] MoR for global tax (or per-region registration plan).
- [ ] Geo-restriction for un-cleared regions.
- [ ] UK/US only after local counsel sign-off.
