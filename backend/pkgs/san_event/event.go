// Package san_event provides the pieces a service uses to RECEIVE and DEDUP events. Nothing else.
//
// How a service then PROCESSES those events — batch, streaming, whatever fits — is the service's own
// scope, along with its tables, migrations, retention, position tracking, rebuild and reconcile. This
// package has no opinion and no machinery there.
//
// The authoritative design is docs/technical/event_architecture/context.md, and the decisions behind
// it are named in the comments below — they live in context_decision.md beside that doc.
//
// # There is ONE event type
//
// Every event in this system is a variant of warehouse.events.v1.Event, so nothing here is generic
// over an event type and nothing looks a message type up at runtime. The envelope carries what the
// library reads — event_id, occurred_at, aggregate_id — as typed fields
// (typed-fields-for-what-the-library-reads), and the variant carries the fact.
//
// # A handler is handed ONE event
//
// Not a slice (handlers-take-one-event-not-a-batch). A failing batch redelivers every message in it,
// including the ones that succeeded, and a push delivers exactly one message per request anyway — so
// batching was only ever available on the pull side, and it made the two drivers' contracts differ in
// the one place they must not.
//
// # The handler owns its transaction
//
// The library hands no *gorm.DB to a handler. Rule 4 of the handler contract
// (one-contract-for-both-handler-types) is that a handler claims event_id inside its OWN transaction,
// beside its write — claimed apart from the write, a crash between them either suppresses work that
// never committed or repeats work that did. This package ships Claim, and the handler builds the flow.
//
// Transport stays in pkgs/event_source — clients, topics, subscriptions, push and pull drivers. This
// package's inbound edge is IncomingMessage, the normalised form a driver produces.
package san_event
