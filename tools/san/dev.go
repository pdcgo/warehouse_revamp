package main

import (
	"github.com/urfave/cli/v3"
)

// The local development stack.
//
// A MACHINE command, not a data command (docs/tools/san.md, "Two shapes"): it picks no database and
// builds no Wire graph. What it acts on is this checkout and the processes it starts.
//
//	go run ./tools/san dev run
func devCommand() *cli.Command {
	return &cli.Command{
		Name:  "dev",
		Usage: "run the local development stack",
		Commands: []*cli.Command{
			devRunCommand(),
		},
	}
}
