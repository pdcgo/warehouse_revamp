# Development state

How far each context has actually got.

```
docs/development_state/<big_context>/<small_context>.md
```

**Written by the agent, not by hand**, at the end of a pass through the
[development lifecycle](../development_lifecycle.md). Same coordinates as
[../business/](../business/) and [../technical/](../technical/), so one context is one lookup in
three trees.

It exists so the **next agent starts oriented** — what exists, what does not, what was decided and
where. It is a summary of state, not a changelog and not a design document: when it disagrees with
the code, the code is right and this file is stale.

## And a progress report per person

```
docs/development_state/<person>.md
```

The owner added this in
[business/project/member.md](../business/project/member.md) §Reporting — a finished slice of
*Design, Code, Implementing* is followed by a report, and the loop repeats
([progress-is-reported-per-person](../business/project/member_decision.md#progress-is-reported-per-person)).

**One entry per finished SLICE — never on a clock** — fired at the same moment as the context file
above, after `Audit RPC`
([a-report-fires-per-slice](../business/project/member_decision.md#a-report-fires-per-slice)).

**The two files are split by READER, and that is what decides what goes in them:**

| | reader | tense | reads for |
| --- | --- | --- | --- |
| `<big_context>/<small_context>.md` | the **next agent** | present — what is true now | what exists, what does not, what to pick up |
| `<person>.md` | the **product manager** | past — dated entries, newest first | what shipped, what it means, what is next |

⚠ **A PM entry must stand on its own.** It links down to the context file for detail, but never
depends on it — the reader will not open it, and does not know that `balance` is `liability` in the
code. Business words, one outcome, one next step:

```markdown
## 2026-08-27 · order / draft-promote
**Shipped:** a CS can turn a marketplace draft into a real order without retyping it.
**State:** ✅ done · ⚠ partial · ⛔ blocked — one line of why, in business words
**Next:** receiving
<sub>agent detail: [development_state/order/draft.md](order/draft.md)</sub>
```

⚠ **The person log never restates state — it links**, and it is **appended, never rewritten**. Where
the two files disagree, the context file wins. Two indexes over one set of facts is otherwise how the
pair drifts.

> **Known and accepted:** per-slice means this file is silent *while* a slice runs, so "still
> working" and "stopped" look identical here. That is the trade taken with
> [a-report-fires-per-slice](../business/project/member_decision.md#a-report-fires-per-slice).

**The reports:** [heri.md](heri.md) · [toni.md](toni.md). Hendra has none yet — he is on legacy and
[joins later](../business/project/member_decision.md#hendra-joins-later).
