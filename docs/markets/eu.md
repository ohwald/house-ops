# European coverage: market shortlist and open-data reality check

Nothing here is a fact source by itself — it is a **map of which sources are worth verifying**. Every entry in
`templates/official-sources.eu.yml` carries `verify_before_use: true`; what follows explains why the shortlist looks
the way it does, and where house-ops has to weaken its usual claims.

## Why these six markets

The deciding criterion was not popularity but **whether a deal price can be checked at the unit level by anyone**:

| Market | Transaction-level sold prices | Asset Registry/Cadastre | Typical UK-style pitfall already documented |
|---|---|---|---|
| 🇬🇧 UK (England & Wales) | ✅ HM Land Registry Price Paid Data, free, since 1995 | ✅ INSPIRE polygons, EPC register | Leasehold ground rent, service charges, cladding remediation |
| 🇮🇪 Ireland | ✅ PSRA Property Price Register, since 2010, weekly | ⚠️ fewer layers | mica/pyrite defects in some counties, vague addresses in the register |
| 🇫🇷 France | ✅ DVF (all notarised sales since 2014), Open Licence | ✅ Cadastre Etalab, Géorisques | DMTO surcharge, DPE rental bans, copropriété charges |
| 🇳🇱 Netherlands | ❌ no public sold-price register | ✅ Kadaster BAG/BRK, CBS (WOZ) | erfpacht ground lease, VvE reserves, soft-soil foundations |
| 🇩🇪 Germany | ❌ no nationwide open register | ⚠️ per-state BORIS land values only | GrESt spread 3.5–6.5% by state, cash-only closing costs |
| 🇪🇸 Spain | ❌ no public sold-price register | ✅ Catastro (incl. Valor de Referencia) | Valor de Referencia tax base, unregistered extensions, Arras penalty deposits |

Tier-2 candidates deliberately not registered yet: **Nordics** (Denmark Datafordeler/BBR, Sweden Lantmäteriet,
Norway matrikkelen — all have good registries but no immediately usable per-deal price export), plus **Portugal** and
**Italy** (OMI zonal quotes exist in Italy, IMT/IMI in Portugal, but each needs its own sourcing pass before we put
anything in a registry file that AI will quote).

## What changes for the pipeline

1. **The `成交数据` tier is not universally available.** In DE/NL/ES the best achievable tier is usually
   `公开统计` (aggregate) or `开放登记` (cadastre). Following ADR-0002, that means those markets start at
   `suspect` and must inform the user that the listing-vs-transaction check **cannot** be completed with deal data.
2. **European listing portals are not registered as scraper modules.** Rightmove/Zoopla, Idealista/Fotocasa, Funda,
   ImmoScout24, SeLoger, Daft.ie are currently only reachable through the generic fallback checklist — we refuse to
   hand-write field selectors we have not verified. Adding one follows `scrapers/ADDING_A_PLATFORM.md`.
3. **Recurring costs beat purchase taxes for decision quality.** Service charges and ground rent (UK), erfpacht and
   VvE reserves (NL), copropriété arrears and DPE-driven refurbishment (FR), IBI plus comunidad (ES) are invisible
   in photos and dominate long-run cost.
4. **"Restrictions" are mostly not purchase bans.** EU markets have no purchase-qualification system like mainland
   China; the real gates are KYC/source-of-funds, lending caps, and — for a few countries not yet covered (Denmark,
   Austria, Switzerland) — permit requirements on foreign buyers.
5. **Cooling-off periods differ sharply and change negotiation tactics:** France gives 10 days after compromis,
   the Netherlands gives buyers 3 days, whereas Spain's Arras contract already carries penalties and England only
   binds at exchange. A "we can always walk away" assumption that is true in one market is expensive in another.

## Known conflicts, deliberately left visible

We found public sources that disagree. Both variants stay in `templates/policy-notes.eu.yml` marked
`conflict: true` so any report must surface the disagreement instead of picking a number:

- **Netherlands:** non-owner-occupied residential transfer tax after 2026-01-01 (10.4% vs 8%), and the 2026
  eigenwoningforfait thresholds.
- **Germany:** Bremen's Grunderwerbsteuer rate (5.5% per the 2025-07-01 increase vs still-listed 5.0% calculators).

Resolving them needs a primary-source check (Belastingdienst / Bremen Finanzamt) — exactly the kind of thing
house-ops insists a human verify rather than an AI average out.

## How to call it

```bash
node scripts/scan.mjs official --market eu      # all 17 European registry entries
node scripts/scan.mjs official 伦敦             # keyword across city / name / notes
node scripts/scan.mjs official dvf             # e.g. jump straight to the French registry entry
node scripts/scan.mjs official --market de      # one country only
```

Adding a market = adding one entry block to `templates/official-sources.eu.yml` plus one block to
`templates/policy-notes.eu.yml`. Both files are validated alongside the Chinese ones by the repo self-check.
