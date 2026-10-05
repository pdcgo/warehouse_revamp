package main

import (
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"

	"github.com/urfave/cli/v3"
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
		Usage: "skip docker compose up — the database is already running",
	}
}

// composeUp starts the containers and WAITS until they report healthy.
//
// Without --wait the next step can reach Postgres before it accepts connections — the race the
// healthcheck in docker-compose.yaml exists to close. It is a no-op on containers already running.
func composeUp(ctx context.Context, root string, out io.Writer) error {
	err := runStep(ctx, out, root, "docker", "compose", "up", "-d", "--wait")
	if err != nil {
		return fmt.Errorf("docker compose up: %w — is Docker running? (--no-docker skips this step)", err)
	}

	return nil
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
