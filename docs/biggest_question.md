# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. The open SET comes
> from `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment
> it is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> ⚠ **But the RANK is checked against the code, not only against the docs.** A rebuild that reads the
> clarify files alone cannot see that a question has been overtaken by what shipped — which is how
> four of seven rows went stale at once (see below). Before ranking a row, open the file it is about.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**, and merging those is most of what this file is for.

**105 open questions across 20 files.** The seven below are shown; **98 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

⚠ **−3 this round** — event_architecture **Q6, Q14 and Q15 are all closed**, every part of each decided, so **that file now has none open**. Net −2 across the session: Q15 opened when the encoding was decided and closed when its last part was applied. Recounted mechanically: 6e
was a PART of Q6, so deciding it narrows a question rather than removing one. Recounted mechanically (every
numbered item under a `# Question` or `## Question` heading, fenced code skipped): 109 items, less architecture
Q2, which is a pointer to order Q14 rather than an open question. The per-file table sums to the header.

> ## What changed this round
>
> ✅ **event_architecture Q15 is CLOSED and the change is APPLIED** — recorded as [ci-runs-on-dev-and-checks-breaking](technical/event_architecture/context_decision.md#ci-runs-on-dev-and-checks-breaking) and
> written into [ci.yml](../.github/workflows/ci.yml): CI now runs on every push to `dev` (the expensive `test` job
> held to `main` and PRs by an `if:`, since it pulls Postgres, Redis and a Playwright browser), and `buf breaking`
> is in the fast job against `HEAD~1` with `fetch-depth: 2`. The baseline was chosen by running both:
> `--against main` is **already red** from the RPC guideline migration, `HEAD~1` was clean.
> 🆕 **event_architecture now has NO open questions.** ⛔ What still blocks the first event there is a
> **contradiction**, not a question — see **#6**. **−1.**
>
> 🆕 **event_architecture 15c elaborated into the actual change**
> ([here](technical/event_architecture/context_clarify.md#15c--buf-breaking-in-ci-and-why)), and running it revised
> my own recommendation twice. ⛔ **`buf breaking --against main` is ALREADY RED on this repo** — the RPC guideline
> migration (`TeamListRequest.q` → `filter`), on `dev` and not on `main` — so a `main` baseline is red for the whole
> gap between a change landing and a promotion, which on this workflow is the normal state.
> `--against '.git#ref=HEAD~1,subdir=proto'` is **clean today** and trips exactly on the commit that renames
> something. ⚠ It must run from the repo ROOT and the checkout needs `fetch-depth: 2`. And the `dev` trigger wants
> an `if:` on the `test` job, which pulls Postgres, Redis and a Playwright browser per commit. ✅ Verified it starts
> green. **No count change.**
>
> ✅ **event_architecture Q14 is CLOSED, all four parts** — recorded as [identity-is-a-record-never-a-credential](technical/event_architecture/context_decision.md#identity-is-a-record-never-a-credential), as
> recommended: `identity = 5` (⚠ and under `protojson` the permanent choice is the NAME, not the digit) · a caller
> with none passes a shared `SystemIdentity(agent)` · the sender clears `expired_at` · and no consumer authorises
> from it, now a **fifth rule** on
> [one-contract-for-both-handler-types](technical/event_architecture/context_decision.md#one-contract-for-both-handler-types). ⚠ What it accepts, recorded:
> `SystemIdentity()` is the easy thing to reach for, and a call site inside a real request that reaches for it
> anyway loses the user with nothing detecting it — hence the required `agent` argument. ⚠ **The adopter checklist
> has grown by three this session** and wants one restating pass. **−1 — one question left in this file, Q15.**
>
> ✅ **event_architecture — breaking the old protos is accepted** — *"its okay breaking old, we follow this new
> design"*, recorded as [breaking-the-old-protos-is-accepted](technical/event_architecture/context_decision.md#breaking-the-old-protos-is-accepted). It answers
> my *"not yet"* objection to 15c: the one `buf breaking` failure is expected, so what is left is a commit ORDER —
> land the `event_base.v1` removal first, then add the CI step. ⛔ **It withdraws my dual-publishing
> recommendation.** ⚠ What it accepts, recorded: messages in flight at the cutover have no consumer, so an order
> placed in that window is never charged — the same silent post-commit gap **#1** names, arriving once and
> deliberately. **→ Recommend a consumer-first cutover** (liability reads both old and new for one deploy), which
> removes the window and costs less than the bridge. Q15 is now only the two CI lines. **No count change.**
>
> ✅ **event_architecture 15b decided** — *"for 15b, yes, we have new"*, recorded as
> [the-library-has-one-decoder](technical/event_architecture/context_decision.md#the-library-has-one-decoder): one decoder in the new `san_event`,
> `DiscardUnknown` then validate, and `event_source`'s `DecodeEvent` goes. The two-decoder contradiction is settled
> by decision — what remains is the code change. 🆕 **And *"why breaking?"* is answered**: `buf breaking` is the only
> check that compares the proto to its PREVIOUS SELF — lint, the generate-drift check and the tests all pass on a
> rename, and `go build` fails only until you update the Go, which goes green while the wire stays broken.
> 🔄 **I revised my own timing recommendation to NOT YET** — verified, it fails today on
> [event-base-v1-is-removed](technical/event_architecture/context_decision.md#event-base-v1-is-removed), and a check that is routinely overridden teaches people
> to override it. Q15 narrows to 15c. **No count change.**
>
> ✅ **event_architecture 15a decided** — *"yes one of is required"*, recorded as [the-event-oneof-is-required](technical/event_architecture/context_decision.md#the-event-oneof-is-required),
> as recommended: an `Event` with no variant set fails validation, so a renamed arm — or one a consumer has not
> regenerated — is recorded and ACKed instead of arriving as a valid envelope with no body. It fires at both ends,
> and it is what makes keeping `DiscardUnknown` safe (15b). ⚠ **Re-examined (RULE 11): no contradiction**, but one
> thing becomes load-bearing and irreversible — the `event_type` subscription filter is what removes 15a's only
> cost, and a filter is **immutable**, so the setup tool refuses to change one. It has to be right at creation.
> **→ Recommend it becomes a required step of the adopter checklist.** Q15 narrows to 15b · 15c. **No count
> change** — 15a was a part, not a question.
>
> 🆕 **event_architecture Q15 elaborated** into three parts
> ([here](technical/event_architecture/context_clarify.md#q15-part-by-part)), each verified by running it. They are
> not independent — **15a is what makes 15b's leniency safe**: `DiscardUnknown` alone turns a renamed or unknown
> `oneof` arm into a valid `Event` with no body, silently ACKed. ⚠ Two findings beyond the question: 15a's cost —
> rejection noise on consumers that have not regenerated — **is removed by the `event_type` subscription filter**,
> which promotes that filter from a nicety to a requirement · and ⛔ **CI never runs on `dev`**: the triggers are
> `push: [main]` and `pull_request`, and work goes straight to `dev` with no PR, so every check fires only at the
> merge to `main`. Adding `dev` to the triggers is worth more than `buf breaking` alone — `go vet` would then catch
> the by-value `identity` on the commit that introduces it. **No count change.**
>
> 🔄 **event_architecture — `context.md` line 20 changed, and it REVERSES a decision from earlier today.** The
> identity is now an explicit **parameter** of `EventSender`, recorded as
> [identity-is-a-sender-parameter](technical/event_architecture/context_decision.md#identity-is-a-sender-parameter);
> [superseded-the-sender-reads-identity-from-ctx](technical/event_architecture/context_decision.md#superseded-the-sender-reads-identity-from-ctx) is renamed and
> annotated, and every reference to it repointed (RULE 12).
> ✅ **It is the better shape** — a `ctx` value is invisible in a signature and a parameter cannot be omitted, so the
> compiler now enforces what the library was going to do by convention, and the causation chain is visible at the
> call site. ⛔ **But it does not compile as written**: `identity role_basev1.Identity` passes a proto message by
> value, and `go vet` — which CI runs — refuses it (verified against the real signature: *"copies lock value …
> MessageState contains sync.Mutex"*). The line-98/129 by-value contradiction is renamed to its CAUSE and widened to
> three sites. ⚠ Q14 · 14b moves from the library to the adopter checklist. **No count change.**
>
> 🆕 **event_architecture Q14 elaborated** into four parts
> ([here](technical/event_architecture/context_clarify.md#q14-part-by-part)), each checked against the code. The new
> finding is **14b — the identity chain breaks at the FIRST consumer**: user 57 places an order, liability consumes
> the event and publishes a ledger event whose `ctx` has no identity, so the ledger row says SYSTEM caused it — and
> the real answer was on the incoming event. One line in the adopter checklist keeps causation across every hop.
> **14a** shrank: under `protojson` the field NUMBER is not on the wire, so the permanent choice is the word
> `identity`, not the digit 5. **No count change.**
>
> ✅ ⛔ **event_architecture Q6 is CLOSED** — *"i choose one map"* settles its last part as [event-metadata-is-copied-into-the-attributes](technical/event_architecture/context_decision.md#event-metadata-is-copied-into-the-attributes),
> against my recommendation of two maps with no overlap: `Event.metadata` and the message attributes hold the same
> keys after a send. ⚠ **The cost is not the size cap** — it is that the caller and the library now share one key
> namespace, so a producer writing `metadata["event_type"]` breaks the subscription filter or is silently
> overwritten. Also recorded: a legal body value can lose the event to the attributes' 1024-byte cap (a key must
> also not start with `goog`), and `event_id` now exists three times. **→ One free guard:** `buf.validate` map
> rules mirroring Pub/Sub's own caps — they can never reject what the broker accepted. **−1.**
>
> 🆕 **event_architecture Q6 · 6f elaborated again** — *"whats mean one or two bag"*: the choice is now written as
> literal output rather than a metaphor
> ([here](technical/event_architecture/context_clarify.md#-the-meta-half--one-bag-or-two-spelled-out)). ONE map
> written to both `Event.metadata` and `Message.Attributes`, or TWO with different authors and no overlap. The
> deciding cost: an attribute value caps at **1024 bytes** and the body's map caps at nothing, so under ONE map a
> caller writing a long annotation loses the event to a broker error that does not name the key. What TWO gives
> up: a caller cannot filter on its own key. **No count change.**
>
> ✅ **event_architecture — identity is from `ctx`** — *"identity is from ctx"*, recorded as [superseded-the-sender-reads-identity-from-ctx](technical/event_architecture/context_decision.md#superseded-the-sender-reads-identity-from-ctx) — ⛔ **since reversed the same day**, see below —
> as recommended. The sender fills `Event.identity` by reading it, never a call site: `san_auth.GetIdentity(ctx)`
> already returns the exact type, and twelve handlers call it today. **Q6 · 6f elaborated** and now has one half
> left — whether `Event.metadata` and the message attributes are one bag or two. ⚠ **Found while grounding it:**
> `GetIdentity` ERRORS when nothing set it, and the access interceptor is the ONLY setter in the repo — so a pull
> worker, a push handler, `tools/san` and every backfill publish with no identity, which is the first real flow,
> not an edge. **Q14** narrows to the number, that case, `expired_at` and the trust rule. **No count change.**
>
> ⛔ **event_architecture 6e decided** — the owner added §How Event Encode and Decode: `protojson`, recorded as
> [events-are-encoded-with-protojson](technical/event_architecture/context_decision.md#events-are-encoded-with-protojson), against my recommendation of binary. The encode fork is recorded
> beside it as [meta-rides-in-the-body-and-the-attributes](technical/event_architecture/context_decision.md#meta-rides-in-the-body-and-the-attributes) — the meta attributes are written TWICE, into the body and
> into the message attributes, and the decode reads the body only.
> ⚠ **What it accepts, recorded:** under `protojson` the wire identity is the field NAME, so renaming a `oneof`
> arm — and the global `Event` is all `oneof` — drops the ENTIRE body to an unset oneof, and `DiscardUnknown`
> makes that a valid `Event` that is silently ACKed. `buf breaking` is configured in `proto/buf.yaml` and CI
> never runs it. **→ New Q15** proposes the three cheap guards. ⚠ **Re-examined (RULE 11):** the guideline's
> *"Protobuf, binary encoding"* is a nineteenth stale site, and the repo's two protojson decoders — `codec.go`
> lenient, `push.go` strict — are now a contradiction rather than a note. **+1.**
>
> ✅ **event_architecture Q4 decided** — *"for now we dont use bigquery or dump event to cloud storage"*
> ([no-archive-events-live-31-days](technical/event_architecture/context_decision.md#no-archive-events-live-31-days)): no archive, an event lives 31 days.
> ⚠ **Re-examined (RULE 11):** settlement's `order_created_by_user_id` rides on the event and sits on no table, so
> after 31 days it is unrecoverable — the unbuilt `the-creator-is-stamped-on-the-state-row` migration is now its
> only protection, and settlement's clarify says so. **−1.**
>
> ✅ **event_architecture Q3 decided, as recommended** — *"for q3 we use pubsub emulator"*
> ([dev-runs-the-emulator](technical/event_architecture/context_decision.md#dev-runs-the-emulator)): the emulator in dev, Pub/Sub in production, no sqlite broker, and the dev
> binary's in-process **loopback retired**. ⚠ What it costs a developer: the `pubsub` profile must be up, the setup
> tool re-run after every emulator restart (it keeps nothing, and nothing checks at boot), and a dev PUSH endpoint
> is `host.docker.internal:8080` — pull needs no route. An eighteenth guideline site goes stale. **−1.**
>
> ⛔ **event_architecture 6d decided** — *"stop publisher and close the client"* are the service's, recorded as
> [publisher-and-client-shutdown-is-the-services](technical/event_architecture/context_decision.md#publisher-and-client-shutdown-is-the-services),
> against my recommendation: `NewEventSender` returns no cleanup. It accepts one loss, stated: a send still retrying
> when a deploy exits is gone with no log line — the dev binary drains for 10 s, the client retries for 60. Q6
> narrows to 6e · 6f. No count change.
>
> 🆕 **The owner's `NewEventSender` now takes the client** (line 25, pseudocode type) — as 6d's sketch has it — but
> still returns only `EventSender`, so 6d's cleanup has nowhere to go. Every line reference below it shifted by
> one and is updated. No count change.
>
> 🆕 **event_architecture 6d elaborated** ([here](technical/event_architecture/context_clarify.md#6d--one-publisher-per-topic-and-a-cleanup)).
> ⚠ **A correction of my own**: the shipped sender's per-event publishers are NOT a goroutine leak in the v2.6.1
> client — each is garbage once its batch is sent. What is real: no batching, an ordering key made impossible,
> and a deploy during a Pub/Sub slowdown killing batched events with no log line. 6d's cleanup is what waits for
> them, and it changes `InitializeApp` to return one. No count change.
>
> ⛔ **event_architecture 6b decided** — *"return error as is"*, recorded as
> [sender-returns-the-client-error-as-is](technical/event_architecture/context_decision.md#sender-returns-the-client-error-as-is),
> against my recommendation: no wrapping, no sentinels. The caller's log line carries the `event_id`. Q6 narrows
> to 6d · 6e · 6f. No count change.
>
> 🆕 **event_architecture 6b elaborated** (since decided — [the decision](technical/event_architecture/context_decision.md#sender-returns-the-client-error-as-is)) —
> seven errors the sender can return, in three classes (bug · setup · outage), and three caller rules the live
> producer already follows — above all, a send error after the commit never fails the RPC, or the person at the
> shelf taps again and a second order exists. No count change.
>
> ✅ **event_architecture 6c decided** — *"ctx its used for bring custom and optional value if needed"*, recorded as
> [sender-ctx-carries-values-not-cancel](technical/event_architecture/context_decision.md#sender-ctx-carries-values-not-cancel):
> the sender keeps the `ctx`'s values and drops its cancel, which fixes the false *"not stored"* on a client
> disconnect. It opens 6f — Go's `context` package keeps optional parameters OFF `ctx`, so a per-event option
> belongs in `Event.metadata`. Q6 is now 6b · 6d · 6e · 6f. No count change.
>
> 🆕 **event_architecture Q6 elaborated part by part** ([here](technical/event_architecture/context_clarify.md#q6-part-by-part)).
> ⚠ One of my claims corrected: under the shipped codec (`DiscardUnknown`) a renamed field silently reads as
> ZERO rather than failing — in a money event, the worse outcome. Findings in code: two `protojson` decoders
> that disagree (push.go strict, codec.go lenient), and `buf breaking` configured but never run in CI. No count
> change.
>
> 🆕 **The owner's sender takes `*eventsv1.Event`** — recorded as
> [the-sender-takes-a-pointer](technical/event_architecture/context_decision.md#the-sender-takes-a-pointer), part 6a of
> event_architecture Q6. ⚠ The two handler types still take `Event` by value — a new contradiction in the
> owner's doc. Q6 narrows to 6b–6e. No count change.
>
> 🆕 **event_architecture Q6 elaborated, not answered** — [the sender, spelled out](technical/event_architecture/context_clarify.md#proposed--the-sender-for-q6).
> ⛔ One live finding in shipped code: the Pub/Sub client sends on its own background `ctx`, while
> [sender.go](../backend/pkgs/event_source/sender.go#L70) waits on the caller's — so a client disconnect
> returns an error, and a log line saying *not published*, for an event that IS sent. Q6 is now five parts:
> pointer · what an error means · detached wait · one publisher per topic plus a cleanup · binary encoding.
> No count change.
>
> ✅ **event_architecture Q5 decided, as recommended** — *"its clear for this question"*, confirmed as all of it
> ([setup-ensures-safe-defaults-never-deletes](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)). The two setup functions ENSURE: six defaults
> built in, update what may change, refuse and never delete what cannot — plus `Redrive` for the DLQ. No guideline
> rule is overridden: it already asks for a DLQ and 5 attempts. **−1.**
>
> 🆕 **The two setup functions are a developer's tool** — *"for developer to setup & ensure topic and subscriber
> exists and configure properly"*, recorded as
> [setup-functions-are-a-developer-tool](technical/event_architecture/context_decision.md#setup-functions-are-a-developer-tool).
> ✅ No running service holds Pub/Sub admin. ⚠ One gap: a push route whose subscription nobody has created
> receives nothing and reports nothing. ⛔ The owner declined a boot-time check for it —
> [services-do-not-verify-setup-at-boot](technical/event_architecture/context_decision.md#services-do-not-verify-setup-at-boot) — so running the tool
> is part of shipping a subscription. No count change.
>
> 🆕 **event_architecture Q5 walked through six situations** (now in [the decision](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)) —
> it found two more silent defaults: with no retry policy Pub/Sub redelivers *"as soon as possible"*, so a
> 30-second database blip dead-letters good events · and a push subscription's 10 s ack deadline is also
> its HTTP timeout, so a slow fold rolls back five times and lands in the DLQ. And nothing brings a
> dead-lettered event back — `Redrive` proposed as a third function. No count change.
>
> 🆕 **The owner gave `EventSender` a `ctx`** — `func(ctx context.Context, event Event) error`, recorded as
> [the-sender-takes-ctx](technical/event_architecture/context_decision.md#the-sender-takes-ctx). Half of
> event_architecture Q6, as recommended — and the `ctx` Q14 fills `identity` from. Q6 narrows to the pointer,
> the meaning of `nil`, the detach and the cleanup. No count change.
>
> 🆕 **The owner added `identity` to `Event`** — `role_base.v1.Identity identity`, *"its from rolebase"*. ✅ Reusing
> the token's `Identity` is right: it is what `san_auth.GetIdentity(ctx)` already returns. ⛔ Three things it
> leaves unsaid, each silent — who fills it (a worker or push handler has no identity in `ctx`), whether a
> consumer may trust it (**every push route is open**, so it is forgeable), and the token's `expired_at`, which
> makes a replayed event look expired. → **new event_architecture Q14**, which leans on Q6's `ctx`. The
> guideline's `string actor = 5` becomes a seventeenth stale site. **+1.**
>
> 🆕 **event_architecture Q5 elaborated, not answered** —
> the two setup functions, spelled out (now in [the decision](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)):
> `InitializeTopic` derives its topics from the proto, `InitializeSubscriber` takes one service's
> declaration, both refuse an immutable mismatch and never delete. No count change.
>
> 🆕 **event_architecture Q2 decided — no outbox** — *"we assume publisher is always publish message properly,
> and its pubsub responsbility"*, against my recommendation ([no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)).
> The producer publishes after its commit, the Pub/Sub client retries for up to 60 s, and delivery from there
> is Pub/Sub's. **Re-examined (RULE 11):** stock critique 3, ledger critique 5 and balance critique 4 all
> recommended an outbox and now point at the decision · order Q14's event leg too — for a publish that
> never happens, **its finder is now the only detector** (#1) · no guideline mentions an outbox. **−1.**
>
> 🆕 **The owner renamed the option's field** — `context.md` line 45 now reads `string topic`, recorded as
> [the-option-field-is-topic](technical/event_architecture/context_decision.md#the-option-field-is-topic).
> It closes the naming point the removal left open. ⚠ The doc's three examples (lines 59, 66, 85) still
> write `topics:`, which `protoc` rejects — reported as a contradiction. No count change.
>
> ## Before this round
>
> 🆕 **`warehouse.event_base.v1` is removed** — *"remove warehouse.event_base.v1, its not used for further"*,
> answering event_architecture Q9 against my recommendation
> ([event-base-v1-is-removed](technical/event_architecture/context_decision.md#event-base-v1-is-removed)). The
> topic option lives in `warehouse.events.v1`. ⚠ **Recorded, not yet deleted from the code**: selling's two
> live events and `TopicName()` compile against it, so the delete lands in ONE change with the new option
> and their move — the decision lists all five sites, `CLAUDE.md`'s options table among them. ✅ **No proto
> question is left**: what stands between the design and the first event is now the library, not the contract.
>
> 🆕 **The owner cancelled multi-topic** — *"cancel multi topic"*: the global `Event` stays, and each
> variant names ONE topic ([one-event-one-topic-per-variant](technical/event_architecture/context_decision.md#one-event-one-topic-per-variant)).
> The old entry is renamed
> [superseded-one-event-many-topics](technical/event_architecture/context_decision.md#superseded-one-event-many-topics)
> and every link to it re-pointed, across five files. ✅ **It removes two costs** — a non-atomic fan-out,
> and the producer knowing its consumers (a second consumer is now a second subscription) — and **simplifies
> event_architecture Q9**: the shipped `event_config` at 50001 already holds one `event_topic` string, so it
> could be used as it is (⛔ answered the other way — above). The outbox (Q2) is back to closing the commit-to-publish gap only. ⚠ One new
> contradiction in the owner's doc: item 5 still shows `topics: ["stock", "order"]`, a list a `string`
> field cannot hold. No count change.
>
> ✅ **Six event decisions (2026-09-11), four as recommended** — five in one answer, *"for q7, yes, for q10
> yes, for q11 no, for q12 yes, for q13 yes"*, then Q8 on its own: *"for now there is no order key, for race
> condition, its service responsbility"*:
>
> | Q | decision |
> | --- | --- |
> | 8 | ⛔ [ordering-is-each-services-job](technical/event_architecture/context_decision.md#ordering-is-each-services-job) — **against my recommendation**: no ordering key for now; a race between events is the consuming service's |
> | 7 | [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads) — `event_id`, `occurred_at`, `aggregate_id` typed on `Event`, beside the owner's `metadata` map |
> | 10 | [one-contract-for-both-handler-types](technical/event_architecture/context_decision.md#one-contract-for-both-handler-types) — `nil` ACKs · an error retries · an unhandled variant returns `nil` · `Claim` in the handler's own transaction |
> | 11 | ⛔ [push-routes-are-open-by-default](technical/event_architecture/context_decision.md#push-routes-are-open-by-default) — **against my recommendation**: no token check, for every adopter |
> | 12 | [one-adopter-checklist-for-both-drivers](technical/event_architecture/context_decision.md#one-adopter-checklist-for-both-drivers) — seven steps: named type, provider, route or `Run(ctx)`, one declaration, own dedup table, a test per variant |
> | 13 | [pull-worker-is-bounded-and-fails-loudly](technical/event_architecture/context_decision.md#pull-worker-is-bounded-and-fails-loudly) — returns only on cancel, and never the client's 1000 handlers at once |
>
> ⚠ **Re-examined for ripples (RULE 11) — three found.** `context.md` lags the decisions at six lines, a
> checklist rather than a question · the guideline nests the metadata in `EventMetadata meta = 1`, so
> [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads)
> **overrides** `meta-at-one-payload-at-hundred` — four more stale guideline sites, plus one from the
> one-package brief, eleven in all · and,
> latent in code: liability's *"the ledger's write path has no wire surface"* holds only while liability
> has no push route. Its lever under the decision is **pull**, which has no inbound route to forge.
>
> ⚠ **Q8's ripples.** ✅ Settlement already meets it — every write is a delta and the cascade shifts later
> days, so any arrival order composes to the same report. ⛔ **Liability does not**: a cancel that arrives
> first reverses nothing and ACKs, and the late placement then charges a cancelled order — permanently.
> Latent while liability reads only the dev loopback, and now liability's to fix. And three more guideline
> sites go stale (`topic-per-context`'s ordering rationale, the planned `ordering_key_field`, §6's
> *"absent is an error"*) — fourteen in all.
>
> 🆕 **event_architecture Q2 now has a written proposal** —
> the outbox (⛔ since declined — [no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)): two functions a producing
> service opts into, `Enqueue(ctx, tx, event)` inside its own transaction and `RunRelay` after commit. ⚠ It
> **revises my earlier decorator shape** — a decorator implementing `EventSender` cannot reach the caller's
> transaction, since the owner's `EventSender` takes no `ctx` and no `tx`. No count change.
>
> 🆕 **`context.md` gained an adopter recipe per driver, a pull library, and a `metadata` map on `Event` —
> re-examined as each landed.** Three halves are settled in the owner's doc itself, so three questions
> narrowed in place:
>
> | settled by the doc | what is left |
> | --- | --- |
> | the metadata lives on `Event`, as a `map<string, string>` | event_architecture Q7 — typed fields for the three keys the library READS. A misspelt `event_id` in a map reads `""`, and every later event dedups as a duplicate, silently |
> | push and pull get two handler types, one signature — Go converts a handler between them | Q10 — the four rules, written once above both |
> | `ListenSubscriber(subid)` receives, so `InitializeSubscriber` only creates | Q5 — its defaults and its compare-refuse contract |
>
> ⛔ **Three new questions and a contradiction.** The push recipe makes settlement's open webhook
> ([the-event-webhook-is-open](business/settlement/context_decision.md#the-event-webhook-is-open)) **every
> adopter's default** — and liability, the only other consumer with logic, writes its LEDGER from the
> event, on the path its own code says has *"NO WIRE SURFACE AT ALL"*. Settlement's decision rested on
> *"the ledger is not reachable from here"*, and a recipe copies the code without the basis (Q11: verify by
> default, settlement opts out by name). Both recipes stop at the handler — no dedup-table migration, no
> subscription declaration, and no route convention while two already exist (Q12). `ListenSubscriber`
> blocks with no stated lifecycle, and Pub/Sub's client runs **up to 1000 handlers at once** by default,
> on a DB pool with no connection limit (Q13). And line 100's `PushHandler` is the SHIPPED raw-request
> type, not the doc's `EventPushHandler` — reported as a contradiction.
>
> ⚠ **Ripple**: the settlement event spec moved to the owner's map plus the three typed fields
> ([analytic_context_clarify](business/settlement/analytic_context_clarify.md#proposed-design--the-settlement-event)),
> and so did **#6** below. ✅ Its three new questions, and two of the three it narrowed, were decided the
> same day — above.
>
> 🆕 **Then `### Webhook` gained a consumer contract — `EventPushHandler func(ctx, event Event) error`.**
> The library decodes and the handler gets the whole `Event`, which **removes a library contradiction**
> (dispatching on the decoded type is right when that type is always `Event`) and makes a metadata block
> on `Event` reach every handler for free — event_architecture Q7 now has a written proposal
> (✅ since decided — [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads)). One new
> question: make it the ONE handler for push and pull, with four rules beside it — the two that fail
> silently are *return nil for a variant you do not handle* and *claim the id in your own transaction*.
>
> 🆕 **Re-examined twice more, and the owner's own doc edits closed a question and a half.**
> `## How Ensure Event Setup Related Properly` now has `InitializeSubscriber` beside `InitializeTopic`, so
> subscriptions are covered — what is left of event_architecture Q5 is the functions' contract, plus a
> naming trap: Pub/Sub's client calls the RECEIVING side a `Subscriber`. And
> `## How Event Received / Subscribed.` opened with two empty sub-sections — `### Webhook` and `### Pull`.
> ✅ That closes *push or pull* in the doc itself: **both**, and the question is deleted. Both
> sub-sections inherit a receive half **built twice and wired once**:
> `san_event.Receiver` (dedup in the handler's transaction, rejection records, a repeated-failure layer) is
> called by nothing, and the path that runs, `event_source.PushHandler`, has none of it. ⛔ **Two defects
> would drop events silently the day a real subscription pushes**, both verified against Google's docs: a
> push carries the FULL subscription path, which `liability_service` matches against short constants — so
> every event falls to `default:` and is ACKed — and `deliveryAttempt` arrives at the top level, which
> `PushRequest` never reads, and is `0` anyway without a dead-letter policy. The dev loopback passes short
> names, which is why none of it has failed. A receive path is proposed for the empty section, and every
> event_architecture question is rephrased so a bare *"yes"* accepts the recommendation.
>
> ✅ **Two event decisions, both against my recommendation, both taken the day they were asked.**
>
> | decision | what it settles | what it leaves |
> | --- | --- | --- |
> | [superseded-one-event-many-topics](technical/event_architecture/context_decision.md#superseded-one-event-many-topics) — one global `Event` in `warehouse.events.v1`, every variant naming its own topics (⛔ multi-topic cancelled later the same day) | **reverses** [superseded-no-global-event-envelope](technical/event_architecture/context_decision.md#superseded-no-global-event-envelope), a day old, by answering its one objection — one `Event`, one topic. Its other three reasons were accepted as costs | ⛔ **fan-out is now one publish per topic, so it is no longer atomic** — the outbox (event_architecture Q2) becomes the fix, not an option · the sketch has no home for the metadata (Q7), no per-topic ordering key (Q8) and a second `event_config` (Q9) · the guideline now disagrees at six sites |
> | [initialize-topic-is-a-function-not-a-flow](technical/event_architecture/context_decision.md#initialize-topic-is-a-function-not-a-flow) — the library ships the function, callers build the flow | who runs provisioning, and when. My `san`-command-at-deploy recommendation is **withdrawn** as a library requirement | what the functions **guarantee** (Q5, narrowed twice) — ✅ the doc has since added `InitializeSubscriber`, so subscriptions are covered. Left: its safe defaults, compare-then-refuse, and whether *Subscriber* means the resource or the receiving client |
>
> ⚠ **Re-examined for ripples, as RULE 11 asks after a decision that touches a shared shape.** Four
> agent-written sites assumed the old envelope and were updated: the settlement event spec
> ([analytic_context_clarify](business/settlement/analytic_context_clarify.md#proposed-design--the-settlement-event) —
> every settlement answer survives, only the wrapper moved), a settlement diagram, the FAQ's event-option
> entry, and **#6** below. ⛔ **The guideline is the one site not updated** — six of its rules describe the
> overridden shape, and it is not mine to edit without an ask.
>
> 🆕 **Found on the way, and still true**: a topic carries almost none of the config that fails — filter
> and ordering are fixed when a subscription is created, a DLQ needs an IAM grant, and a subscription with
> no activity is **deleted after 31 days**, which is exactly what a quiet DLQ triage subscription is · the
> one consumer with logic has **no push route** · the shipped Pub/Sub sender creates a `Publisher` per event
> and never stops one — ⚠ *since corrected*: not a goroutine leak in v2.6.1, but no batching and nothing to flush
> at a deploy ([6d](technical/event_architecture/context_clarify.md#6d--one-publisher-per-topic-and-a-cleanup)).
>
> ⚠ **Two corrections of my own.** A publish handed the request's `ctx` does not *"die"* on a disconnect —
> the send survives and the wait fails, so the caller reports a loss that did not happen. And *"a filter
> change is a data gap"* is avoidable: topic retention lets the replacement subscription seek back.
> → [event_architecture questions](technical/event_architecture/context_clarify.md#question)
>
> 🔧 **This file was repaired too**: the withdrawal line under *Off the display* was cut mid-sentence and
> followed by a stray table row, eleven code links resolved against `docs/` instead of the repo root, and
> one anchor pointed at a renamed section. All fixed.
>
> ✅ **The event package question was answered the same day it was ranked** —
> [superseded-no-global-event-envelope](technical/event_architecture/context_decision.md#superseded-no-global-event-envelope)
> (⛔ reversed a day later — above): **one envelope per context**, no shared `warehouse.events.v1`. It
> **ratified** the guideline rather than overriding it, so no override note was owed, and it was the first
> time the requirement tree and `guidelines/` had been aligned on anything in this area.
>
> ✅ **And the three-docs question went with it** —
> [the-library-doc-is-absorbed](technical/event_architecture/context_decision.md#the-library-doc-is-absorbed):
> `technical/event/library.md` is removed and its content moves into `event_architecture/context.md`.
> ✅ **The removal is DONE** — that file and its clarify are deleted and `docs/technical/event/` is
> gone. Its eight live points were **re-routed, not answered**, into the event_architecture clarify
> beforehand. ⚠ **The guideline stays** — it is a different lane (HARD RULE 7), not a fourth copy.
>
> ⛔ **But the delete ran BEFORE the merge, so the content it held is in git and nowhere else.** The
> push and pull flows, `EventSender`, the dead-letter design and the per-service registration rules
> are not in `context.md` yet — `git show d54b182:docs/technical/event/library.md`. That is a
> **recovery step somebody has to actually take**, not a formality, and this page is where it is
> tracked until it lands.
>
> ⚠ **One inbound link broke and it is the owner's to fix**: `ledger/mutation_and_ledger.md:154`
> says *"we rely `[event_library](../event/library.md)` for processing event"* and now points at
> nothing. Reported in
> [`mutation_and_ledger_clarify.md`](technical/ledger/mutation_and_ledger_clarify.md), never edited
> (RULE 7b). My own two references were repointed.
>
> 🔄 **#6 is RESHAPED and it got worse, not better.** The package half closed in a day; what the two
> decisions left behind is that **the decided envelope cannot be published by the shipped library at
> all**, and an envelope per context has now made the second half unavoidable rather than optional —
> `Register[T]` dispatches on the concrete decoded type, and with an envelope that type is always
> `SettlementEvent`. Both are library work that does not exist, and they interact: unwrapping the
> `oneof` changes the same handler signature `meta` does.
>
> ⛔ **A merge hazard is now tracked as its own section** —
> [what the removed doc held](technical/event_architecture/context_clarify.md#-what-the-removed-doc-held-and-what-must-not-come-back-with-it).
> `library.md` declares `san_event = 50099` while `TopicName()` reads `event_config` at **50001**, so
> an event carrying only the doc's option reports **no topic** — present in the `.proto`, invisible to
> the code. Copied into the authoritative doc during the merge, that stops being a stale sibling and
> becomes the instruction.
>
> 🆕 **Outbox-or-reconcile moved onto this board's active set** rather than being answered. It was
> asked against `library.md`, which is going away, and it is the same question
> [`stock/design_clarify.md`](technical/stock/design_clarify.md) asks of the three stock flows — one
> answer settles both. ⚠ It reaches settlement directly: a lost event is a report that disagrees with
> a log that is already right, which is the one damage class **#3** says nothing can repair.
>
> 🆕 **Settlement's event set is TWO IN and one out — and both inbound events already ship with no
> consumer.** `selling_service` publishes `OrderPlacedEvent` and `OrderCancelledEvent` today, and
> [`events.proto`](../proto/warehouse/selling/v1/events.proto) says so in capitals: *"IT CURRENTLY HAS NO
> CONSUMER, AND IS PUBLISHED ANYWAY … Do not stop publishing it because nothing listens."* Those are
> exactly `initial_total` and `initial_total_cancel`, which `context.md` currently gets by a
> **synchronous RPC from `order_service` whose failure is swallowed** — the seam **#1** is about.
> ⚠ Subscribing instead would replace *"logged loudly, no list of affected orders"* with
> at-least-once plus a DLQ, and it needs nothing new built. Both
> [the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement)
> and [a-missing-account-is-fixed-by-hand](business/settlement/context_decision.md#a-missing-account-is-fixed-by-hand)
> were decided the other way deliberately, so this is not a reopening — it is a note that the
> mechanism making them unnecessary is already on the wire, and nothing is built yet.
> ⛔ **Three things to check first**: whether `OrderPlacedEvent.revenue` IS `order.marketplace_total`
> under another name · the two events sit on **two topics**, so a cancel can arrive before its
> placement (the ledger nets out either way, but `order_settlements.initial_total` is a frozen copy,
> not a delta) · and neither event carries `order_created_by_user_id`, which the user report keys on.
>
> ⚠ **A REVERSAL of my own, recorded as a contradiction** (RULE 11):
> [settlement Q3](business/settlement/context_clarify.md#question) recommended a **thin** id-only
> event while the payload spec said carry the row. Resolved **in favour of the row** — the thin
> argument assumed the fold is the only consumer, and the Financial Ledger is a **different service**
> that cannot read `settlement_logs` at all (HARD RULE 3). **The rule that stops it recurring: an
> event's payload is decided against the FURTHEST consumer, never the nearest.**
>
> ➡ **The event doc is scoped to EVENT design, not settlement design** (owner). What was written into
> its clarify as a settlement spec is **re-routed** to
> [`analytic_context_clarify.md`](business/settlement/analytic_context_clarify.md#proposed-design--the-settlement-event) —
> `analytic_context.md` `### Events.` is the doc that can answer what a settlement event carries
> (RULE 7b). What stayed behind is the generic half:
> [four rules that belong in the event doc](technical/event_architecture/context_clarify.md#four-rules-that-belong-here-not-in-each-contexts-doc) —
> a `oneof` variant is a kind of fact and never an enum value · an ordering key names the aggregate
> the **consumer** is keyed on, not the producer's id, and cannot be backfilled · `event_id` is
> derived from the causing row · an event carries the fact whole.
>
> 🆕 **#6 now has a concrete proposal to review**, not just a blocker. Its two non-obvious calls:
> **one variant, not one per `settlement_type`** (the fold runs the same statement for all eight) and
> **the ordering key is the SHOP, not the order** (the fold's key is `(day, shop_id, team_id)` and the
> carry reads the previous day).
> ⚠ **A correction**: I claimed a broker-message-id dedup key makes the replay a no-op. **Withdrawn** —
> [the-replay-cuts-three-tables-on-one-line](business/settlement/context_decision.md#the-replay-cuts-three-tables-on-one-line)
> already gives `settlement_event_logs` a `day` column, so the rebuild clears dedup by range. What
> survives is the **retry**, not the replay: a timed-out publish is retried, the retry mints a new
> message id for the same fact, and the row folds **twice**.
> ⚠ **And nothing publishes anything yet**: `post_entry.go` has no event at all, so the entire fold
> pipeline is designed against a message that is never sent.
>
> ⚠ **My `topic name = the proto package` recommendation is WITHDRAWN** (RULE 11 — a contradiction in
> my file, not the owner's). `event_topic` holds a **logical** name a resolver prefixes per
> environment; a package-shaped topic reads as a resource path. Replaced by `<context>-events`.
>
> ⬇ **`Can a team CONTEST a charge posted on its books?` drops off the display** — promoted last round
> when the webhook question was answered, and pushed off again by the row above. Unanswered and
> unchanged: [balance Q5](business/balance/context_clarify.md#question) ·
> [balance Q6](business/balance/context_clarify.md#question).
>
> ✅ **#3 was answered the same day it was ranked** — `context.md` made `system_adjustment` an eighth
> `settlement_type`, which settles it as a **ledger row** and **withdraws my report-column
> recommendation**. ✅ It also **unblocked #2**: the reconcile stays `Σ change` with no second term.
> 🔄 **The row is reshaped rather than closed**, because the answer left one case unexpressible — damage
> where the log is right and only the fold was lost, which is what every known drift cause produces.
>
> 🆕 **And the same edit reversed two decisions** — `order_id` is nullable
> ([superseded-every-entry-names-an-order](business/settlement/context_decision.md#superseded-every-entry-names-an-order) said
> NOT NULL) and there are now two grains
> ([superseded-the-grain-is-the-order](business/settlement/context_decision.md#superseded-the-grain-is-the-order) said *"the
> order, absolutely"*). ⚠ **Both need renaming with their references grepped** (RULE 12). ✅ It also gives
> the platform WITHDRAWAL a home, which was blocked on exactly that NOT NULL — see the settlement
> clarify. ⛔ **And it leaves the unique index unstated**: `UNIQUE (order_id, unique_id)` with a NULL
> `order_id` admits duplicates silently, and shop-addressed rows are precisely the NULL ones.
>
> ➡ **And #1 has MOVED to the order context** (owner, 2026-09-10): *"for ensure order half success or
> not, its order service responsibility"*. It had been tracked against architecture and settlement, and
> RULE 7b routes it to the doc that can ANSWER it — the order is what is half-done. Architecture Q2 is now
> a pointer, settlement's Awaiting carries one, and what stayed in architecture is a **contradiction**
> rather than a question: [the gate runs before the draw, and that doc says it cannot](technical/architecture/context_clarify.md#the-gate-runs-before-the-draw-and-this-doc-says-it-cannot).
> My `draw → gate → commit → release` recommendation is **withdrawn** — it solved a problem the shipped
> ordering does not have.
>
> 🔄 **#1 REFRAMED after opening the files it is about — the third time this page's own warning has
> paid off.** The row asserted that the repo has no saga, no compensation and settlement on the critical
> path. All three are false: `TeamCreate` compensates, `OrderPlace` compensates, and settlement's leg was
> decided on 2026-09-02. **The pre-commit half is handled with more care than the row credited** — the
> stock pick sits INSIDE the order's transaction. What survives is the post-commit half, and it is not
> *"what happens"* but *"how is it FOUND"*: three legs, all ending at “logged loudly”, and no list anywhere
> of the orders left behind.
>
> 🆕 **#3 is NEW, and it was opened by the answer to the row that closed.** The owner accepted the
> 31-day reach and then said what repairs the rest — a `system_adjustment` — without saying whether it
> is a ledger row or a report row. **That is the first settlement question on this page that blocks a
> BUILD rather than a decision**, because the repair path is now the only route for out-of-window damage
> and the two readings write to different tables.
>
> ⬇ **`Which PRE-CHECKS does a draft run?` drops back off the display** — promoted last round into the
> slot the replay row freed, and pushed off again by #3. Unanswered and unchanged both times.
>
> ⚠ **Three findings this round were the SAME shape**: a new case that never reached the list where
> every case appears together — `source_type` (two values, three shipped), `system_adjustment` (absent
> from `### Field that tracked.`), and the tracked list itself mixing SUM columns with LAST columns under
> one rule. HARD RULE 11 names this exact site, and it is now the most productive place to look.
>
> ✅ **#2 CLOSED — the replay's 31-day reach is accepted deliberately**
> ([the-replay-reaches-31-days-and-that-is-accepted](business/settlement/context_decision.md#the-replay-reaches-31-days-and-that-is-accepted),
> owner 2026-09-10). The owner supplied the premise — *"`AnalyticReplayCompute` is only ever used when
> something is already wrong"* — which was raised as an argument to revisit
> [the-replay-seeks-the-broker](business/settlement/context_decision.md#the-replay-seeks-the-broker) and
> answered the other way: damage older than the window is out of scope. **My `settlement_logs` re-fold
> recommendation is withdrawn.**
>
> ✅ **And that RETIRES this page's only deadline.** The archive subscription was ranked here because
> it was the one thing that could not be added retroactively and was the only way to extend the replay's
> reach. With the reach declared sufficient, **settlement no longer forces it**. ⚠ It is not answered —
> it stays open in [event_architecture](technical/event_architecture/context_clarify.md#critique) on its
> own merits (audit, other services, a definition change needing years), and *"an archive added later
> starts at now"* is still true. Settlement is simply no longer the thing holding its clock.
>
> ⚠ **What the closure did NOT settle**, and it is now a build task rather than a question: accepting
> *"I cannot rebuild February"* is not accepting *"typing February destroys March"*. The two bounds are
> still owed, and the accepted limit is what makes them mandatory rather than optional
> ([analytic Awaiting](business/settlement/analytic_context_clarify.md#awaiting)).
>
> 🆕 **A new context opened — `technical/event_architecture/`, and its doc is three lines.**
> [context.md](technical/event_architecture/context.md) states one decision: *"We use Google Pub/Sub"*.
> [Four questions](technical/event_architecture/context_clarify.md#question) came back with it, none
> displacing a row below — but **one of them reaches straight into #2**. That row's ceiling is
> *"the broker retains 31 days at most"*, and it is a ceiling **only because there is no archive**.
> One archive subscription per topic, writing raw messages to durable storage, is what turns the
> replay's hard floor into a soft one. ⚠ **It cannot be added retroactively** — an archive created
> later begins at *now*, and the months before it do not exist. That makes it the cheapest thing on
> this page and the one with a deadline.
>
> ⚠ **And the broker is decided in two docs that do not agree.**
> The removed `event/library.md` said *"supported is: Google Pub/Sub, local
> sqlite"* with a deferred RabbitMQ constructor — an abstraction over brokers.
> `event_architecture/context.md` says *"We use Google Pub/Sub"* — a choice of one. The difference is
> not stylistic: **a portable interface can only expose the intersection of its brokers**, and
> ordering keys, `dead_letter_policy` and `seek` are all outside that intersection — which is to say,
> the abstraction would forbid exactly the three features #2 depends on.
>
> ✅ **The settlement REPORT TABLES are now fully specified — three decisions in one round, and the
> biggest went against my recommendation.**
> [a-past-date-position-is-a-real-screen](business/settlement/context_decision.md#a-past-date-position-is-a-real-screen):
> a screen does read a shop's position at a past date, so `open_balance` / `close_balance` stay and the
> cascade, the genesis seed, the replay floor and the reseed are all paid for. **My case for dropping
> them is withdrawn.**
>
> ✅ **And what that position MEANS is settled too** —
> [the-position-is-the-shortfall-not-the-wallet](business/settlement/context_decision.md#the-position-is-the-shortfall-not-the-wallet):
> *"we dont care about shop wallet, `shop_settlement_daily_reports` is enough"*. That closed a question
> that was **upstream of the carry decision itself** — the phrase *"a shop's position"* fits both the
> cumulative shortfall and the marketplace wallet, and only the first is in that table.
>
> ✅ **It also DE-ESCALATED the withdrawal question**, which had been about to become blocking. A
> withdrawal is money leaving the wallet, so under the other reading no past-date screen could ship
> without it. With the wallet out of scope, [context Q1](business/settlement/context_clarify.md#question)
> and [architecture Q7](technical/architecture/context_clarify.md#question) stay open **on their own
> merits, at their own pace** — and `fund`'s undecided destination is unblocked the same way, and
> equally unanswered.
>
> ⚠ **The carry answer did not shrink the settlement board — it moved it.** Two of the three findings
> under that question were never about *whether* the columns exist, so they survived and became
> requirements: the number is **two quantities added together** (money still coming, and the cut that
> never will), so the screen's label is bound by
> [hidden-cost-is-left-in-the-balance](business/settlement/context_decision.md#hidden-cost-is-left-in-the-balance)'s
> *"name it hidden cost, not outstanding"*; and the stored copy can **drift from its own definition
> with no invariant able to see it**, which was harmless while nothing read it and is now #3.
>
> ✅ **A contradiction closed with it, and not by being fixed** —
> [the-carry-materialises-the-day-boundary-position](business/settlement/context_decision.md#the-carry-materialises-the-day-boundary-position).
> *"`open_balance` has two definitions"* had stood for three rounds. There was never a second
> definition: the day-boundary position is the **meaning**, the carry is the **storage**, the cascade is
> the bridge. ⚠ What that leaves is a bug class, not a settled point — which is why it is a question
> rather than a deletion.
>
> ✅ **The order seam is settled, and it was smaller than it looked.**
> [the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement)
> — a failed `SettlementPost` never fails the order, because `initial_total` records something that
> already happened on the marketplace and a missing account is repairable where a lost order is not.
> [the-creator-is-read-from-the-token-at-placement](business/settlement/context_decision.md#the-creator-is-read-from-the-token-at-placement)
> — `orders.created_by_user_id` from `san_auth.GetIdentity(ctx)`, never client-supplied. ✅ Checked in
> code, two of the three pieces already existed: **`orders.marketplace_total`** is on the model and in
> the proto, and the **idempotency key is solved by accident** — `order_place.go` already derives
> `"order-placed:" + order_id` for its event, explicitly so *"a redelivery and a replay are the same
> logical fact and must collide"*, which is exactly the recipe `SettlementPost.unique_id` needs.
>
> ✅ **And the repair is settled too, by declining machinery**
> ([a-missing-account-is-fixed-by-hand](business/settlement/context_decision.md#a-missing-account-is-fixed-by-hand)):
> a person fixes it on the order detail page. A flag, a `san` repair command and a cross-service
> reconcile were all considered and turned down — **nothing new is built**, because
> [order-detail-manages-the-ledger](business/settlement/context_decision.md#order-detail-manages-the-ledger)
> already put the ledger on that page and CS is already permitted to post `initial_total`. Discovery is
> human: the gap surfaces when somebody reconciles against the marketplace payout report.
> ⚠ **One consequence is now load-bearing** — manual posting *is* the repair path, so the handler must
> refuse a second LIVE `initial_total`. The form hiding the option is a convenience, not a control.
>
> ✅ **The replay's source is DECIDED — it seeks the broker** ([the-replay-seeks-the-broker](business/settlement/context_decision.md#the-replay-seeks-the-broker)),
> against my recommendation of a `settlement_logs` re-fold. What it buys is one code path: the rebuild
> runs the identical handler as live traffic, so a fold bug cannot exist in one and not the other.
> ⛔ **What it requires is a checklist of four, and three are invisible from the code.** **(a)**
> `settlement_event_logs.id` **is** the broker's message id and a seek redelivers the same ids, so dedup
> must become **generation-scoped** (`run_id`) or every replayed message is dropped as a duplicate and
> the rebuild is a no-op. **(b)** **`retain_acked_messages` must be `true`** — it defaults to false, and
> a backwards seek then delivers nothing at all. **(c)** The replay must **not** hold
> `process_event_lock`, or the redelivered messages hit a webhook that rejects them and burn delivery
> attempts toward the dead-letter policy. **(d)** A seek is asynchronous, so the RPC cannot report
> success on a trigger.
> ⚠ **And it accepts a permanent ceiling**: a replay can never reach past the subscription's retention —
> 7 days by default, **31 at most** — which makes the genesis row and its floor **load-bearing** rather
> than prudent, since genesis is the only record of anything older.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **Six settlement questions answered in one day**, and the fold's design is now essentially closed:
> [init-opening-balance-is-deleted](business/settlement/context_decision.md#init-opening-balance-is-deleted)
> removes the cross-service call held inside the ledger's transaction **and the rollback that let a
> report refuse a payment that genuinely arrived** — the fold's own `INSERT … ON CONFLICT` is now the
> only creator of a daily row, and the race that call guarded is solved by the unique index with no lock
> at all. [superseded-genesis-is-seeded-from-the-state-table](business/settlement/context_decision.md#superseded-genesis-is-seeded-from-the-state-table)
> writes a day-zero row per scope from `SUM(order_settlements.last_balance)`, so no live shop opens at a
> false `0`. [a-replay-deletes-its-range-first](business/settlement/context_decision.md#a-replay-deletes-its-range-first)
> makes `AnalyticReplayCompute` clear `day >= @start_date` and rebuild, which removes the doubling.
>
> ⛔ **And the last two of those, taken together, turned a known gap into a DATA-LOSS bug.** The order's
> creator is carried on the event and stored on no table. A replay now **deletes** `day >= @start_date`
> from both daily tables and rebuilds from `settlement_logs` — which has no user — so
> `user_settlement_daily_reports` rows are removed and **cannot be reproduced**. The repair tool is the
> thing that loses the data. Genesis hits the same wall from the other side: the seed groups by shop and
> team, so the user table has no anchor either. **→ `order_settlements.creator_user_id`, stamped by the
> opening row** — and until it exists, the doc must say replay and genesis cover the **shop table only**.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **A second interaction between the same two decisions**: a `start_date` at or before the genesis day
> **deletes the anchor**, and every rebuilt day then opens at `0` — silently, and it is exactly the
> failure genesis was introduced to prevent. The payload is a bare `start_date`, so nothing stops it.
> **→ Refuse a `start_date ≤` the genesis day**, and keep that day in `settlement_service_metadata`
> rather than as folklore shared between a migration and an RPC.
> → [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **Three settlement questions were answered in chat, two of them against my recommendation.**
> [dedup-and-compute-share-one-transaction](business/settlement/context_decision.md#dedup-and-compute-share-one-transaction)
> closes the last correctness hole in the live fold — a failed compute now rolls the dedup mark back with
> it, so a redelivery genuinely reprocesses instead of being ACKed as done.
> [the-event-webhook-is-open](business/settlement/context_decision.md#the-event-webhook-is-open) accepts
> an unauthenticated push endpoint; the reasoning that makes it survivable is that a forged POST corrupts
> a **projection**, not the ledger — which promotes `AnalyticReplayCompute` from a maintenance
> convenience to **the repair path for a reachable failure**.
> [the-carry-is-stored-not-derived](business/settlement/context_decision.md#the-carry-is-stored-not-derived)
> keeps `open_balance` / `close_balance` as real columns.
>
> ⛔ **Two of settlement's three remaining questions EXIST because of those answers.** **(a)** A carry's
> first row anchors the whole chain, and every live shop already holds balances — so `open_balance = 0`
> is wrong for all of them, and wrong **silently**, since `close − open = Σ movements` still holds while
> every absolute figure is offset. **→ Seed day zero from `SUM(order_settlements.last_balance)` per scope
> at migration time**, which is cheap exactly once. **(b)** The statements increment, so replay must
> **delete its range before re-folding** or it doubles — and with the webhook open, replay is now the only
> thing that can repair a forged event.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ⚠ **And one decision half-reverses another.**
> [open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)
> said the two balances are *snapshots aggregated from the log, never carried*. The **definition**
> survives — and becomes the invariant a reconcile verifies — but *"no carry"* and *"any day rebuildable
> alone"* do not. Both entries are annotated rather than silently left standing (RULE 12).
>
> ✅ **The corrected fold SQL was ADOPTED into the owner's doc**, and with it eleven of the defects this
> file was tracking close at once: the syntax runs, `close_balance` has one definition instead of three,
> the late-event cascade is a shift rather than a rebuild, and the `is Event Received late ?` branch is
> gone — a late event is now handled by a `WHERE day > @day` that matches nothing when the event is
> on time. ⛔ **But the same pass dropped `change` from `field that tracked` while both halves of the
> adopted statement still write it** — `ERROR: column "change" does not exist`, so nothing runs. It went
> out beside `balance`, which was the right one to drop.
> ⚠ **And the composite unique is `(day, shop_id, team_id)` while both queries filter equality on
> `shop_id, team_id` with a range on `day`** — the wrong column order for the only two queries in the
> design. `(shop_id, team_id, day)` is free: `ON CONFLICT` infers its index by column *set*, not order.
> → [analytic — what it broke](business/settlement/analytic_context_clarify.md#what-the-previous-round-adopted-and-what-it-broke)
>
> ⛔ **What was NOT adopted is now the largest gap, precisely because the statements are correct.**
> `### Flow` is unchanged: the dedup insert still runs **before** the compute, there is no transaction
> boundary drawn, and there is no advisory lock. Two correct statements in a wrapper that can swallow an
> event is still a fold that loses money — and nothing reports it, because the log has the row and the
> report does not.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> 🆕 **`## How we do AnalyticReplayCompute.` was started and stops mid-word** — *"1. define `start"*.
> It needs nothing new: **lock, `DELETE … WHERE day >= @start_date` on both tables, re-fold from
> `settlement_logs`, unlock.** The carry survives because `start_date − 1` is not deleted, order does not
> matter now that every write is a delta, and it is re-runnable — which is the property the RPC exists
> for. ⛔ Without the delete it **doubles**, because the adopted statements increment and dedup is keyed
> on the message id.
> → [analytic — the replay algorithm](business/settlement/analytic_context_clarify.md#analyticreplaycompute--the-algorithm-your-own-statements-already-imply)
>
> 🆕 **Settlement became THREE docs, and the split answered one of this file's questions.**
> `context.md` kept the ledger; the reports moved to
> [analytic_context.md](business/settlement/analytic_context.md) and a new
> [meta_context.md](business/settlement/meta_context.md) holds a `settlement_service_metadata` key/value
> table. ✅ The drawn `Ledger Updated → Event → Message Broker → http push → Service Webhook` settles the
> last of the three competing architectures: **the fold owns the report, not the writer**
> ([the-fold-owns-the-report-not-the-writer](business/settlement/context_decision.md#the-fold-owns-the-report-not-the-writer)).
> My clarify split with it — the report questions were **re-routed** to
> [analytic_context_clarify.md](business/settlement/analytic_context_clarify.md) and
> [meta_context_clarify.md](business/settlement/meta_context_clarify.md).
>
> ⛔ **The sharpest thing found this round is a corruption produced by two answers that were each
> correct.** `### Idempotency Layer.` keys dedup on the **broker's message id** — right, and it resolves
> the replay collision in the right direction, because `AnalyticReplayCompute` republishes under new ids
> and is therefore deliberately not deduped. But the fold **increments** (`fund += @change`). Put those
> together and **a replay adds every movement in its range a second time** — and the RPC is reached for
> precisely when the rows already hold numbers. Neither half is wrong on its own; the pair is.
> **→ Recompute the day rather than increment it**, and replay becomes harmless. If the increment stays,
> replay must zero the range in the same transaction and the doc must say so.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **And the dedup row is written BEFORE the compute**, so a compute that fails after it commits is
> redelivered, recognised as *already processed*, ACKed — and the movement is never folded, with nothing
> reporting it. ⚠ The fix has a Postgres detail that decides its shape: a raw PK violation **aborts the
> transaction**, so it must be `INSERT … ON CONFLICT DO NOTHING` with a rows-affected check, never a
> caught error inside the transaction that also does the compute.
> → [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **The user-dimension blocker was answered — for the live fold only.** `### Events.` now carries
> `order_created_by_user_id`, which is where that person comes from. ⛔ **But it is persisted nowhere** —
> not on `settlement_logs`, not on `order_settlements`, and [`orders`](../backend/services/selling_service/selling_service_models/order.go)
> still has no creator column (`AuthorUserID` is on `order_drafts`). So the user table can be folded and
> never **rebuilt**, and every writer must supply it forever on a request that has no such field.
> **→ `order_settlements.creator_user_id`, stamped once by the opening row** — the event may still carry
> it, it just stops being the only copy.
> → [analytic Q3](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **And a security hole that is not settlement's alone.** The doc specifies a webhook at
> `/event/[sub_id]/push`. [push.go:41](../backend/pkgs/event_source/push.go#L41) reads the body, decodes and
> calls the handler — **no token, no signature, no check of any kind** — and the roling ACL cannot reach
> it, because it reads `request_policy` off a Connect request message and a webhook is not one. Anyone
> who can reach the port POSTs JSON and moves a shop's reported balance. This is the **one write path in
> the system the ACL does not cover**, and every future consumer inherits it.
> → [analytic Q3](business/settlement/analytic_context_clarify.md#question)
>
> ⚠ **One answer went against my last recommendation, and it was right to.** I said delete the
> `is Event Received late ?` branch. The owner instead gave it a mechanism — `update and recount upper
> date` — which is **correct given a stored carry**: a snapshot has no chain to recount, a carry does.
> So the branch was never the question; **stored-or-derived `open_balance` is**, and it is now concrete:
> as drawn, one late event rewrites every later day for that scope while the live fold writes the same
> rows.
> → [analytic Q4](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Contradiction](business/settlement/analytic_context_clarify.md#contradiction)
>
> 🆕 **The fold became SQL, which is the most checkable thing in any of these docs — and it does not
> run.** Four statements: `+=` is not a Postgres operator, `SET d.col` is rejected (the alias is legal
> everywhere except the left of `SET`), and a `VALUES` list cannot see a CTE. Underneath the syntax the
> arithmetic is wrong in five places, two of them silent: `d.fund` appears **twice** in the
> `close_balance` sum, and the update recomputes `close_balance` **without** `open_balance` — so a day is
> correct until its second movement arrives and then loses all prior position, permanently, while still
> looking internally consistent. **Not a question** — the corrections are written out, and two statements
> replace four. ⛔ **What IS a question is the bucket day**: step 1 derives it from `created_at` in GMT+7
> while [posted-on-buckets-the-report](business/settlement/context_decision.md#posted-on-buckets-the-report)
> fixed it on `posted_on`, which is stamped on the **UTC** date with no timezone configured anywhere. The
> two disagree for every movement between 00:00 and 07:00 WIB.
> → [analytic — the write path](business/settlement/analytic_context_clarify.md#the-write-path-checked-statement-by-statement)
>
> **One line in the owner’s doc reversed this file’s own recommendation, and the reversal is worth more
> than the row it changes.** `settlement_context.md` gained `## General.` 1 — *"Design Analytic Principle
> is follow [this](business/analytic/context.md)"* — so the settlement report is built the **pipeline**
> way: log → broker → stream → report table, not a `GROUP BY`
> ([the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle)).
>
> ⛔ **This is the first time #7 has been answered by a decision rather than argued about — and it makes
> #7 BLOCKING for a second context.** Settlement’s report now inherits every open question in `analytic`:
> the fold contract, the rebuild path, the midnight reconcile, the dedup layer. A context that had
> finished designing its report in a day is now waiting on the one context that has not started.
>
> ⛔ **And the pipeline has no parts.** Checked against the code: `settlement_v1.Service` takes a
> `*gorm.DB` and no `EventSender`, there is **no settlement event message in the proto**, nothing
> consumes one, there is no report table migration, and there is **no analytic or report service in
> `backend/services/`**. [settlement-publishes-to-the-book](business/settlement/context_decision.md#settlement-publishes-to-the-book)
> was decided long ago and never built — so the *"Source Truth Logs"* box that the whole analytic design
> stands on is, for its one existing log, **a table nobody publishes**.
> → [settlement Q6](business/settlement/context_clarify.md#question)
>
> ✅ **Two answers that turned out to agree.** `## Whats Number to be reported.` lists the seven ledger
> types — which is an **additive basis** for the measure decided hours earlier, not a replacement for it
> (`sales`, `net_received` and `gap` are all derivable from those seven). And `posted_on` fits a stream
> processor better than the alternative would: a fold learns of a row when its event arrives, which is
> what `posted_on` already means.
>
> ⚠ **One contradiction, and it is mine.** The measure decision also asserted *"a fold over facts, not a
> stored table"* — overtaken the same day. The property worth keeping: **a decision about a MEASURE must
> not also assert WHERE it is computed.**
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **Sequencing was answered and then REVERSED, both within the day.** *Query first* was taken and is
> now cancelled — [the-report-is-the-pipeline-from-day-one](business/settlement/context_decision.md#the-report-is-the-pipeline-from-day-one)
> strikes [the-report-ships-as-a-query-first](business/settlement/context_decision.md#the-report-ships-as-a-query-first).
> So **settlement is blocked by `analytic` after all**, and by four missing pieces starting with a
> publisher it does not have. ⚠ **Two things are owed because that phase is gone**, and they are cheap now
> and expensive later: keep the aggregate as a **test oracle** even though it is never an RPC — it was the
> only independent second opinion the folded table would have had — and make the fold **re-runnable from
> the log by cursor**, because Pub/Sub retains messages for days and a definition change needs years.
> **The fourth dimension:** *Group by Customer Service* became **Group by User**
> ([the-fourth-shape-groups-by-user](business/settlement/context_decision.md#the-fourth-shape-groups-by-user)) — so the
> dimension is `actor_id`, which settlement already carries, and the *"a column that exists in no
> table"* blocker is gone without touching `selling_service`. ⚠ What replaces it is narrower: `actor_id`
> is **who wrote the row**, so an imported fee lands on the importer’s PIC rather than on whoever sold.
>
> ⛔ **Then a new section arrived that describes HOW a write happens — and it is where the day’s
> answers stop agreeing with each other.** `# Settlement Ledger.` draws the write protocol: open a
> transaction, lock the state, **call another service’s `InitOpeningBalance` inside it**, and **roll the
> ledger write back if that call fails**. Nothing of it is built — no `InitOpeningBalance`, no
> `settlement_states`, no daily shop report in the repo.
>
> | ✅ what it settles | ⛔ what it opens |
> | --- | --- |
> | **settlement DOES publish** — `Dispatch Event` finally gives [settlement-publishes-to-the-book](business/settlement/context_decision.md#settlement-publishes-to-the-book) a drawn path, which was the missing first part of the pipeline · the write is transactional and the state is **locked**, the right shape for two people on one shop | **a THIRD architecture for one report table** — a `GROUP BY` at read, a stream fold, and now a table the WRITER maintains synchronously · **a network call inside a transaction holding a row lock** · **a report failure rolls back money that really arrived** · an **opening balance**, which the measure decided hours earlier has no place for |
>
> ⚠ **It is also a concrete instance of #1 below, answered in the wrong direction.** One seam up, a
> publish failure must not fail the order — here a report-bootstrap failure fails the ledger write. The
> same question got opposite answers a paragraph apart.
> → [settlement Q7–Q9](business/settlement/context_clarify.md#question) ·
> [the protocol read in full](business/settlement/context_clarify.md#the-ledger-write-protocol--read-against-the-two-decisions-taken-today)
>
> ⚠ **And the state table now has two names** — `settlement_states` in the new section, `order_settlements`
> in the old one, in the migration, in the proto and in a recorded decision. Second time in this context
> that one concept has been written down twice.
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **And then the table itself arrived — with two silent defects.** `## Smallest Grain Reports.`
> names `shop_settlement_daily_report`, unique on `(day, shop_id, team_id)`, carrying per-type movements
> **and** an open/close balance — so the opening-balance question is answered, and answered as **both**
> ([the-smallest-grain-is-the-shop-day-statement](business/settlement/context_decision.md#the-smallest-grain-is-the-shop-day-statement)).
> ✅ The statement shape is only safe because `posted_on` already guarantees a closed day never moves —
> two answers taken hours apart that turn out to depend on each other.
>
> | ⛔ the defect | why it is silent |
> | --- | --- |
> | **`affiliate_fee` is not in the tracked columns** — six of seven types are | an affiliate cut moves `close_balance` while appearing in no column, so `close − open ≠ Σ movements` and the difference has no name. It is the one failure a statement shape exists to make impossible |
> | **there is no USER dimension** | the grain serves shapes 1–3 exactly and **cannot serve shape 4 at all**. ⚠ And the fix is not a wider key: a running position belongs to an ACCOUNT, whose later movements are posted by different people, so a per-user open/close is meaningless — the second table must be **sums only** |
>
> → [settlement Q9](business/settlement/context_clarify.md#question) · [settlement Q10](business/settlement/context_clarify.md#question)
>
> ✅ **Both defects were answered within the hour — one fully, one half.** A second grain table
> `user_settlement_daily_reports` now exists, keyed `(day, user, team)` rather than widening the shop
> table’s key ([the-user-grain-is-a-second-table](business/settlement/context_decision.md#the-user-grain-is-a-second-table)),
> so shape 4 has a source. ⛔ It copies `open_balance` / `close_balance`, which is the half that does not
> transfer: a running position belongs to an **account**, whose later movements are posted by different
> people, so a user’s closing figure is not a position that user holds.
> → [settlement Q9](business/settlement/context_clarify.md#question)
>
> ✅ **And the reason for `InitOpeningBalance` is now stated — a lost update on the window aggregation.**
> The race is real and worth guarding. ⛔ But it justifies **a** guard, not **this** one: the contended
> row is the report’s, so the guard belongs there — serialize the fold on the broker’s ordering key
> `(shop_id, day)`, or `INSERT … ON CONFLICT DO NOTHING` in the report’s own transaction. Neither needs a
> network call held inside the ledger’s transaction, and neither can roll a settlement write back.
> → [settlement Q8](business/settlement/context_clarify.md#question)
>
> ✅ **And the two balance columns turned out to be simpler than the argument about them.** They are
> **snapshots aggregated from the log at the day boundaries**, never carried forward
> ([open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)).
> No carry means no dependency on a previous row, every day is recomputable from `settlement_logs`
> alone — which is the rebuild path the cancelled query phase was going to supply — and
> `close − open = Σ movements` stops being a convention and becomes an **identity**, which makes the
> missing `affiliate_fee` provable rather than suspected.
>
> ✅ **It is also only well-formed because the date is `posted_on`** — `balance` is stamped in WRITE
> order, so *"the position at the end of day D"* means *"the last row written by D"*, which `occurred_on`
> could not express. **Third time those two answers have turned out to depend on each other**, and worth
> naming as a pattern: this context’s decisions are compounding rather than accumulating.
>
> ⛔ **And it forces an older question.** A shop snapshot partitions the book exactly once; a user
> snapshot only does if the set is *the orders that user opened*. So the user table’s balances cannot
> exist unless shape 4 is attributed to the order’s opener rather than the row’s writer — one answer now
> decides two questions.
> → [settlement Q9](business/settlement/context_clarify.md#question) · [settlement Q5](business/settlement/context_clarify.md#question)
>
> ✅ **`affiliate_fee` landed in both grain tables**, so the identity `close − open = Σ movements` can
> hold and the one defect that would have made a statement silently fail to reconcile is gone.
>
> ⚠ **And two of this context’s questions MERGED**, which is worth more than either being answered:
> shape 4’s grouping and the user snapshot’s set cannot be decided separately, because a snapshot only
> partitions if the dimension owns the account. One answer now settles both — and it is the same shape of
> compounding this context has shown three times already, where a decision taken for one reason turns out
> to constrain something decided hours earlier.
>
> ✅ **And the attribution was answered the consistent way** — *"the user is who created the order"*
> ([the-user-is-the-order-creator](business/settlement/context_decision.md#the-user-is-the-order-creator)).
> Shape 4 is a sales report, the user snapshot partitions the book exactly once, and imported fees stop
> piling onto the importer’s PIC.
>
> ⛔ **It names a person settlement does not record.** `actor_id` is *who wrote the row* and stays that,
> so the creator needs a column — **`order_settlements.creator_user_id`, stamped by the opening row**, is
> the cheap shape, because the fold then joins log → state inside one service. ⚠ And an account whose
> `initial_total` never arrives has **no creator at all**: settlement ignores order status, the exporter
> can post a `fund` first, and a `marketplace_total = 0` order opens no account — real money with nobody
> to attribute it to.
>
> ⚠ **This raises the price of #1 below rather than lowering it.** With no `order_service → settlement`
> call built, nothing stamps a creator on anything, so the user report is not merely empty — it has no
> dimension. The unbuilt seam now blocks two tables.
> → [settlement Q5](business/settlement/context_clarify.md#question)
>
> ⛔ **Then the empty heading was filled — and it disagrees with an answer given an hour earlier.**
> `## How `*_settlement_daily_reports` Created` says today’s row takes the **last row’s `close_balance`**
> as its `open_balance`, or 0 if there is none. But *"open and close balance is sum of balance log of
> start and end of the day"* made those columns a **snapshot aggregated from the log**
> ([open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)).
> A snapshot and a carry are not the same number, and they diverge in three reachable ways: **`open = 0`
> is wrong for every shop that already trades**, a chain **cannot be rebuilt from one end**, and **one
> missed day poisons every day after it, silently and permanently**. The snapshot has none of those.
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **And `## General.` — the line that chose the architecture — has been DELETED.** *"Design Analytic
> Principle is follow this"* is no longer in the doc, and it is the entire basis of
> [the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle).
> ⚠ **A deletion is not a statement**, so it is not recorded as a reversal — but the decision now rests on
> a line that does not exist, and the section that replaced it describes a row **created on demand from
> the previous one**, which is the writer’s path rather than a fold’s. Both moves point away from the
> pipeline, and the query phase was cancelled on the strength of it.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ⚠ **A re-examination with nothing new in the doc — and the finding came from next door.**
> `settlement/context.md` changed by one byte since the last pass and no code has landed since 08-28, so
> none of settlement’s eight questions moved. What moved is the sibling: `analytic` recorded
> [reports-belong-to-the-consumer](business/analytic/context_decision.md#reports-belong-to-the-consumer),
> which relocates *"which numbers, for whom"* to each consuming service — **and cites settlement as its
> proof, on the strength of settlement *"pointing here for the principle"*. That pointer is the
> `## General.` line settlement deleted.** One context has built a decision on a reference the other no
> longer contains, which makes the deleted line a two-context question rather than a one-context one.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ✅ **The deleted line was deliberate: *"because its not mature"*.** Settlement will not bind its
> report to an unfinished design
> ([the-analytic-pointer-is-withdrawn-until-it-is-mature](business/settlement/context_decision.md#the-analytic-pointer-is-withdrawn-until-it-is-mature)),
> so [the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle)
> is **withdrawn** and the reason the query phase was cancelled goes with it.
>
> ⚠ **Two of three architectures are now struck, and the survivor is the one the doc actually details** —
> the ledger’s own write path. If that holds, settlement needs **no publisher, no broker and no consumer**
> to have a working report, which is a far smaller build than the last two rounds assumed — and it makes
> the in-transaction guard argument the whole of what is left, because the ledger’s transaction really
> would be doing report work.
>
> ⚠ **This row’s own #7 loses its example.** [reports-belong-to-the-consumer](business/analytic/context_decision.md#reports-belong-to-the-consumer)
> was argued on settlement pointing at analytic *"for the principle"* — the line withdrawn here. The
> decision may still be right; its evidence is not.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ## The round before
>
>
> **The ledger got its first WORKLOAD, and it cannot serve any of it yet.**
> [business/settlement/context.md](business/settlement/context.md) gained `# Settlement Reports.` —
> four report shapes at three grains (team, shop, customer service) over a daterange, at daily /
> monthly / yearly resolution.
>
> | what it settles | what it opens |
> | --- | --- |
> | ✅ **the first concrete answer to #7's demand** — *name the questions a real person asks*. These are real, named, and at a grain the repo already stores · ✅ **and the whole report was settled the same day** — the measure ([the-measure-is-sales-received-and-gap](business/settlement/context_decision.md#the-measure-is-sales-received-and-gap)), the fold ([the-report-is-movement-dated](business/settlement/context_decision.md#the-report-is-movement-dated)) and the date ([posted-on-buckets-the-report](business/settlement/context_decision.md#posted-on-buckets-the-report), ⚠ against recommendation) | ⛔ **"customer service" is a column in no table** — not on `settlement_logs` (its `actor_id` is who *typed the row*), not on `orders` |
>
> ⛔ **Two of the four shapes cannot be authorized as written.** `team_id` is `use_scope` and required
> `> 0` on every settlement request; a report with one row PER team is by definition the thing the
> scope forbids. Either they are declared **admin screens** — ROOT/ADMIN in team 1, the bypass that
> already exists — or a `repeated team_id` becomes a **new authorization primitive**.
> → [settlement C5](business/settlement/context_clarify.md#critique)
>
> ⚠ **And the two docs describing this pipeline still do not cite each other.** Settlement says it
> *serves* these reports — [analytic/context.md](business/analytic/context.md) says a stream processor
> builds them, from the same three grains. **→ Settlement's own `GROUP BY` first**, on the precedent
> named below: `revenue_service` was the pipeline version of exactly this and lost to a plain
> aggregate over fact rows.
> → [settlement C6](business/settlement/context_clarify.md#critique) · [settlement Q5–Q7](business/settlement/context_clarify.md#question)
>
> ## Two rounds back
>
> **Analytic named its audiences, and a re-examination against the code found the precedent nobody
> had cited.** [business/analytic/context.md](business/analytic/context.md)'s `## Responsbility` went
> from *"Provide Analitical Data to user"* to **three named audiences** — Warehouse Team, Selling
> Team, Admin Team.
>
> | what it settles | what it opens |
> | --- | --- |
> | ✅ **half of #7.** *For whom* is answered — and answered better than it looks: all three are **`TeamType` values**, so the audience list is a **scope list**, which lands directly on the report table's grain | ⛔ *which numbers* is still unstated, so #7 stands · 🆕 **one order fact belongs to three of them at once** — `OrderPlacedEvent` carries the selling team, the fulfilling warehouse **and** a supplying team per line, against one `Report Table` box · 🆕 **"Admin Team" has no code path** — the scope bypass is by ROLE in team 1, not by `TEAM_TYPE_ADMIN` |
>
> ⛔ **The foundation is the least-built part of the system.** Of the four *"Source Truth Logs"* the
> ledger doc names and this design stands on, checked against the migrations: **one exists.**
> `settlement_logs` ✅ · `stock_movements` ⚠ close enough · **`expense_records` is not a log** — an
> entity table whose `ExpenseUpdate` rewrites **amount, kind and the month it belongs to** in place,
> publishing nothing · **purchasing has no service and no table at all**. So a folded bucket can go
> wrong twice — the month a cost left and the month it joined — with no message to tell anyone, and
> that is shipped behaviour *before* any pipeline exists.
> → [analytic C13/C14](business/analytic/context_clarify.md#critique)
>
> ⛔ **The finding that should change the argument: this repo already BUILT this design and DELETED
> it.** `revenue_service` was a push subscriber on `order-placed`/`order-cancelled` with its own
> report table and a daily rollup — six issues of work (#74, #75, #78, #153, #164, #171) — removed in
> `0d4cbc4`. Two details matter: it lost to the **actual** data (settlement, at order grain) rather
> than to a better pipeline, and its `RevenueDaily` was a **`GROUP BY` over the fact rows**, not a
> bucket table. The one daily report this repo shipped needed no incremental aggregation at all.
> → [the record](business/analytic/context_clarify.md#the-report-table-this-repo-already-deleted)
>
> ⚠ **A correction to this file's own last round.** It repeated the clarify's claim that *"nothing on
> that diagram has ever run"*. **Wrong** — [liability_service/push_handler.go](../backend/services/liability_service/push_handler.go)
> consumes both order events and charges real ledger fees, so **push is the deployed mode** and the
> doc's "push *and* pull" really reads *"add pull"*. What genuinely does not exist: any **pull**
> subscriber, and any **broker** in the dev server (`event_sender.go` is a synchronous in-process
> loopback, so no retry, redelivery or dead-lettering is exercised anywhere). ⚠ Exactly the failure
> the header warns about, twice in three rounds: a claim carried forward without opening the file.
>
> ## Earlier rounds
>
> **The last unwritten context got a design — and it arrived from the far end.**
> [business/analytic/context.md](business/analytic/context.md) went from seven lines to forty, and all
> forty are architecture: Pub/Sub, push *and* pull, a stream processor, a report table. Its only
> statement of business is still line 8, *"Provide Analitical Data to user"*.
>
> | what it settles | what it opens |
> | --- | --- |
> | analytic is **no longer a blank page** — there is a concrete pipeline to argue with, authored by **Heri** for a lane that is **Toni's** ([analytic-sits-with-stock](business/project/member_decision.md#analytic-sits-with-stock)), with a second design invited for comparison | ⛔ **nobody has said which numbers, for whom** — so no part of the pipeline can be judged · the design **already exists at higher resolution** in [mutation_and_ledger `# Statistic Design.`](technical/ledger/mutation_and_ledger.md), and the two copies **already disagree** · `Source Truth Logs` is one box where [ledger/context.md](business/ledger/context.md) has four, in four services across **both** lanes |
>
> ⛔ **The contradiction is the load-bearing one.** `mutation_and_ledger.md` says statistic is
> *"streaming **and** reconcile every midnight + 1 hour"* — the analytic diagram has **no second path**.
> If reconcile is real the broker is an optimisation and a lost message is self-healing; if the diagram
> is right, the publish-after-commit hole ([mutation_and_ledger C5](technical/ledger/mutation_and_ledger_clarify.md#critique))
> becomes a permanently wrong report with nothing to detect it.
> → [analytic Contradiction](business/analytic/context_clarify.md#contradiction)
>
> ⚠ **It displaces the withdrawal question from the display** (was #7 — unchanged, still open, still
> counted below). The rule at the top is what did it: *"which numbers, for whom"* **stops a lifecycle
> pass** — analytic cannot enter `implementation_analysis` without it — where the withdrawal question
> blocks a reconciliation nothing has built yet and already has a recommended home.
>
> ✅ **Nothing on that diagram has ever run.** `san_event` has the receive half built (`Claim`,
> `Handled`/`Duplicate`/`Rejected`, rejection recording), but **no subscription consumes anything** —
> `inventory_service/push_handler.go` acks every message as a no-op. The pipeline is a proposal, not a
> thing to migrate off.
>
> ## Earlier still
>
> **A new file, and it asks a question of a different KIND: not what the system does, but who
> decides.** [business/project/member.md](business/project/member.md) is the first doc in the repo
> that names a person — Heri, Hendra, Toni — and assigns scope to two of the three.
>
> | what it settles | what it opens |
> | --- | --- |
> | **seven of the eight contexts and 10 of the 12 services** are now assigned — Heri holds 8 services (75 RPC / ~13.1k lines), Toni 2 (60 RPC / ~9.8k) plus two greenfield contexts — `stock`, `product`, `analytic` → Toni · `order`, `settlement`, `balance`, `user` → Heri ([products-follow-the-unit-price](business/project/member_decision.md#products-follow-the-unit-price) · [analytic-sits-with-stock](business/project/member_decision.md#analytic-sits-with-stock) · [identity-sits-with-order](business/project/member_decision.md#identity-sits-with-order)). Hendra is on legacy and **joins later**, so there are **two deciders, not three** ([hendra-joins-later](business/project/member_decision.md#hendra-joins-later)) · the four support services → Heri ([support-services-sit-with-order](business/project/member_decision.md#support-services-sit-with-order)) | ⛔ **`ledger` is the last unowned one** — four producers publish events into it across both lanes, one reader out of it, and **7 of the questions below** sit inside it · no boundary between the two lanes has an owner either · and with two deciders a disagreement has no majority |
>
> ⚠ **The absent member makes it worse, not smaller.** `ledger` cannot be parked on someone who has
> not arrived — a reserved scope and an unowned one are identical for every question asked in
> between — so it needs an owner among the two people here. 🔄 **→ Toni**, reversing this file's
> previous answer: the ledger is a **Pub/Sub subscriber** with four producers spanning both lanes,
> so no producer waits on it and none of them is picked out as its owner — while its **only reader,
> `analytic`, is Toni's**. ⚠ Whoever takes it inherits *purchasing*, a first-class producer in the
> owner's own diagram with **no service and no context doc**
> ([ledger C5](business/ledger/context_clarify.md#critique)).
>
> ✅ **Concurrency is not the constraint.** Exactly **one** in-process import crosses the two lanes
> (`inventory_service` → `liability_service`); everything else crosses over the proto contract. What
> two people actually collide over is generated files and registry lists, all mechanical
> ([member_clarify.md](business/project/member_clarify.md#working-concurrently--the-split-is-fine-the-shared-files-are-the-problem)).
>
> ⚠ **It does not displace a row, and the reason is worth writing down.** Every question below is
> still answerable today, because one person still answers everything — so nothing is *blocked* by
> the routing being unwritten. **The moment three people answer, this becomes #1-shaped**: 16
> `_clarify.md` files address *"the owner"*, and `CLAUDE.md` merges to `main` *"when the owner
> asks"*. Both are now ambiguous in a way no single file can resolve.
> → [member_clarify.md](business/project/member_clarify.md#question)
>
> ## Earlier than that
>
> **Three questions answered, and a re-examination that re-ordered the list.** The owner asked which
> open questions blocked the FRONTEND analysis, was given the triage, and answered all three.
>
> | the question | the answer | |
> | --- | --- | --- |
> | *Summarize All Balance* — screen or tiles? | **the tiles** | [the-summary-is-tiles-on-the-list](technical/balance/team_balance_design_decision.md#the-summary-is-tiles-on-the-list) |
> | where is the DEFAULT terms row edited? | **a dialog on the list** ⚠ against recommendation | [the-default-terms-row-is-a-dialog-on-the-list](technical/balance/team_balance_design_decision.md#the-default-terms-row-is-a-dialog-on-the-list) |
> | does `found` need the owner's acknowledgement? | **no** ⚠ against recommendation | [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) |
>
> ⛔ **One of them moved weight rather than removing it, and it landed at #3.** Refusing `found` a
> handshake makes **dispute** a team's only recourse against a charge asserted in the asserter's
> favour — and dispute does not exist.
>
> ### ⚠ The re-examination finding: this file was ranking questions the CODE had already answered
>
> Four of the seven rows were checked against the source rather than against the docs, and four had
> moved without the file noticing:
>
> | was ranked as | actually |
> | --- | --- |
> | the ledger vocabulary migration, #3 | ⛔ **not a question at all** — migration `00005` shipped the vocabulary, `actor_id` and `liability_logs`. Removed |
> | *freight divides by the EXPECTED quantity*, half of #1 | ✅ **already correct in code** — [restock_request_fulfill.go:210](../backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by what arrived. The owner's DIAGRAM draws it the other way, so the question is about the diagram |
> | *what moment consumes a FIFO layer*, #4 | ⚠ **built the way this file recommended**, unratified. Demoted to #7 as a ratification |
> | *where is the DEFAULT row edited*, #7 | ✅ answered this round |
>
> **The cause is named in [the balance state report](development_state/balance/context.md): contexts here
> were built before they were designed.** A rollup derived from `_clarify.md` alone inherits that — it
> cannot see that the code has taken a position, so a settled question keeps its rank. ⚠ **Code taking
> a position is NOT the owner deciding one** (HARD RULE 8), so none of these is closed by being built.
> But *"nobody has decided and nothing is written"* and *"it is running, please ratify it"* are
> different sizes of open, and only the first belongs near the top.
>
> **→ Every rebuild from here checks the top rows against the code**, not only against the clarify files.
>
> ## Live and not a question
>
> ✅ ~~**Nothing below the contract is verified.**~~ **Stale — removed.** This said migrations had
> never run and every DB-backed test skipped. It has been overtaken: the balance pass records unit,
> integration and e2e green together for the first time
> ([balance state](development_state/balance/context.md)), and `6ae4d55` (2026-08-31) is *"the e2e
> suite is green"*. ⚠ Exactly the failure this file's own header warns about — a claim carried
> forward without being checked against the code.
>
> ⚠ **"Summarize All Balance" is computed over ONE PAGE, and the answer made that binding.** Three of
> the four tiles on `/liability` reduce the loaded 20 rows, so a creditor with 21 counterparties reads
> a headline that omits one — and now the summary is fixed as tiles on a **paginated** list, it can
> never run a whole-set query of its own. The fourth tile, *awaiting confirmation*, already comes from
> the server and is the precedent for the other three
> ([technical balance C16](technical/balance/team_balance_design_clarify.md#critique)).
>
> ⛔ **The 80% warning has TWO homes named in §About Thresholds 1 and is in NEITHER.** One of them, the
> daily report, is parked ([the-daily-report-is-deferred](business/balance/context_decision.md#the-daily-report-is-deferred))
> — and it was the DEBTOR's view, so what survives warns the person who is fine rather than the person
> about to stop trading ([technical balance Q9](technical/balance/team_balance_design_clarify.md#question)).

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **How is a half-succeeded order FOUND afterwards?** 🔄 **REFRAMED, and the old framing was wrong on three counts.** This row said there is *"no outbox, no saga and no compensation anywhere in the repo"* and that settlement *"sits on the critical path"*. Opening the files: [team_create.go:21](../backend/services/team_service/team_v1/team_create.go#L21) **is** an explicit saga (commit locally, grant remotely, soft-delete on failure) · [order_place.go:246](../backend/services/selling_service/selling_v1/order_place.go#L246) **is** an explicit compensation (`stock.Return`, with `picked` set BEFORE the call because *"a Pick whose result never reached us may well have committed"*) · and settlement's leg is **decided** ([the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement)). ✅ **The PRE-COMMIT half is handled**: the pick runs INSIDE the order's transaction, so not enough stock rolls the order back and none exists. ⛔ **What is actually open is the POST-COMMIT half, and it is one gap at three sites** — the `OrderPlacedEvent` publish (liability never charges the order fee), `SettlementPost` (no account opens), and `catalog.Snapshots` (an unresolved owner rides as **0**, which liability reads as *nobody to pay*). All three end at *"logged loudly"*, and **nothing enumerates which orders are in that state**. 🆕 ⚠ And the event architecture now **assumes the publish succeeds** ([no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)), so for the event leg the finder is the only detector there is. ⚠ The third is the worst: it logs no failure an operator would act on, so a transient catalogue blip becomes a fee never charged and never surfaced. | ⛔ every order whose downstream row silently never appeared — fees uncharged, accounts unopened, with no list of them anywhere | [order Q14](business/order/context_clarify.md#question) — ➡ **re-routed there by the owner (2026-09-10)**, from architecture and settlement, neither of which can answer it | **A finder per leg** — a query listing committed orders with no downstream row. It needs no saga, no outbox and no new mechanism, and all three legs already assume it exists: [the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement) flags *⛔ how a missing account is FOUND* as its own undecided half. ⚠ **And record the premise clash**: `architecture/context_clarify.md` says *"the amount is only known AFTER the draw, so the gate cannot run before it — step 7 is the whole design"*, while the shipped code runs the gate FIRST on a `UnitCosts` read and states the trade (*"the staleness that allows is exactly the overshoot the `debt < limit` rule already permits"*). `draw → gate → commit → release` describes an ordering the code deliberately inverted. |
| **2** | **Can the stored carry drift from its own definition without anything noticing?** 🆕 **Opened by the decision that closed the old #2.** [the-carry-materialises-the-day-boundary-position](business/settlement/context_decision.md#the-carry-materialises-the-day-boundary-position) reconciled the two balance decisions that looked like rivals: *"open balance is start balance of the day, close balance is end balance of the day"* is what the number **MEANS**, the stored carry is how it is **KEPT**, and the cascade is the bridge between them. ⛔ **That converts a definitional argument into a bug class.** Any path where the cascade does not run — a partial commit, a replay that skips a day, a genesis seeded wrong — leaves the stored copy unequal to its own definition, and **`close − open = change` still holds on every row**, so no invariant on the table detects it. ⚠ It was harmless while the columns were unread. With [a-past-date-position-is-a-real-screen](business/settlement/context_decision.md#a-past-date-position-is-a-real-screen) it is a wrong figure a person acts on. ⚠ **And a second reader-facing rule is unstated**: a day with no movement has **no row**, so a position query that does not fall back to the last row at or before the date returns "no data" for a day the shop plainly had a position. | ⛔ the correctness of every absolute figure on the one screen that reads them — silently, with the table's own invariant still satisfied | [analytic Q3](business/settlement/analytic_context_clarify.md#question) · [analytic Awaiting](business/settlement/analytic_context_clarify.md#awaiting) | **One reconcile RPC, checking a scope against the log it materialises**: `close_balance(D) = Σ change WHERE posted_on <= D`, same service, no HARD RULE 3 problem. On demand to start with rather than nightly — it is the only check the eager write path cannot perform on itself, and it is the same reconcile pass [mutation_and_ledger.md](technical/ledger/mutation_and_ledger.md) already promises elsewhere. **→ And state the gap-day fallback** (`WHERE day <= @as_of ORDER BY day DESC LIMIT 1`) in the doc rather than leaving it for whoever writes the screen. ⚠ **Also still open beside it**: does the past-date screen exist per **USER**? On `user_settlement_daily_reports` the same columns mean a person's lifetime running total of hidden cost, which only grows — so the newest CS always looks best. Recommend dropping the carry from the user table only, which also halves the cascade on the busier of the two tables. |
| **3** | **How is drift repaired when the LOG is already right and only the FOLD was lost?** 🔄 **Reshaped — the ledger-or-report half was ANSWERED in a day.** `context.md` made `system_adjustment` an eighth `settlement_type`, so it is a **ledger row**, shop-addressed, reaching the report through the broker — against my recommendation, and my report-column proposal is **withdrawn**. ✅ **That also unblocked #2**: with the adjustment in the log, the reconcile stays `close_balance(D) = Σ change` and needs no second term. ⛔ **What survives is the case the design cannot express.** The adjustment moves the log and the report **together, by the same amount** — so it repairs damage where BOTH were wrong, and cannot repair damage where only the report was. ⚠ **And “only the report” is what every known drift cause produces**: a dead-lettered event, a cascade that did not run, a genesis seeded wrong, a replay that skipped a day — in all four the log already holds the truth. Posting an adjustment there overstates the log by exactly the amount it corrects the report by, so the two end up disagreeing permanently and the reconcile reports a difference forever — which is how a check gets switched off. | ⛔ out-of-window report drift, which the replay cannot reach by decision and the adjustment cannot express — and, through the reconcile, the credibility of the only drift detector | [settlement context clarify](business/settlement/context_clarify.md#-system_adjustment-in-the-log-repairs-one-class-of-damage-and-cannot-repair-the-other) | **A targeted DAY RE-FOLD from the log** — re-read one scope's rows for one day and rewrite that day. It reaches **any** date because the log has no retention limit, it needs no adjustment row, and it leaves the ledger true. ⚠ **It is a second reader of the log**, which [the-replay-seeks-the-broker](business/settlement/context_decision.md#the-replay-seeks-the-broker) deliberately avoided — but that decision governed a RANGE replay through the webhook, and this is one day, on demand, for repair. Decide it on its own rather than inheriting that answer. ⚠ **Keep `system_adjustment` for what it is genuinely for**: a fact that was never recorded at all, where log and report are wrong together and move back together. |
| **4** | **Does the courier's TIP belong inside the frozen unit cost?** ⚠ **HALVED by re-examination, and the surviving half is verified in code.** This row used to merge a denominator defect and a numerator one. **(a) The denominator is already right** — [restock_request_fulfill.go:210](../backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by `sellableTotal`, what actually arrived with damaged units excluded, and the line cost by `line.quantity`, the received one. The owner's flow diagram draws it the other way round, so [stock Q1](business/stock/context_clarify.md#question) is a question about the DIAGRAM, not a live defect. **(b) The numerator stands** — `freight := rr.ShippingCost + costLineTotal`, under the comment *"EVERY OUTLAY IS FREIGHT"*, capitalises the incidental fee that `balance_context.md` defines as a courier's *"coffe tip"* into a cost frozen for the life of the batch. ⚠ **And it compounds with a decision taken this round**: a breakage reimbursement pays at COGS, so the warehouse is repaid a tip it charged, and [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) lets it reverse that reimbursement unilaterally. | every batch's frozen unit cost — and therefore COGS, margin, the cross-charge (COGS × markup) and breakage payouts, for the life of the batch | [product Q6](business/product/context_clarify.md#question) · [stock Q1](business/stock/context_clarify.md#question) | **Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost; an unpredictable ask at the door is not. One line — `freight := rr.ShippingCost` — with `costLineTotal` still posting to the balance. ⚠ Note `freightPerUnit` is integer division and **floors**, so a small tip contributes **0 per unit** while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **5** | **🆕 Which markup does the LEDGER charge from?** ⛔ **A live billing discrepancy, found while acting on an owner decision.** The cross-product markup is stored TWICE and nothing keeps the copies equal: `products.cross_markup_bps` is what the product detail QUOTES a borrowing team, and `liability_terms.product_markup_bp` is what [`order_fees.go:144`](../backend/services/liability_service/liability_v1/order_fees.go) actually CHARGES it. Set one to 20% and leave the other at 5% and the quote and the invoice disagree — in whichever direction was edited last, silently, with neither screen able to see the other. ✅ The OWNERSHIP is settled: the rate is `product_service`'s ([the-cross-markup-belongs-to-the-product](business/balance/context_decision.md#the-cross-markup-belongs-to-the-product)), and the balance screens no longer show it. What is open is only which number the posting reads. | every cross-sold order's fee — the amount a team is quoted versus the amount it is billed | [technical balance Q10](technical/balance/team_balance_design_clarify.md#question) · [Contradiction](business/balance/context_clarify.md#two-markups-exist-and-the-screen-and-the-ledger-read-different-ones) | **`order_fees.go` reads the PRODUCT's rate when it freezes the fee, and `liability_terms.product_markup_bp` is dropped in the same migration.** Balance is then told the amount rather than asked to compute the rate — already true of every other cause. ⚠ **Three things land together or the fee breaks**: the read moves, the column goes, and the frontend's pass-through bridge is deleted. |
| **6** | **How does the decided `Event` get PUBLISHED at all?** 🔄 **Re-decided twice** — one global `Event` in `warehouse.events.v1`, and now each variant names ONE topic ([one-event-one-topic-per-variant](technical/event_architecture/context_decision.md#one-event-one-topic-per-variant)), the owner having cancelled the multi-topic half of [superseded-one-event-many-topics](technical/event_architecture/context_decision.md#superseded-one-event-many-topics), which had itself superseded [superseded-no-global-event-envelope](technical/event_architecture/context_decision.md#superseded-no-global-event-envelope). ✅ Provisioning is settled too, as a library function whose flow belongs to the caller ([initialize-topic-is-a-function-not-a-flow](technical/event_architecture/context_decision.md#initialize-topic-is-a-function-not-a-flow)). ⛔ **Neither makes the first event writable — the shipped library can publish none of the decided shape.** `TopicName()` reads one `event_topic` off the message PUBLISHED, and `Event` carries no option (the topic sits on the variant) · `san_event.Event` demands `GetEventId()` + `GetOccurredAtUnix()` (✅ the envelope now carries `event_id` itself — [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads)) · (✅ dispatch is not on this list — the owner's `EventPushHandler` takes the whole `Event`, so `Register[T]` keying on the decoded type is right with `T = Event`) · ✅ fan-out is no longer on this list — one topic per event is one publish. ✅ **No proto question blocks the first line any more** (🆕 Q14 — `identity`'s number and its no-identity case — shapes it without blocking it, and ✅ who supplies it is now decided: the CALL SITE passes it, [identity-is-a-sender-parameter](technical/event_architecture/context_decision.md#identity-is-a-sender-parameter)): the option lives in `warehouse.events.v1` and `event_base.v1` is removed ([event-base-v1-is-removed](technical/event_architecture/context_decision.md#event-base-v1-is-removed)), and the metadata's type and the ordering key (none, for now) are decided. ⛔ **And the removed doc's content is still only in git** (`git show d54b182:…`), carrying `san_event = 50099` — an option `TopicName()` would never see. 🆕 ⛔ **And the ENCODING is now decided** — `protojson`, [events-are-encoded-with-protojson](technical/event_architecture/context_decision.md#events-are-encoded-with-protojson), against my recommendation. It does not block the first event: the shipped code already marshals protojson. It adds a permanent hazard the library must guard — the wire identity is the field NAME, so renaming a `oneof` arm drops the whole body silently ([Q15](technical/event_architecture/context_clarify.md#question)). 🆕 ⛔ **Nor can it be RECEIVED safely**: the wired push path has no dedup, a real push's full subscription path misses every short-name match, and the delivery attempt is never read — [the receive half](technical/event_architecture/context_clarify.md#the-receive-half-is-built-twice-and-wired-once) · ✅ what a consuming service implements is decided — [one-contract-for-both-handler-types](technical/event_architecture/context_decision.md#one-contract-for-both-handler-types) · [one-adopter-checklist-for-both-drivers](technical/event_architecture/context_decision.md#one-adopter-checklist-for-both-drivers) · [pull-worker-is-bounded-and-fails-loudly](technical/event_architecture/context_decision.md#pull-worker-is-bounded-and-fails-loudly) · ⛔ [push-routes-are-open-by-default](technical/event_architecture/context_decision.md#push-routes-are-open-by-default), against my recommendation. | ⛔ the first real event in the system — settlement's, which feeds the fold that dominates this page. It cannot be written today in any package | [event_architecture Contradiction](technical/event_architecture/context_clarify.md#contradiction) · [the costs](technical/event_architecture/context_clarify.md#what-one-global-event-costs-and-the-cheapest-answer-to-each) · [event_architecture — ✅ no open questions](technical/event_architecture/context_clarify.md#question), its [resulting spec here](technical/event_architecture/context_clarify.md#proposed--the-sender-for-q6) | **The library moves, in three changes**: `TopicName(event)` unwraps the `oneof` and reads the SET VARIANT's topic, an empty one an error (§5 made executable, and a descriptor test catches it in CI) · `san_event.Event` reads the envelope's own typed fields (✅ decided) · the receive path follows the decided handler contract, one route through `san_event.Receiver` for both drivers. ✅ **No outbox** — the publish is trusted ([no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)). **The proto is decided** — and `event_base.v1`'s removal must land in the SAME change that adds the new option and moves selling's two events and `TopicName()` to it, or the build breaks. **Provisioning**: ✅ decided — [setup-ensures-safe-defaults-never-deletes](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes), a developer's tool. **Receiving**: ✅ decided. Under open push routes, a consumer that writes a source of truth — liability's ledger — consumes by pull. |
| **7** | **Is the analytic PATTERN robust — and do its 14 rules hold?** 🔄 **Reshaped by a decision about ORDER OF WORK.** The owner settled it: *"we decide later what service follow this, for now make this principle robust first"* ([the-pattern-comes-before-its-consumers](business/analytic/context_decision.md#the-pattern-comes-before-its-consumers)), on top of `## Responsbility` becoming **"Provide Analytical Design Pattern"** ([analytic-is-a-pattern-not-a-data-product](business/analytic/context_decision.md#analytic-is-a-pattern-not-a-data-product)). ✅ **Three questions closed across two rounds** — *which numbers, for whom* · *is "Admin Team" team 1* (re-routed to [settlement C5](business/settlement/context_clarify.md#critique)) · *which consumer proves it* (deferred). ⛔ **What is left is the contract itself, and it is now written rather than requested** — 14 rules, each checked against a table that exists. ⚠ **Three already fail:** `expense_records` breaks append-only (`ExpenseUpdate` rewrites amount, kind and month in place) and the immutable-bucket-date rule, and **no source anywhere has a cursor-paged `LogRead`** — the pattern's one real build cost. ⛔ And the doc still names three report tables (team, shop, **supplier**) against a stated responsibility of *a pattern*, with its likeliest consumer needing **user** and having no supplier column at all. 🆕 **And the doc gained its rationale this round** — `### Why We Need Analytical Design Pattern.`, *"separate the operational domain from the analytical domain"*. It is right and one level too abstract to choose a design with: separation has four strengths, and the section leans on the cheap ones (load — a read replica fixes that) while omitting the only one that makes the pattern **necessary rather than preferred** — **HARD RULE 3 forbids a cross-service join, so a report spanning services cannot be a query.** ⛔ It is also now the strongest argument against two things already drawn: `Preload If Needed` re-couples the domains it separates, and a *pattern* naming a `supplier` table has absorbed one consumer's vocabulary. ⚠ And it opens a structural question — **is `analytic` a LIBRARY or a SERVICE?** | ⏸ nothing is blocked *today* — the deferral was deliberate. ⚠ **But an unimplemented pattern is unfalsifiable**, and settlement has already written *"follow this"* into its own doc | [analytic Q1](business/analytic/context_clarify.md#question) · [analytic Q2](business/analytic/context_clarify.md#question) · [analytic Q3](business/analytic/context_clarify.md#question) | **Ratify or correct the contract** — [what-the-pattern-owes-an-implementer](business/analytic/context_clarify.md#what-the-pattern-owes-an-implementer). Its load-bearing move is that **the event is a DOORBELL, not a delivery**: two paths over one fold — a best-effort fast path, a convergent tick, and a claim keyed on the source row so they overlap safely. That is the reconcile pass [mutation_and_ledger.md](technical/ledger/mutation_and_ledger.md) already promises, it makes the broker **optional to correctness**, and it retires the thin-vs-fat event argument outright. **Then: a measure set is a TABLE, a dimension is a KEY, and only `day` is stored** — [a-grain-is-a-key-a-measure-set-is-a-table](business/analytic/context_clarify.md#a-grain-is-a-key-a-measure-set-is-a-table). The diagram split on the wrong axis: team and shop are two dimensions of one measure set, supplier is a different measure set in `inventory_service`. For settlement that is **one** table and **one** fold instead of three-to-twelve, and adding `user` is a value rather than a migration. ⚠ One rule it exposes is per-SOURCE, not per-pattern: *team = Σ shops* holds for `settlement_logs` and **fails** for `expense_records` (`shop_id` `0 = not attributed`), so the pattern must make an implementer state it rather than assume it. **Split library from service by one rule**: a report reading ONE service's log is that service's own, folded in-process with a shared library (`settlement_daily` belongs to `settlement_service`, HARD RULE 3 clean) — a report reading SEVERAL needs an owner, and that is what an analytic service is for. Seven of the nine known questions are single-source, so the library carries most of the value. ⚠ **This revises my own earlier recommendation** of one analytic service for everything. And `Preload If Needed` is renamed or removed — it is the one box that invites a fold to read mutable state, which makes a rebuild disagree with the live run and nothing detects it. |

**⤵ Demoted, unanswered:** **which PRE-CHECKS does a draft run?** — promoted to #7 last round, pushed
off again by #3, and unchanged throughout. The ledger half is settled at finalize; what a *draft* checks
is not ([order Q4](business/order/context_clarify.md#question)). Recommendation stands: **none of it at
draft** — a draft holds an external SKU, so it has no product, no owner and no cost, and none of the four
are computable. The price: **finalize must re-check and may refuse.** ·
**can one ORDER's true result be read anywhere?** Marketplace money is
settlement's at order grain, the `order_fee` is balance's at pair grain, and `LiabilityLogListFilter`
takes `counterparty_id` and nothing else — so *"what did order 1 make"* has no reader
([balance Q9](business/balance/context_clarify.md#question)). Recommendation stands: **one `order_id`
filter**, never a second copy of the fee.

**⤵ Off the display, unchanged:** **where does a platform WITHDRAWAL live?** Wallet to bank, naming no
order — so it is none of settlement's seven types, and
[superseded-every-entry-names-an-order](business/settlement/context_decision.md#superseded-every-entry-names-an-order) made
`order_id NOT NULL`, which forbids the obvious workaround. Asked in two docs
([architecture Q7](technical/architecture/context_clarify.md#question) ·
[settlement Q3](business/settlement/context_clarify.md#question)). **→ Answer it once, in the
architecture clarify, and have settlement follow — `order_service`**, because the wallet is fed by that
shop's orders and the withdrawal is reconciled against them. ⚠ Its premise has since moved: `order_id` is
nullable now (recorded under *Before this round*), so the NOT NULL no longer forbids a settlement home —
the question is which home, not whether one exists.

## Where the other 98 are

⚠ **This table is every file's FULL open count, not the residue** — the seven above are rolled up
*from* these files, so the column sums to **105**, the whole set, not to 100. Previous rounds left
that ambiguous and the sums never reconciled with the header.

| File | Open | |
| --- | ---: | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 14 | ▲ was 13 — **#1 re-routed here** (owner): ensuring an order is whole is `order_service`'s, so *how a half-succeeded order is FOUND* is asked here now |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 10 | ▼ was 11 — Q2 became a pointer to order Q14. What stayed is a contradiction, not a question |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 8 | ▼ was 9 — `found` needs no handshake |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 | |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 | |
| [technical/balance/team_balance_design_clarify.md](technical/balance/team_balance_design_clarify.md#question) | 6 | ▲ which markup does the ledger charge from |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 6 | |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 | |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 | |
| [business/analytic/context_clarify.md](business/analytic/context_clarify.md#question) | 8 | ▲ the `### Why` section landed — it argues the pattern's case but names the wrong coupling, and it opens a structural one: is `analytic` a LIBRARY or a SERVICE |
| [technical/stock/design_clarify.md](technical/stock/design_clarify.md#question) | 4 | 🆕 counted for the first time |
| [business/project/member_clarify.md](business/project/member_clarify.md#question) | 5 | 🆕 who DECIDES, rather than what the system does. ▼ progress reporting is settled |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 | |
| [business/settlement/context_clarify.md](business/settlement/context_clarify.md#question) | 3 | ▼ was 5 — the ledger's mechanics are all settled. What is left: where a platform WITHDRAWAL lives, whether `problem funding` is `marketplace_adjustment`, and who PUBLISHES a ledger change (re-routed from the analytic clarify, which the owner scoped to receiving). 🆕 **Three new contradictions this round, no new questions** — `context.md` is doc-lagging the shipped tables, and two of the five stale sites were in the clarify itself |
| [business/settlement/analytic_context_clarify.md](business/settlement/analytic_context_clarify.md#question) | 5 | ▼ was 6 — `system_adjustment` decided as a ledger row in a day. What is left of it is **#3**, reshaped |
| [business/settlement/meta_context_clarify.md](business/settlement/meta_context_clarify.md#question) | 1 | 🆕 `settlement_service_metadata` — `analytic_status` is gone, `process_event_lock` replaced it — is this table CONFIG (human-set) or STATE (service-set)? |
| [technical/ledger/mutation_and_ledger_clarify.md](technical/ledger/mutation_and_ledger_clarify.md#question) | 3 | 🆕 counted for the first time |
| [technical/event_architecture/context_clarify.md](technical/event_architecture/context_clarify.md#question) | 0 | ▼ was 1 — ✅ **every question closed**: Q6, Q14 and Q15 all decided part by part, on top of Q1–Q13. **Twenty-three decisions**, the newest being the required `oneof`, one decoder, breaking the old protos accepted, `identity` settled in four parts, and CI on `dev` with `buf breaking` — applied. ⛔ **What blocks the first event here is a contradiction, not a question** — the shipped library cannot publish the decided envelope, and `context.md` lags its own decisions. See **#6** |
| [technical/cost/design_clarify.md](technical/cost/design_clarify.md#question) | 2 | ⚠ listed in *what changed* last round but never added to this table |
| [business/product/systems_clarify.md](business/product/systems_clarify.md#question) | 1 | |

> **Counted from each file's Question section, at either heading level.** Previous rebuilds matched
> `## Question` only, and five technical clarifies write theirs as `# Question` — so **17 open
> questions were silently excluded**, all six of technical balance's among them. ⚠ **Worth fixing at
> the source:** one heading level across every clarify makes this count mechanical instead of a
> judgement call.
