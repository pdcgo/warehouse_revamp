package product_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
)

// TeamCodes reads a team's code — the prefix every product code of that team is composed from
// (the-field-is-product-code-composed-on-write). The code is team_service's, and immutable after the team is created,
// so a code composed from it never goes stale. The composition root answers it through team_service; this service never
// reads team_service's table (HARD RULE 3).
//
// An unknown or deleted team answers "" and no error — the caller refuses on that.
type TeamCodes interface {
	TeamCode(ctx context.Context, teamID uint64) (string, error)
}

// productCodeSeparator joins the team's code to the team's own part: team ABC types SHOE-42, the product is ABC-SHOE-42.
const productCodeSeparator = "-"

var (
	errNoTeamCodeReader = errors.New("the team's code cannot be read — no product code is composed without it")
	errTeamHasNoCode    = errors.New("the team has no team code to compose a product code with")
	errBlankCodePart    = errors.New("the product code needs the team's own part — it is blank")
	// The line ProductDelete uses (a-used-product-is-archived-never-deleted): once the product has been in a stock movement,
	// an order line or a restock line a sticker can exist, and the code is fixed.
	errCodeFixedByHistory = errors.New("this product has a history — a stock movement, an order line or a restock line — so its code is fixed")
)

// composeProductCode is the ONE place a product code is built: `<team_code>-<the team's part>`. The part is trimmed of
// surrounding space — " SHOE-42" and "SHOE-42" are one code to a person reading a sticker.
func composeProductCode(teamCode, part string) string {
	return teamCode + productCodeSeparator + strings.TrimSpace(part)
}

// productCodeFor reads the scoped team's code and composes the stored product code from the team's part. Every error is
// already a Connect error: a blank part is the caller's (InvalidArgument), a team with no code is a state the caller
// cannot write through (FailedPrecondition), a missing reader is ours (Internal).
func (s *Service) productCodeFor(ctx context.Context, teamID uint64, part string) (string, error) {
	if strings.TrimSpace(part) == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errBlankCodePart)
	}

	if s.teams == nil {
		return "", connect.NewError(connect.CodeInternal, errNoTeamCodeReader)
	}

	teamCode, err := s.teams.TeamCode(ctx, teamID)
	if err != nil {
		return "", connect.NewError(connect.CodeInternal, fmt.Errorf("read team %d's code: %w", teamID, err))
	}

	if teamCode == "" {
		return "", connect.NewError(connect.CodeFailedPrecondition, errTeamHasNoCode)
	}

	return composeProductCode(teamCode, part), nil
}
