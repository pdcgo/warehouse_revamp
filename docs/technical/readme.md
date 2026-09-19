# Technical requirements and design

How the system gets built, written by the owner.

```
docs/technical/<big_context>/<small_context>.md
```

Same shape and the same two-file allowance as [../business/](../business/) — a `_clarify.md` for the
agent's open questions, a `_decision.md` for what the owner settled.

Design is **frontend-first** ([development lifecycle](../development_lifecycle.md)): pages and
components are built in Storybook with mock wiring so a screen can be previewed before any backend
exists, and the contract is derived from what the page must show and do — never the reverse.

[../../guidelines/](../../guidelines/) holds the programmer-authoritative service and code
guidelines, which are a different thing: rules that apply to every service, not the design of one.
