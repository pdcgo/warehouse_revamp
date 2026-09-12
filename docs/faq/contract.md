# FAQ — The proto contract

The API is defined once, in [`proto/`](../../proto/), and both sides are generated from it.

---

## Where do I change the API?

`proto/warehouse/<domain>/v1/`. One [buf](https://buf.build) v2 module serves both sides, so a
contract change is one edit and one command — no publish step in the middle of the design loop.

```sh
cd proto && buf lint && buf generate
```

- **Domain separation is directories**, `proto/warehouse/<domain>/v1/`.
- **Evolution is proto package versions**, `v1` → `v2` — never a second module.
- The proto package must match the directory (`warehouse.hello.v1` ⇢ `proto/warehouse/hello/v1/`).
  buf's `STANDARD` lint enforces it.

---

## I changed a `.proto` and nothing changed in my code. Why?

You did not run `buf generate`. After **any** `.proto` edit, run it from `proto/` before building
either side — it emits the Go server stubs (`backend/gen/`) and the TypeScript client
(`frontend/src/gen/`) together.

CI fails on generated drift, so committing the `.proto` without the regenerated output is caught,
but only after you push.

---

## Can I edit anything under `gen/`?

**No.** `backend/gen/` and `frontend/src/gen/` are committed but never hand-edited. Change the
`.proto` and regenerate.

---

## Does my list RPC need pagination?

**If the result can grow with the data: yes, and it is required.** Take a
`warehouse.common.v1.PageFilter page`, return a `warehouse.common.v1.PageInfo page_info`.

When in doubt, paginate. Removing a page filter later is a breaking change; adding one to a list
that already hurts is an incident.

| Case | Rule |
| --- | --- |
| a growing list (`TeamList`, `ProductList`, `UserList`) | **must paginate** |
| a capped typeahead (`SearchUser`, limit 1–20) | fine — it can never return "everything" |
| bounded reference data (`ShippingList`, the courier catalogue) | exempt, **and the proto says so**. The moment it can grow unbounded it stops being exempt |
| a picker that needs a WHOLE TREE (`CategoryList` → `CategorySelect`) | the one exception — a page is a flat window and a tree needs every node. Allowed only as a deliberate, documented **picker feed** |

⚠ A *browse / management* screen over that same tree must still paginate (load a level's children
by `parent_id`, which is naturally small). Never let a "load everything" picker feed quietly become
the backing for a growing management list.

---

## Where do I declare who may call an RPC?

**On the request message**, in the proto. There is no policy table — the ACL of the entire system
lives in the `.proto` files, and an interceptor reads it by reflection at request time.

```proto
message TeamInfoUpdateRequest {
  option (warehouse.role_base.v1.request_policy) = {
    roles: [ROLE_ROOT, ROLE_ADMIN, ROLE_TEAM_OWNER]
  };
  uint64 team_id = 1 [(warehouse.role_base.v1.use_scope) = true];
}
```

- `request_policy` extends **`MessageOptions`, not `MethodOptions`** — it goes on the request
  message, never on the `rpc`.
- **No policy means DENIED.**
- One field carries the team scope via `use_scope`.

`ValidateDescriptors()` runs at startup and refuses to boot on a `use_scope` tag that is non-uint,
nested, or duplicated — each of those is silent at runtime otherwise. Streaming RPCs are **refused,
not degraded**: a streaming interceptor cannot read the request body, so it cannot read the scope.

Debugging a denial: [backend.md](backend.md#why-is-my-new-rpc-returning-permission-denied).

---

## What other behaviour is declared on a proto message?

A recurring pattern here: behaviour is declared on the message and read by reflection at runtime,
so the contract is readable from the `.proto` alone.

| Option | Extends | Declares |
| --- | --- | --- |
| `warehouse.events.v1.event_config` | `MessageOptions` | which Pub/Sub topic an event VARIANT belongs to |
| `warehouse.role_base.v1.request_policy` | `MessageOptions` | who may call an RPC |

An event names its own topic; a publisher never does:

```proto
message OrderCreatedEvent {
  option (warehouse.events.v1.event_config).topic = "order-placed";
}
```

✅ **Built 2026-09-12.** Every event is a variant of ONE global `warehouse.events.v1.Event`, and each
variant names ONE topic
([one-event-one-topic-per-variant](../technical/event_architecture/context_decision.md#one-event-one-topic-per-variant)).
A second consumer is a second subscription on that topic, not a second topic on the event.
`warehouse.event_base.v1` is **gone**
([event-base-v1-is-removed](../technical/event_architecture/context_decision.md#event-base-v1-is-removed)) —
the option moved to `warehouse.events.v1` in the same change that moved selling's two order events onto the
envelope.

⚠ **The envelope's `oneof` is REQUIRED**
([the-event-oneof-is-required](../technical/event_architecture/context_decision.md#the-event-oneof-is-required)),
and that is not decoration. Events are encoded as `protojson`, so a field's wire identity is its NAME:
rename a `oneof` arm and every message already published decodes with the arm dropped — a valid-looking
envelope with **no body**. The required rule turns that into a recorded rejection instead of a silent ACK, and
`buf breaking` in CI is what catches the rename itself.

⚠ The event guideline still describes the per-context envelope these decisions overrode.

⚠ **The generated option package must be linked into the binary**, or `proto.HasExtension` silently
returns false and the option appears absent.

---

## What do I need installed to run `buf generate`?

**Go, and `cd frontend && npm install`.** No Buf account, no BSR token.

All three plugins are `local:` and pinned where the pin cannot drift:

| plugin | pinned by |
| --- | --- |
| `protoc-gen-go` | a `tool` directive in the root [go.mod](../../go.mod) |
| `protoc-gen-connect-go` | the same |
| `protoc-gen-es` | a devDependency in [frontend/package.json](../../frontend/package.json) |

That is deliberate: **a generator and the runtime it generates against must be the same version.**
`go tool protoc-gen-go` is built from the module's own `google.golang.org/protobuf`, and
`protoc-gen-es` sits beside `@bufbuild/protobuf` at a matching version. Bump one and you have
bumped the other.

⚠ **Do not `go install` them onto your PATH instead.** A global `protoc-gen-go` is whatever another
project needed, and generating with it rewrites every file with a different version stamp — the drift
CI's generated-drift check exists to catch.

---

## `buf generate` emptied `backend/gen` and `frontend/src/gen`. What happened?

[buf.gen.yaml](../../proto/buf.gen.yaml) sets `clean: true`, so buf **deletes both output trees
before running the plugins**. A run that fails therefore leaves them empty.

They are committed, so nothing is lost:

```sh
git checkout -- backend/gen frontend/src/gen
```

The usual cause is a missing plugin. Run it from `proto/` — the plugin paths are relative to the
working directory — and make sure `frontend/node_modules` exists.

---

## `protoc-gen-es` says "Cannot read properties of undefined (reading 'length')"

The plugin and `@bufbuild/protobuf` are different versions. It reads like a corrupt `.proto` and is
not: `protoc-gen-es` 2.2.x against a 2.12 runtime dies exactly this way.

```sh
cd frontend && npm ls @bufbuild/protobuf @bufbuild/protoc-gen-es
```

Both must be the same minor. That is why the plugin is a devDependency beside the runtime rather than
an `npx` invocation, which resolves whatever is newest.

---

## How do I call an RPC by hand, without the UI?

```sh
curl -X POST http://localhost:8080/warehouse.hello.v1.HelloService/SayHello \
  -H "Content-Type: application/json" -d '{"name":"world"}'
```

Connect serves JSON over plain POST, so `curl` is enough. Guarded RPCs also need an auth token and
a `team_id` in the body.

---

## What is `HelloService` for?

Scaffolding — it exists only to prove the pipeline works end to end. It gets deleted once a real
domain service replaces it.
