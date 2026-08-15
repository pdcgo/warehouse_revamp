# Clarity — `event_library.md`

Critique, questions and warnings about [event_library.md](event_library.md). That doc is yours; this
one is mine. Answered points are **deleted**, so this is always the current open set.

> **Full re-examination.** `## Event Contact` and `## Encoding` have been removed, which retires four of
> my open points outright — the `Marshal`-does-not-validate critique, the protojson rename hazard, the
> "nothing enforces fields 98/99" critique, and the Dead-Letter-vs-Encoding trigger mismatch. All deleted.
> One consequence of the removal replaces them, below.
>
> ⚠ **The library is already built** (`pkgs/san_event`, item 4), so this doc is *documenting*, not
> designing, and a mismatch is doc-vs-code drift where only one side runs. Shipped already:
> `Claim(ctx, tx, e)` (`dedup.go:20`), `Handled`/`Duplicate`/`Rejected` all acked with `error`→nack
> (`receive.go:38`), `RejectHandler`/`Rejection` (`reject.go`), `Handler[T]` already taking the tx
> (`receive.go:78`).

---

# Contradiction

## `Event` is used in two signatures and no longer defined anywhere in the doc

`EventSender func(ctx, evt Event) error` and `MarkAsDeadletter(ctx, evt Event) error` both name the type.
`## Event Contact` — which defined it as `proto.Message` plus `GetEventId()` and `GetOccurredAtUnix()` —
is gone.

The code still has it (`san_event/event.go`), so nothing is broken; the doc is what became incomplete.
But it matters more than a missing definition usually would, because **`GetEventId()` is the dedup key**
and dedup is the one thing the receive half is built around. A reader now sees the whole receive design
without ever meeting the field it depends on.

**→ Put the interface back**, even as three lines. If it was removed as "already settled in code", that
is the argument for stating it — this doc is the description of that code.

## `DataEvent` has no event id, and the section that required one has been deleted

```proto
message DataEvent {
  option (san_event.topic) = "selling-topic";
  google.protobuf.Timestamp occured_at = 1
  oneof data { … }
}
```

No `event_id`. Previously that contradicted `## Event Contact`; now there is nothing left in the doc to
contradict, so it reads as intentional — which is worse, because `Claim` has nothing to key on and
**dedup silently stops working**. Two deliveries of the same fact both look new.

⚠ `occured_at` is missing an `r`, and item 2 of the same section says *"don't rename field proto"* — so
the typo becomes permanent the moment an event ships.

**→ `event_id` on the envelope**, since the envelope is what crosses the wire.

## `san_event` at 50099 duplicates the option at 50001 — and the shipped reader will not see it

50099 is free, so the earlier collision with `request_policy` is resolved. What remains is that this
option already exists:

```proto
// proto/warehouse/event_base/v1/event.proto:12
message MessageEventConfig { string event_topic = 1; }
extend google.protobuf.MessageOptions { MessageEventConfig event_config = 50001; }
```

Same purpose, same shape, and its comment gives the doc's own rationale verbatim: *"the topic therefore
travels with the message: a publisher cannot send an event to the wrong topic, because it never names
one."*

⚠ **The consequence is silence, not an error.** `TopicName()` is implemented against 50001 —
`proto.HasExtension(opts, event_basev1.E_EventConfig)`, `event_source/event_source.go:63`. An event
declaring only `(san_event).topic` has no `event_config`, so `HasExtension` returns false and `TopicName`
reports no topic. Present in the `.proto`, invisible to the code that reads options — the failure
CLAUDE.md already names: *"it reads as a logic bug; it is a linking bug."*

**→ Use `event_config` at 50001**, or rename that extension. Two options declaring the same fact only
moves the question to which is authoritative.

## The scope claims sending; the sender is in a different package

Item 1 puts *"send event to message broker"* in scope, item 4 names `pkgs/san_event`. But `san_event` has
no sender — publishing lives in **`pkgs/event_source`**, which is also what the push-webhook template
imports. **→ Say which package owns sending**, or describe two.

---

# Critique

## `MarkAsDeadletter(ctx, evt Event)` cannot represent the case it exists for

The trigger is a **parsing error** — if the payload failed to parse, there is no `Event`. The signature
requires the thing whose absence caused the call.

**→ Take the raw message.** `san_event` has it: `IncomingMessage` (`receive.go:14`), carried on
`Rejection` with `Reason`, `Err`, `Subscription`, `Attempt`. The code notes why — **`EventID` can be
empty**, since decoding can fail before the id is readable, so a rejection keys on the broker's
`MessageID`.

Two more on that section:

- **A Pub/Sub topic with no subscription discards immediately.** Publishing to `deadletter` preserves
  nothing unless a subscription exists — nothing is retained for a future subscriber. If the review
  surface is "look at the deadletter topic", that subscription **is** the review surface, from day one.
- **Only parsing errors are routed.** A handler that decodes fine but can **never** succeed — a
  referenced row that will never arrive, a rule that cannot pass — has nowhere to go. That is
  `RepeatedFailure`, and it is the case the original "redelivery forever" line was about.

## The envelope does not fit the dispatch the library already has

`option (san_event.topic) = "selling-topic"` on `DataEvent` reads as deliberate — one envelope and one
topic per domain, which buys ordering within a domain and one subscription per domain. No objection to
the shape, and *"one webhook for one topic"* follows from it cleanly.

⚠ But `Register[T Event](registry, subscription, handler)` and `Handler[T Event]` dispatch **by concrete
type** (`receive.go:78,113`). With an envelope the wire type is always `DataEvent`, so either every
handler registers for `DataEvent` and switches on the `oneof` itself — losing the type safety the
generics exist for — or the library unwraps the `oneof` and dispatches on the set field.

**→ Unwrapping is the better half**: it keeps `Register[RestockAccept](…)` working and confines the
envelope to the wire. It is also a feature `san_event` does not have today, so it is work, not just
wording.

## "the broker is responsible" is true after acceptance — the gap is before it

Once Pub/Sub **accepts** a message it guarantees at-least-once, and the library should not reimplement
that. The risk is getting there.

```
COMMIT ────────────── gap ────────────── Publish accepted
   the row exists                        the guarantee starts here
   the event does not
```

Three ways the gap is not crossed, none reachable by a broker that never heard of the event: the publish
**returns an error** (the signature has one because this happens, and *"we don't mind"* leaves nobody
handling it); the process **dies before the call**; or the **ctx is cancelled mid-publish**.

⚠ The stock ledger reconciles stats from events, and all three stock flows publish *after*
`Close Transaction`. A lost event there is a stat that silently disagrees with the ledger — the failure
the two-ledger design and the midnight reconcile exist to prevent.

**→ Pick one:** an **outbox** (a decorator around `EventSender` — `NewOutboxSender(db, inner)`, one
implementation, every broker inherits it), **or** state that reconcile is the recovery — making it
load-bearing rather than a safety net, and requiring it to rebuild every affected metric from the ledger
alone. Neither is written down.

## The publish still inherits the caller's cancellation

The signature is right, but the ctx it takes carries the known bug: a publish handed the *request's*
context dies when the client disconnects, and the row it announced is already committed.

**→ Detach inside the implementation, not at the call sites** — `context.WithoutCancel(ctx)` plus a
publish timeout. Keeps trace values, drops the caller's cancellation, fixes every publisher at once.

---

# Question

1. **Does the `Event` contract come back into the doc?** I recommend yes — the dedup key lives there.
2. **Outbox, or reconcile-as-recovery?** The same question
   [`stock_design_clarity.md`](stock_design_clarity.md) asks of the three stock flows. One answer settles
   both.

---

# Awaiting

- **`## How Each Service Register Pull Event Worker Function.`** — *"incomplete, still thinking"*, and
  `## Pub/Sub Push (Http Push) implementation.` is one line in.
- **The `# Every Service Rule.` split separated a matched pair.** *Register Http Push Webhook* moved under
  it; *Register Pull Event Worker Function* stayed under `# Event Library Architecture.`. Both are
  per-service obligations. (`## Pub/Sub Push … implementation.` is correctly left behind — that one is
  library internals.)
- **`NewMuxPushhandler` is misspelled** — `NewMuxPushHandler`, `event_source/push.go:41`. Worth fixing
  now the snippet is a `[ServiceName]` template about to be copied per service.
- **`topic string` is declared and never used** in that template. Naming the topic on the receive side is
  reasonable — a subscriber must subscribe to something — but the body should then use it.
- **Both `alt`s are unlabelled** while their `else` branches are named, so each renders as an unnamed box
  beside a named one. In push's `alt` the deactivation `-` is on the success arrow only, leaving a
  dangling activation bar on the error path.
- **sqlite as a dev broker** beats a loopback, but will not reproduce redelivery, ack deadlines or
  out-of-order delivery — a handler green against sqlite has been tested against Pub/Sub's shape, not its
  semantics.
