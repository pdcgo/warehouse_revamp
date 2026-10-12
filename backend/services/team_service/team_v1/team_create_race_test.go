//go:build raceaudit

package team_v1

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// The concurrency audit of TeamCreate (audit-sql). It takes no row lock: the team commits BEFORE the grant
// call to user_service (no lock is held across the network), and two creates with one code are settled
// by the UNIQUE index on team_code — pattern 3, an existence check the database makes, not the handler.

// answerGrants is user_service answering every grant with err. Safe to share between goroutines.
type answerGrants struct {
	userv1connect.UserServiceClient

	err error
}

func (a answerGrants) TeamUserUpdate(
	context.Context,
	*connect.Request[userv1.TeamUserUpdateRequest],
) (*connect.Response[userv1.TeamUserUpdateResponse], error) {
	if a.err != nil {
		return nil, a.err
	}

	return connect.NewResponse(&userv1.TeamUserUpdateResponse{}), nil
}

// raceCodes hands out a code per round, removed afterwards. Not san_race's table DELETE: `teams` holds the root
// team every other test package relies on.
func raceCodes(t *testing.T, s *Service) func(round int) string {
	t.Helper()

	prefix := fmt.Sprintf("R%d", time.Now().UnixNano()%1_000_000)

	t.Cleanup(func() {
		s.db.Where("team_code LIKE ?", prefix+"-%").Delete(&team_service_models.Team{})
	})

	return func(round int) string { return fmt.Sprintf("%s-%d", prefix, round) }
}

func rowsWithCode(s *Service, code string) int64 {
	var n int64

	s.db.Model(&team_service_models.Team{}).Where("team_code = ?", code).Count(&n)

	return n
}

// Two people create one code at the same second: exactly one team, the other told AlreadyExists.
func TestRace_TeamCreate_OneCodeTwice(t *testing.T) {
	h := san_race.New(t)
	s := NewService(h.DB(), answerGrants{})
	code := raceCodes(t, s)

	for round := 0; round < 40; round++ {
		res := h.Race(t, 2, func(i int) error {
			_, err := s.TeamCreate(context.Background(), createRequest(code(round), 57))
			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if n := rowsWithCode(s, code(round)); n != 1 {
			t.Fatalf("round %d: %d teams hold one code", round, n)
		}

		if res.Failed() != 1 || countCode(res, connect.CodeAlreadyExists) != 1 {
			res.Report(t)
			t.Fatalf("round %d: want one success and one AlreadyExists", round)
		}
	}
}

// Two people create one code and both Owners are refused: whatever the interleaving, NO team is left —
// a refused create must never keep the code, and one caller's hard delete must not leave the other's row.
func TestRace_TeamCreate_BothOwnersRefused(t *testing.T) {
	h := san_race.New(t)
	s := NewService(h.DB(), answerGrants{err: connect.NewError(connect.CodeNotFound, errors.New("user not found"))})
	code := raceCodes(t, s)

	for round := 0; round < 40; round++ {
		res := h.Race(t, 2, func(i int) error {
			_, err := s.TeamCreate(context.Background(), createRequest(code(round), 57))
			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if n := rowsWithCode(s, code(round)); n != 0 {
			t.Fatalf("round %d: %d teams left holding a code whose every create was refused", round, n)
		}
	}
}

func countCode(res san_race.Results, code connect.Code) int {
	n := 0

	for _, r := range res.Outcomes {
		if r.Err != nil && connect.CodeOf(r.Err) == code {
			n++
		}
	}

	return n
}
