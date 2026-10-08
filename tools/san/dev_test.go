package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"cloud.google.com/go/pubsub/v2/apiv1/pubsubpb"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// A port nothing listens on, so "the emulator is down" needs no docker to arrange.
const deadEmulator = "127.0.0.1:1"

// Started by san, an emulator that does not answer is broken — the dev server would hang on every
// order, so the stack must not come up as if it were fine.
func TestEnsureDevEventsRefusesAnEmulatorItStarted(t *testing.T) {
	t.Setenv("PUBSUB_EMULATOR_HOST", deadEmulator)

	var out bytes.Buffer

	err := ensureDevEvents(context.Background(), &out, true)
	if err == nil {
		t.Fatalf("want an error, got none; output:\n%s", out.String())
	}

	if !strings.Contains(err.Error(), deadEmulator) {
		t.Errorf("the error should name the host it asked, got: %v", err)
	}
}

// Under --no-docker the person runs their own containers. A missing emulator only breaks placing an
// order, so it is a warning that names the fix — and every other screen still gets its servers.
func TestEnsureDevEventsWarnsUnderNoDocker(t *testing.T) {
	t.Setenv("PUBSUB_EMULATOR_HOST", deadEmulator)

	var out bytes.Buffer

	err := ensureDevEvents(context.Background(), &out, false)
	if err != nil {
		t.Fatalf("want a warning, got an error: %v", err)
	}

	for _, want := range []string{"⚠", deadEmulator, "docker compose --profile pubsub up -d pubsub"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("the warning should contain %q, got:\n%s", want, out.String())
		}
	}
}

// Against a live emulator it makes every declared topic — the same set `pubsub ensure` makes.
func TestEnsureDevEventsMakesTheTopics(t *testing.T) {
	ctx := context.Background()

	if !emulatorAnswers(ctx, event_source.EmulatorHost()) {
		t.Skipf("no Pub/Sub emulator on %s (docker compose --profile pubsub up -d)", event_source.EmulatorHost())
	}

	var out bytes.Buffer

	err := ensureDevEvents(ctx, &out, true)
	if err != nil {
		t.Fatalf("ensure: %v\n%s", err, out.String())
	}

	topics, err := event_source.DeclaredTopics()
	if err != nil {
		t.Fatal(err)
	}

	client, err := event_source.NewPubsubEmulator(ctx, devPubsubProject)
	if err != nil {
		t.Fatal(err)
	}

	defer func() { _ = client.Close() }()

	for _, topic := range topics {
		_, err = client.TopicAdminClient.GetTopic(ctx, &pubsubpb.GetTopicRequest{
			Topic: "projects/" + devPubsubProject + "/topics/" + topic,
		})
		if err != nil {
			t.Errorf("topic %s: %v", topic, err)
		}
	}
}
