# `legacy/pages/` — the screens

The legacy client's screens, ported as a **design reference** (owner: *"this legacy just for
reference, so no need backend implemented"*).

**All 89 screens are ported, and every one has a story.**

## ⚠ These pages do not fetch

Their original data layer targets a **different backend contract** — `selling_iface`,
`invoice_iface`, `accounting_iface`, `report_iface`, `order_iface`, `user_iface`,
`warehouse_iface` — none of which exists in this repo, and for invoicing, accounting and reporting
there is no equivalent service here at all.

So every page takes its rows as **props**, and its story supplies them from
[`../fixtures.ts`](../fixtures.ts) / [`../financeFixtures.ts`](../financeFixtures.ts). Two
consequences:

1. **The screens stay reviewable.** The design is the deliverable; it can be read and argued about
   without a backend behind it.
2. **Promotion is additive.** Wiring one up later means adding a `features/<domain>/queries.ts` hook
   *above* the page — not unpicking a fetch from inside it.

The data plumbing is deliberately NOT ported: `viewmodels/`, `actions/`, `stores/`, `data/`,
`parser/`, `remote/` — 85 files of the original — are all contract-specific.

## Layout

```
legacy/pages/
  <screen>/
    index.tsx           THE page; takes its data as props
    index.stories.tsx   one story per DECISION it embodies, plus its states
    components/         used by THIS screen and nothing else
  _<family>/            shared by SEVERAL screens of one family (the `features/` case)
```

⚠ **`components/` means ONLY THIS SCREEN.** The moment a second screen imports one, it belongs in
`_<family>/` or in [`../components/`](../components/).

## The shared family scaffolds

The single most important thing this port established: **several legacy "screens" are one screen
asked a different question.** Porting them independently is how they drift — one gains a margin
column, another keeps a stale label.

| scaffold | instantiated by | what actually differs |
| --- | --- | --- |
| [`_statistics/MetricScreen`](_statistics/MetricScreen.tsx) | 7 statistics screens | the dimension |
| [`_invoices/InvoiceListScreen`](_invoices/InvoiceListScreen.tsx) | 3 invoice lists | the direction |
| [`_invoices/InvoiceDetailScreen`](_invoices/InvoiceDetailScreen.tsx) | 2 invoice details | the direction |
| [`_invoices/HistoryScreens`](_invoices/HistoryScreens.tsx) | 9 history screens | the direction |
| [`_billing/BillingScreens`](_billing/BillingScreens.tsx) | 10 billing screens | the direction |
| [`_accounting/AdSpendScreen`](_accounting/AdSpendScreen.tsx) | 4 ad screens | the grouping |
| [`_financials/HoldScreen`](_financials/HoldScreen.tsx) | 2 hold screens | the subject |
| [`_shells/SectionShell`](_shells/SectionShell.tsx) | 12 section shells | title and tabs |

## The screens

| family | screens |
| --- | --- |
| Auth (5) | `login` · `register` · `forgot-password` · `forgot-password-reset` · `setup` |
| Errors (3) | `not-found` · `auth-error` · `no-permission` |
| Orders (8) | list · detail · create · draft-list · draft-finish · custom-list · custom-create · custom-detail |
| Stock (1) | `supplier-list` |
| Team (3) | `member-list` · `user-list` · `warehouse-list` |
| Dashboard (3) | `dashboard` · `dashboard-v1` · `dashboard-classic` |
| Notifications (3) | `notification-list` · `notification-detail` · `notification-legacy` |
| Statistics (8) | product · shop · team · supplier · user · cost · historical · product-cross |
| Invoices (15) | 3 lists · 2 details · 9 histories · overview · limits |
| Billing (13) | 8 direction-paired · create-log · create-log-adjustment · owe-limit · team-balance · team-detail |
| Accounting (12) | 4 ads · 3 ledger · 2 balance · 2 expense · adjustment |
| Financials (2) | hold-by-shop · hold-by-team |
| Shells (12) | one per legacy parent route |

## Three generations, kept side by side

`dashboard` / `dashboard-v1` / `dashboard-classic`, and `notification-list` / `notification-legacy`,
are the same screen at different points in its life. They are kept because the progression says
something none of them says alone — each revision added a way to **act** on what the screen showed,
where the earliest ones only reported. Nothing in the older ones is a proposal.

## ⚠ A standing note

CLAUDE.md's HARD RULE 1 exists so this system does not re-derive an accumulated design. A large part
of what is here — the whole accounting and billing product — is something this warehouse may never
have. Porting it as a **reference** is what was asked for and is a reasonable thing to hold. Nothing
in this folder should be read as a decision that this system will work the same way.
