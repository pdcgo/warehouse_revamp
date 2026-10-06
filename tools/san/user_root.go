package main

import (
	"context"
	"log"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// sanAgent is how a change made through this tool is recorded in the membership log (every-role-change-is-logged).
const sanAgent = "san"

// userRootCommand adds and removes a Root (root-can-be-several). This tool is the ONLY way to: no RPC gives or takes
// Root (root-is-granted-only-through-san).
func userRootCommand() *cli.Command {
	selectorFlags := func() []cli.Flag {
		return []cli.Flag{
			&cli.StringFlag{Name: "username", Usage: "the account's username"},
			&cli.StringFlag{Name: "email", Usage: "the account's email (matched case-insensitively)"},
			&cli.Uint64Flag{Name: "user-id", Usage: "the account's id — the unambiguous selector"},
		}
	}

	return &cli.Command{
		Name:  "root",
		Usage: "add or remove a Root",
		Description: "Root can do anything in every team, and is given and taken only here — never from the app.\n" +
			"Both commands lock the person's account as every membership change does, and write the team's\n" +
			"membership history with \"san\" as who did it.",
		Commands: []*cli.Command{
			{
				Name:      "add",
				Usage:     "make an account a Root",
				ArgsUsage: " ",
				Description: "Makes the account a Root of the root team. A System Administrator becomes Root (one role per\n" +
					"team). Already a Root changes nothing. A suspended or erased account is refused.",
				Flags:  selectorFlags(),
				Action: runUserRootAdd,
			},
			{
				Name:      "remove",
				Usage:     "take Root from an account",
				ArgsUsage: " ",
				Description: "Takes the account out of the root team. Refused for an account that is not a Root, and for\n" +
					"the LAST Root — the system is never left with nobody who can do anything. Add another first.",
				Flags:  selectorFlags(),
				Action: runUserRootRemove,
			},
		},
	}
}

func runUserRootAdd(ctx context.Context, cmd *cli.Command) error {
	selector, err := userSelectorFrom(cmd)
	if err != nil {
		return err
	}

	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		user, changed, err := san.GrantRoot(ctx, selector)
		if err != nil {
			return err
		}

		if !changed {
			log.Printf("%s (id=%d) is already a Root on %s — nothing changed", user.Username, user.ID, san.target)

			return nil
		}

		log.Printf("%s (id=%d) is now a Root on %s", user.Username, user.ID, san.target)

		return nil
	})
}

func runUserRootRemove(ctx context.Context, cmd *cli.Command) error {
	selector, err := userSelectorFrom(cmd)
	if err != nil {
		return err
	}

	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		user, err := san.RevokeRoot(ctx, selector)
		if err != nil {
			return err
		}

		log.Printf("%s (id=%d) is no longer a Root on %s", user.Username, user.ID, san.target)

		return nil
	})
}

// GrantRoot finds the account and hands it to user_service's own GrantRoot — the lock, the role and the log row live
// there, not in this tool.
func (s *San) GrantRoot(ctx context.Context, sel userSelector) (*user_service_models.User, bool, error) {
	user, err := s.findUser(ctx, sel)
	if err != nil {
		return nil, false, err
	}

	changed, err := s.users.GrantRoot(ctx, user.ID, sanAgent)
	if err != nil {
		return nil, false, err
	}

	return user, changed, nil
}

// RevokeRoot finds the account and hands it to user_service's own RevokeRoot.
func (s *San) RevokeRoot(ctx context.Context, sel userSelector) (*user_service_models.User, error) {
	user, err := s.findUser(ctx, sel)
	if err != nil {
		return nil, err
	}

	err = s.users.RevokeRoot(ctx, user.ID, sanAgent)
	if err != nil {
		return nil, err
	}

	return user, nil
}
