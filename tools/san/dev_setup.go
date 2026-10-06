package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/urfave/cli/v3"
)

// devSetupCommand makes a checkout runnable: everything `dev run` assumes is already there.
//
// Every step is idempotent, so it is also the command to re-run after a pull brings new migrations
// or a changed seed — there is no separate "update", and nothing to remember about which step is
// safe to repeat.
func devSetupCommand() *cli.Command {
	return &cli.Command{
		Name: "setup",
		Usage: "make this checkout runnable: submodules, docker, every migration, the dev logins, " +
			"categories, regions, npm install — safe to re-run",
		Flags: []cli.Flag{
			noDockerFlag(),
			&cli.StringFlag{
				Name:    "password",
				Usage:   "password for every seeded dev account",
				Sources: cli.EnvVars("DEV_PASSWORD"),
				Value:   "devpassword123",
			},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			// LOCAL ONLY, by construction rather than by prompt. The root --dsn reads DATABASE_URL,
			// and a leftover export pointing anywhere else would otherwise be handed known-credential
			// superusers by a command whose name says "dev".
			if cmd.String("dsn") != "" {
				return errors.New("dev setup acts only on the local docker database — unset DATABASE_URL " +
					"and drop --dsn, or run `migrate up-all` and `seed dev` against that database yourself")
			}

			password := cmd.String("password")

			err := checkDevPassword(password)
			if err != nil {
				return err
			}

			root, err := repoRootOnce()
			if err != nil {
				return err
			}

			// Read before anything changes, so a broken checkout fails with nothing half-done.
			seeds, err := readDevSeeds()
			if err != nil {
				return err
			}

			err = initSubmodules(ctx, root, os.Stdout)
			if err != nil {
				return err
			}

			err = devDocker(ctx, root, os.Stdout, cmd.Bool("no-docker"))
			if err != nil {
				return err
			}

			db, err := openDatabase(ctx, localDSN(), targetLocal)
			if err != nil {
				return err
			}
			defer db.Close()

			err = setupDatabase(ctx, db, targetLocal, password, seeds)
			if err != nil {
				return err
			}

			err = runStep(ctx, os.Stdout, filepath.Join(root, "frontend"), "npm", "install")
			if err != nil {
				return fmt.Errorf("npm install: %w — is Node installed?", err)
			}

			fmt.Printf("\n✓ setup complete (%s)\n", targetLocal)
			fmt.Println("  start it:  go run ./tools/san dev run")
			fmt.Printf("  log in:    dev / %s  at http://localhost:5174\n", password)

			return nil
		},
	}
}

// initSubmodules checks out a submodule that a plain `git clone` left EMPTY — and only that.
//
// `git submodule update --init` on its own would also move an initialised submodule back to the
// commit this repo records, under somebody who is working in it. A fresh clone is the case setup is
// for; a submodule somebody has moved is theirs.
//
// Neither san nor the dev servers import a submodule, so this is not for `dev run`: it is for
// `go build ./...` and `go test ./...`, which do.
func initSubmodules(ctx context.Context, root string, out io.Writer) error {
	status := exec.CommandContext(ctx, "git", "submodule", "status")
	status.Dir = root

	listing, err := status.Output()
	if err != nil {
		return fmt.Errorf("git submodule status: %w", err)
	}

	missing := uninitialisedSubmodules(string(listing))
	if len(missing) == 0 {
		return nil
	}

	return runStep(ctx, out, root, append([]string{"git", "submodule", "update", "--init", "--"}, missing...)...)
}

// uninitialisedSubmodules reads `git submodule status`, where a leading "-" marks a submodule that
// was never checked out ("+" is one at another commit, which is left alone).
func uninitialisedSubmodules(listing string) []string {
	var missing []string

	for _, line := range strings.Split(listing, "\n") {
		if !strings.HasPrefix(line, "-") {
			continue
		}

		fields := strings.Fields(line[1:])
		if len(fields) >= 2 {
			missing = append(missing, fields[1])
		}
	}

	return missing
}

// devSeeds is the reference data `dev setup` loads.
type devSeeds struct {
	categories []categorySeed
	regions    []region
}

// readDevSeeds reads the checked-in seed files — the same defaults `seed categories` and
// `region load-seed` use.
func readDevSeeds() (devSeeds, error) {
	categories, err := readCategorySeed(defaultCategorySeedPath())
	if err != nil {
		return devSeeds{}, err
	}

	regions, err := readRegionSeed(defaultRegionSeedPath())
	if err != nil {
		return devSeeds{}, err
	}

	return devSeeds{categories: categories, regions: regions}, nil
}

// setupDatabase is every data step of `dev setup`: the schema first, then the rows that need it.
//
// Each step is the SAME function its own command runs — `migrate up-all`, `seed dev`,
// `seed categories`, `region load-seed` — so setup cannot drift from doing them one at a time.
func setupDatabase(ctx context.Context, db *sql.DB, target, password string, seeds devSeeds) error {
	fmt.Println("→ migrate up-all")

	err := migrateUpAll(ctx, db, target)
	if err != nil {
		return err
	}

	fmt.Println("→ seed dev")

	err = seedDev(ctx, db, target, password)
	if err != nil {
		return err
	}

	fmt.Println("→ seed categories")

	err = seedCategories(ctx, db, target, seeds.categories)
	if err != nil {
		return err
	}

	fmt.Println("→ region load-seed")

	return loadRegions(ctx, db, target, seeds.regions)
}
