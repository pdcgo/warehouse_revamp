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
| `warehouse.event_base.v1.event_config` | `MessageOptions` | which Pub/Sub topic an event belongs to |
| `warehouse.role_base.v1.request_policy` | `MessageOptions` | who may call an RPC |

An event names its own topic; a publisher never does:

```proto
message OrderCreatedEvent {
  option (warehouse.event_base.v1.event_config).event_topic = "order-created";
}
```

⚠ **The generated option package must be linked into the binary**, or `proto.HasExtension` silently
returns false and the option appears absent.

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
