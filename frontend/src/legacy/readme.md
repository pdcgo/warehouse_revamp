# `legacy/` — the adopted legacy UI

The legacy client's interface, rewritten for React + Chakra v3 and kept in **its own namespace**
rather than merged into `src/components/`.

> The source is a **private** repo; this one is public. Nothing here names it, links it, or quotes
> its paths — only the component inventory and the design intent travel.

```
legacy/
├── components/   the design system — grouped by kind, one story per component
├── layout/       the shell: the chrome a legacy screen is mounted inside
└── pages/        the screens themselves
```

## Why it is separate

The live design system in [`src/components/`](../components/) is what a NEW screen reaches for. This
tree is a **staging area**: pieces arrived together from another system, they are still being
reconciled against what we already had, and some of them will turn out to be duplicates of a live
component that simply needs extending.

Keeping the two apart means a reviewer can always tell which they are looking at. Merging them now
would make that question unanswerable a week from now — and "is this ours or theirs?" is exactly the
question that has to stay cheap while the reconciliation is unfinished.

## The rules while it stays separate

1. **`legacy/` may import from `src/components/`; the reverse must not happen.** The dependency runs
   one way — toward the live system — so that deleting this tree is always possible. An app screen
   importing from `legacy/` would pin it in place permanently.
2. **Do not fork a live component into here.** Where we already had the component, the missing
   capability went into the LIVE one (`TeamSelect` gained `excludeTeamIds`, `Pagination` gained
   `showRange`). A second implementation is how two screens start disagreeing.
3. **Every component keeps its story beside it**, `title: "Legacy/Components/<Group>/<Name>"`, and an
   `export const description`. Same rule as the live system.
4. **Chakra v3 only** — no Tailwind, no `cn()`. Icons are **lucide** via Chakra's `<Icon>`.

## Where it ends up

Two possible endings for each piece, and both are fine:

- it is **promoted** — moved into `src/components/<group>/`, because a live screen now uses it; or
- it is **absorbed** — its one useful rule is folded into the live component that already did the
  job, and the legacy copy is deleted.

The tree is finished when it is empty. Track the mapping and the open decisions in
[plans/design-system-adoption.md](../../../plans/design-system-adoption.md).
