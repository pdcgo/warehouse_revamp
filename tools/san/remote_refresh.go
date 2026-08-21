package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/tools/san/remote"
)

// remoteRefreshTokenCommand moves the stored token's DEADLINE, without moving the token.
//
// It exists because of where this credential ends up. A token pasted into a terminal is cheap to
// replace; one pasted into a hosted connector's settings screen is not, and that is the one with a
// 30-day clock on it. Without this, the only cure for "it expired" would be a new value and a trip
// back to every client that holds it.
func remoteRefreshTokenCommand() *cli.Command {
	return &cli.Command{
		Name:      "refresh-token",
		Usage:     "extend the stored token's expiry — same token, later deadline",
		ArgsUsage: " ",
		Description: "Reads the workspace's token store, re-stamps the deadline, and writes it back.\n" +
			"THE TOKEN ITSELF DOES NOT CHANGE, so every client already holding it keeps working —\n" +
			"which is the whole point, because the token most likely to lapse is the one sitting in\n" +
			"a settings screen nobody wants to revisit.\n\n" +
			"An ALREADY-EXPIRED token is extended too. Lapsing is the ordinary reason to run this,\n" +
			"and refusing would leave rotation as the only cure for the case rotation is least\n" +
			"wanted.\n\n" +
			"--rotate is the other thing: a NEW value, for a token you believe has leaked. Every\n" +
			"client holding the old one must then be re-pasted.\n\n" +
			"⚠ A SERVER THAT IS ALREADY RUNNING DOES NOT SEE THIS. It read the store at startup and\n" +
			"holds that deadline in memory, so restart it for the new expiry to take effect.",
		Flags: []cli.Flag{
			&cli.BoolFlag{
				Name:  "rotate",
				Usage: "mint a NEW token instead of extending this one — the answer to a leak",
			},
		},
		Action: runRemoteRefreshToken,
	}
}

func runRemoteRefreshToken(_ context.Context, cmd *cli.Command) error {
	root, err := remoteRoot(cmd)
	if err != nil {
		return err
	}

	store := tokenStorePath(cmd, root)
	if store == "" {
		return fmt.Errorf("--no-persist-token: there is no stored token to refresh")
	}

	now := time.Now()

	// The same default a server start uses, so a refresh cannot quietly hand out a longer-lived
	// credential than the thing it is refreshing.
	ttl := tokenTTL(cmd, store)
	rotate := cmd.Bool("rotate")

	before, beforeErr := remote.LoadToken(store, now)

	token, outcome, err := remote.RefreshToken(store, ttl, now, rotate)
	if err != nil {
		return err
	}

	printRefreshResult(store, token, outcome, before, beforeErr)

	return nil
}

// printRefreshResult tells the operator the two things they came for: whether the token changed,
// and until when it is now good.
func printRefreshResult(
	store string,
	token *remote.Token,
	outcome remote.RefreshOutcome,
	before *remote.Token,
	beforeErr error,
) {
	fmt.Fprintf(os.Stderr, "\nsan remote refresh-token — %s\n", store)
	fmt.Fprintf(os.Stderr, "  token      %s\n", token.Value())
	fmt.Fprintf(os.Stderr, "  expires    %s\n", expiryText(token))

	switch outcome {
	case remote.RefreshExtended:
		was := "an expired deadline"

		switch {
		case beforeErr == nil:
			was = expiryText(before)
		case strings.Contains(beforeErr.Error(), "expired"):
			was = "EXPIRED — it has been brought back"
		}

		fmt.Fprintf(os.Stderr, "             ↳ was %s\n", was)
		fmt.Fprintf(os.Stderr, "  unchanged  every client holding this token keeps working\n")

	case remote.RefreshRotated:
		fmt.Fprintf(os.Stderr, "  ⚠ ROTATED — this is a NEW token. Re-paste it into every client that held the old\n")

	case remote.RefreshMinted:
		fmt.Fprintf(os.Stderr, "  ⚠ there was no stored token, so this one was minted\n")
	}

	fmt.Fprintf(os.Stderr,
		"\n  ⚠ A RUNNING SERVER DOES NOT PICK THIS UP. It read the store when it started and\n"+
			"    holds that deadline in memory — restart it.\n\n")
}

func expiryText(token *remote.Token) string {
	if token == nil || token.ExpiresAt().IsZero() {
		return "never (--token-ttl 0)"
	}

	return token.ExpiresAt().Local().Format(time.RFC3339)
}
