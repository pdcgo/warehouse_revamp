package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// The local development stack.
//
// MACHINE commands, not data commands (docs/tools/san.md, "Two shapes"): they never ask which
// database. `dev run` touches none, and `dev setup` acts only on the local docker one.
//
//	go run ./tools/san dev setup   once, and again whenever migrations or seeds change
//	go run ./tools/san dev run     every day
func devCommand() *cli.Command {
	return &cli.Command{
		Name:  "dev",
		Usage: "set up and run the local development stack",
		Commands: []*cli.Command{
			devSetupCommand(),
			devRunCommand(),
		},
	}
}

// noDockerFlag is shared by both commands, so it reads the same in each.
//
// No backticks in Usage: urfave/cli reads a backticked word as the flag's value placeholder.
func noDockerFlag() cli.Flag {
	return &cli.BoolFlag{
		Name:  "no-docker",
		Usage: "skip docker compose up — the database and the Pub/Sub emulator are already running",
	}
}

// devPubsubProject is the project the dev server publishes to — it mirrors devProjectID in
// backend/cmd/app_development/event_sender.go. The emulator does not authenticate, so any stable id
// works, but it has to be the SAME id, or the topics are made where nothing publishes.
const devPubsubProject = "warehouse-dev"

// devDocker is the docker half of both dev commands: the containers, then the emulator's topics.
func devDocker(ctx context.Context, root string, out io.Writer, noDocker bool) error {
	if !noDocker {
		err := composeUp(ctx, root, out)
		if err != nil {
			return err
		}
	}

	return ensureDevEvents(ctx, out, !noDocker)
}

// composeUp starts the containers — Postgres, Redis AND the Pub/Sub emulator — and WAITS until they
// report healthy.
//
// Without --wait the next step can reach Postgres before it accepts connections — the race the
// healthcheck in docker-compose.yaml exists to close. It is a no-op on containers already running.
//
// The emulator is behind the compose `pubsub` profile, so a plain `up` leaves it out — and the dev
// server publishes to it (dev-runs-the-emulator). Without it, placing an order waits about 60 s for
// an answer that never comes, on a form with nothing wrong with it.
func composeUp(ctx context.Context, root string, out io.Writer) error {
	err := runStep(ctx, out, root, "docker", "compose", "--profile", "pubsub", "up", "-d", "--wait")
	if err != nil {
		return fmt.Errorf("docker compose up: %w — is Docker running? (--no-docker skips this step)", err)
	}

	return nil
}

// ensureDevEvents makes the emulator's topics and subscriptions — on EVERY start, not once.
//
// ⚠ The emulator keeps them IN MEMORY. A restarted container (Docker Desktop restarting is enough) has
// none, and a publish to a missing topic fails the same slow way as no emulator at all. Ensuring is
// idempotent and takes about a second.
//
// started says whether san brought the emulator up. If it did and the emulator does not answer, that
// is an error. Under --no-docker the person runs their own containers, and a missing emulator is a
// WARNING: every screen but placing an order works without it.
func ensureDevEvents(ctx context.Context, out io.Writer, started bool) error {
	host := event_source.EmulatorHost()

	if !emulatorAnswers(ctx, host) {
		if started {
			return fmt.Errorf("the Pub/Sub emulator is not answering on %s although docker started it — "+
				"see docker compose logs pubsub", host)
		}

		fmt.Fprintf(out, "⚠ the Pub/Sub emulator is not answering on %s — placing an order will hang for about a minute.\n"+
			"  start it: docker compose --profile pubsub up -d pubsub (the next dev run makes its topics)\n", host)

		return nil
	}

	fmt.Fprintf(out, "→ pubsub ensure --project %s --emulator\n", devPubsubProject)

	client, err := event_source.NewPubsubEmulator(ctx, devPubsubProject)
	if err != nil {
		return err
	}

	defer func() { _ = client.Close() }()

	err = ensureEvents(ctx, out, client, eventSetup{project: devPubsubProject})
	if err != nil {
		return fmt.Errorf("pubsub ensure: %w", err)
	}

	return nil
}

// emulatorAnswers asks the emulator's root, which answers 200 "Ok" once it is serving.
//
// Asked first because the Pub/Sub client never refuses: it connects lazily and retries, so ensuring
// against a missing emulator would wait instead of saying so.
func emulatorAnswers(ctx context.Context, host string) bool {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+host+"/", nil)
	if err != nil {
		return false
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}

	_ = res.Body.Close()

	return res.StatusCode == http.StatusOK
}

// runStep runs one command to completion in dir, its output passed straight through.
//
// Unlike a dev server it needs no process-tree handling: it shares san's console, so a Ctrl-C
// reaches it directly, and it ends on its own.
func runStep(ctx context.Context, out io.Writer, dir string, argv ...string) error {
	fmt.Fprintf(out, "→ %s\n", strings.Join(argv, " "))

	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Stdout = out
	cmd.Stderr = out

	return cmd.Run()
}
