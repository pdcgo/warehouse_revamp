# Event Authoring Rule.

How to write an event message that stays correct for as long as any consumer retains it.

Derived from the finalised design in [architectures/event_library.md](architectures/event_library.md).

**Scope: only what NOTHING ELSE can enforce.** The `Event` interface is enforced by the compiler,
`Marshal`/`Unmarshal` by the library, tag removal and renumbering by `buf breaking` in CI. None of that is
repeated here. Every rule below fails **silently** — it compiles, it validates, it produces plausible wrong
numbers, and nobody files a bug.

---

## 1. `event_id` is DERIVED from the row that caused the event. Never a UUID.

```proto
string event_id = 98 [(buf.validate.field).string.min_len = 1];
```

```go
EventId: fmt.Sprintf("stock-moved:%d", movement.ID)   // ✅
EventId: uuid.NewString()                             // ❌
```

**Why:** a redelivery and a replay are the same logical fact and MUST collide. A fresh id per publish defeats
dedup for the exact case dedup exists for — `Claim` returns `isNew=true` every time and the bucket is counted
twice.

**It fails silently.** A UUID compiles, passes validation, and dedups perfectly against itself.

---

## 2. `occurred_at_unix` is when the fact HAPPENED, from ONE authoritative clock.

```proto
int64 occurred_at_unix = 99 [(buf.validate.field).int64.gt = 0];
```

Not the publish time, not the retry time, not `time.Now()` at whatever line you are on. If the fact came from a
row, take the row's timestamp.

**Why:** consumers bucket by it. Two clocks for one fact put a boundary row in different days depending on who
reads it, and a republish with a fresh `time.Now()` moves a fact into the wrong day on replay.

**Never add a setter.** If anything can stamp this onto an empty event, "must be filled" is decorative — a
default turns a loud failure into a silent wrong day at month end. Only the publisher writes it.

---

## 3. An event carries CHANGE, never a level.

```proto
int64 delta = 3;      // ✅
int64 balance = 3;    // ❌
int64 on_hand = 3;    // ❌
```

**Why:** addition commutes, so deltas can be processed in any order — which is what lets each service choose
batch or streaming freely. A level is order-sensitive, so a consumer would have to sequence or sort, and the
library has no way to enforce that it did.

**The trade, stated:** a level self-corrects, a delta does not. A missing delta skews every later total forever.
That is the price of order-independence, and it is why a consumer that drops an event must know it did.

---

## 4. Put the UNIT and the MEANING in the field name.

```proto
int64 qty_units = 4;    // ✅
int64 qty = 4;          // ❌
```

**Why this one is different:** it is the rule that lets a tool do the work. `qty` can be silently repurposed
from units to cases — same tag, same type, every historical event now reads twelve times wrong, and no tool can
see it. `qty_units` **cannot** be repurposed without a rename, and a rename is structural, so `buf breaking`
catches it.

The repo already leans this way: `last_restock_unix`, `oldest_pending_unix`.

---

## 5. `reserved` on every removal — the NUMBER and the NAME.

```proto
reserved 7;
reserved "shipping_fee";
```

**Why:** a reused tag makes old stored bytes decode as the new field. When the types are compatible this is
silent garbage — a rebuild that succeeds and disagrees.

`role_base.v1` already does this for `ROLE_WAREHOUSE_LEADER`.

**Fields may be ADDED, never removed, renumbered or repurposed.**

---

## 6. Events carry FACTS, never references to mutable data.

Copy the value into the event. Do not send an id and let the consumer look it up later.

**Why:** the consumer reads it weeks or years later, by which time the referenced row has changed. Already this
repo's doctrine in `events.proto` — *"FROZEN AT ORDER TIME … a product moved to another team next month must
not rewrite who was owed"*.

Same failure as rule 4 in a different costume: meaning that drifted because the thing it pointed at changed.

---

## 7. Validation rules may LOOSEN, never tighten.

`Unmarshal` runs `protovalidate` on every read, including every read during a rebuild.

**Why:** tighten a `buf.validate` constraint and every stored event that no longer passes becomes
**unreadable** — discovered mid-rebuild, in production. `buf breaking` cannot see this: same tag, same name,
same type.

---

## Note

Rules 1, 2, 3 and 6 are enforced by **review alone**, which is the weakest mechanism here. If any of them starts
being violated in practice, the fix is to find a structural version of it — not to write a longer guideline.
