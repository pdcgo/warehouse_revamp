package main

import (
	"context"
	"errors"
	"log"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/manifoldco/promptui"
	"github.com/urfave/cli/v3"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func userResetPasswordCommand() *cli.Command {
	return &cli.Command{
		Name:      "reset-password",
		Usage:     "set a user's password",
		ArgsUsage: " ",
		Description: "Sets a user's password without knowing the old one — the operator's version of\n" +
			"the reset, the same operation an admin performs in the UI.\n\n" +
			"It runs user_service's AdminResetPassword rather than an UPDATE, so it also does the\n" +
			"two things that are easy to forget: it stamps last_password_reset, which KILLS EVERY\n" +
			"TOKEN the account already holds, and it drops the user's cached roles.\n\n" +
			"Name the account with exactly one of --username, --email or --user-id. Omit\n" +
			"--password and it is prompted for, hidden and twice — a password given as an\n" +
			"argument is left behind in shell history and visible in the process list.",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "username",
				Usage: "the account's username",
			},
			&cli.StringFlag{
				Name:  "email",
				Usage: "the account's email (matched case-insensitively)",
			},
			&cli.Uint64Flag{
				Name:  "user-id",
				Usage: "the account's id — the unambiguous selector",
			},
			&cli.StringFlag{
				Name:    "password",
				Sources: cli.EnvVars("SAN_PASSWORD"),
				Usage:   "the new password; PROMPTED (hidden) when omitted",
			},
		},
		Action: runUserResetPassword,
	}
}

func runUserResetPassword(ctx context.Context, cmd *cli.Command) error {
	// Both of these are settled BEFORE a database is chosen: a mistyped flag should fail
	// immediately, not after an operator has confirmed a production connection.
	selector, err := userSelectorFrom(cmd)
	if err != nil {
		return err
	}

	password, err := resolvePassword(cmd.String("password"))
	if err != nil {
		return err
	}

	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		user, err := san.ResetUserPassword(ctx, selector, password)
		if err != nil {
			return err
		}

		log.Printf(
			"password reset: %s (id=%d) on %s — every existing session for this account is now dead",
			user.Username, user.ID, san.target,
		)

		return nil
	})
}

// ResetUserPassword finds the account and hands it to user_service's own handler.
//
// The handler, not a copy of it: a password reset is a hash, a last_password_reset stamp and a
// cache eviction, and the day that sequence grows a fourth step this tool gets it for free.
func (s *San) ResetUserPassword(
	ctx context.Context,
	sel userSelector,
	password string,
) (*user_service_models.User, error) {
	user, err := s.findUser(ctx, sel)
	if err != nil {
		return nil, err
	}

	req := &userv1.AdminResetPasswordRequest{
		UserId:      user.ID,
		NewPassword: password,
	}

	// In the server the validation interceptor runs this; called directly, nothing does. So the
	// CONTRACT's own rules are applied here rather than re-typed as an `if len(password) < 8` —
	// a second copy of the minimum would be free to drift from the proto.
	err = protovalidate.Validate(req)
	if err != nil {
		return nil, err
	}

	_, err = s.users.AdminResetPassword(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return user, nil
}

// resolvePassword prompts when --password was not given: hidden, and typed twice.
//
// The flag exists for scripts and CI, but it is deliberately not the comfortable path — a
// password passed as an argument is recorded in shell history and readable from the process list
// by anyone on the box.
func resolvePassword(flag string) (string, error) {
	if flag != "" {
		return flag, nil
	}

	prompt := promptui.Prompt{Label: "New password", Mask: '*'}

	first, err := prompt.Run()
	if err != nil {
		return "", errors.New("aborted")
	}

	repeat := promptui.Prompt{Label: "Repeat password", Mask: '*'}

	second, err := repeat.Run()
	if err != nil {
		return "", errors.New("aborted")
	}

	// Typed blind and typed once is how an operator locks somebody out of an account they were
	// trying to restore.
	if first != second {
		return "", errors.New("passwords did not match")
	}

	return first, nil
}
