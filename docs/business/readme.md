# Business requirements

What the business needs, written by the owner.

```
docs/business/<big_context>/<small_context>.md
```

One `<big_context>` per domain (`stock`, `order`, `product`, `balance`, `ledger`, `settlement`,
`user`); `<small_context>` is the smallest slice that can go through the
[development lifecycle](../development_lifecycle.md) and be previewed.

**These docs are the owner's.** An agent may create exactly two files beside one, and nothing else:

| file | what it is | lifecycle |
| --- | --- | --- |
| `<small_context>_clarify.md` | the agent's critique, open questions and proposed design | the **current open set** — an answered point is deleted |
| `<small_context>_decision.md` | what the owner decided, recorded before it is acted on | **append-only** |

The technical answer to a business requirement lives at the same coordinates under
[../technical/](../technical/); how far it has got lives under
[../development_state/](../development_state/).
