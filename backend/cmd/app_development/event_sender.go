package main

import (
	"context"

	"cloud.google.com/go/pubsub/v2"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// devProjectID is what the emulator is addressed as. The emulator does not authenticate, so the id
// only has to be stable — every dev machine uses the same one so a topic created by the setup tool is
// the topic the server publishes to.
const devProjectID = "warehouse-dev"

// NewPubsubClient connects the dev server to the LOCAL EMULATOR (dev-runs-the-emulator).
//
//	docker compose --profile pubsub up -d
//
// ⚠ THIS REPLACES THE IN-PROCESS LOOPBACK, which is retired. The loopback marshalled an event and
// handed it straight to the consumer's push handler in the same goroutine — it exercised the contract
// and the handler, and nothing else: no retries, no redelivery, no dead-lettering, and synchronous
// where production is not. The emulator is the real client against a real broker, so what a developer
// sees in dev is what production does.
//
// What that costs, plainly: the emulator has to be RUNNING, and the topics and subscriptions have to
// EXIST. Neither is created here — provisioning is a developer's tool, not boot code
// (setup-functions-are-a-developer-tool), and a service does not verify its setup at startup
// (services-do-not-verify-setup-at-boot). With the emulator down, publishing fails and the producer
// logs it with the event_id and carries on — an order is never failed by its consumers.
//
// grpc.NewClient is lazy, so this returns successfully whether or not the emulator is up. That is
// deliberate: a developer working on a screen that publishes nothing should not need a broker.
//
// It takes no ctx because the ctx would only scope the CONSTRUCTION, and construction dials nothing —
// every publish carries its own. Threading a context through the injector to be ignored would suggest
// a cancellation this returns no way to honour.
func NewPubsubClient() (*pubsub.Client, error) {
	return event_source.NewPubsubEmulator(context.Background(), devProjectID)
}

// NewEventSender provides the EventSender the services publish through (#153).
//
// The client is handed in and never closed here. Stopping publishers and closing the client at
// shutdown are the SERVICE's (publisher-and-client-shutdown-is-the-services), which is why this
// provider returns no cleanup.
func NewEventSender(client *pubsub.Client) event_source.EventSender {
	return event_source.NewPubsubEventSender(client)
}
