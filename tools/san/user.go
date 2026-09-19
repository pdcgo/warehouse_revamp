package main

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func userCommand() *cli.Command {
	return &cli.Command{
		Name:  "user",
		Usage: "act on a user account",
		Commands: []*cli.Command{
			userResetPasswordCommand(),
		},
	}
}

// userSelector names ONE account.
//
// The CLI accepts a username or an email as well as an id because that is what an operator
// actually has: a support message says "Ani can't log in", never "user 47". Resolving it here —
// once, with a clear error when it is ambiguous — is what keeps every future `san user …` command
// from inventing its own lookup.
type userSelector struct {
	id       uint64
	username string
	email    string
}

func (u userSelector) String() string {
	switch {
	case u.id != 0:
		return "user id " + strconv.FormatUint(u.id, 10)

	case u.username != "":
		return "username " + u.username

	default:
		return "email " + u.email
	}
}

// newUserSelector enforces EXACTLY ONE identifier.
//
// Not "the first one set", which is how a script passing a stale --username alongside a correct
// --user-id silently resets the wrong account. Ambiguity here is refused, not resolved.
func newUserSelector(id uint64, username, email string) (userSelector, error) {
	username = strings.TrimSpace(username)
	email = strings.TrimSpace(email)

	given := 0

	if id != 0 {
		given++
	}

	if username != "" {
		given++
	}

	if email != "" {
		given++
	}

	if given == 0 {
		return userSelector{}, errors.New("name the account: --username, --email or --user-id")
	}

	if given > 1 {
		return userSelector{}, errors.New("give exactly ONE of --username, --email or --user-id")
	}

	return userSelector{id: id, username: username, email: email}, nil
}

func userSelectorFrom(cmd *cli.Command) (userSelector, error) {
	return newUserSelector(cmd.Uint64("user-id"), cmd.String("username"), cmd.String("email"))
}

// findUser resolves the selector to exactly one row.
//
// Email matches on LOWER(email): the column is stored normalised and its unique index is on
// LOWER(email), so a literal comparison would fail to find an account that plainly exists the
// moment an operator types it with a capital letter.
func (s *San) findUser(ctx context.Context, sel userSelector) (*user_service_models.User, error) {
	query := s.db.WithContext(ctx).Model(&user_service_models.User{})

	switch {
	case sel.id != 0:
		query = query.Where("id = ?", sel.id)

	case sel.username != "":
		query = query.Where("username = ?", sel.username)

	default:
		// Trimmed here as well as in newUserSelector: a selector is a plain struct, so the
		// normalisation has to live where the query is built, not only where the flags are read.
		query = query.Where("LOWER(email) = ?", strings.ToLower(strings.TrimSpace(sel.email)))
	}

	var users []user_service_models.User

	// Two, not one: the difference between "no match" and "several" is the difference between a
	// typo and a data problem, and an operator about to change a password should be told which.
	err := query.Order("id").Limit(2).Find(&users).Error
	if err != nil {
		return nil, err
	}

	if len(users) == 0 {
		return nil, errors.New("no user matches " + sel.String())
	}

	if len(users) > 1 {
		return nil, errors.New("more than one user matches " + sel.String() + " — select by --user-id")
	}

	return &users[0], nil
}
