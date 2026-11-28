package team_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// leftAloneShown is how many left-alone product codes the answer names; the count is always complete.
const leftAloneShown = 20

var (
	errBlankTeamCode    = errors.New("the team code is blank")
	errNotSellingTeam   = errors.New("only a selling team's code can be changed — no product is composed from any other team's code")
	errNoCodeRecomposer = errors.New("the team's products cannot be recomposed — the team code is left as it is")
)

// TeamCodeUpdate implements [teamv1connect.TeamServiceHandler] — the team code edit (backlog #149,
// a-team-code-change-recomposes-its-product-codes; the screens' the-team-code-and-product-tags-prototype-is-accepted).
//
// ONE transaction, across the seam: the team row is locked (two edits of one team queue, the second reading the first's
// code), the new code is refused when another team holds it or held it once (naming that team), the old code joins the
// team's former codes (and an own former code taken back leaves them), the team takes the new code, and the
// ProductCodeRecomposer — product_service, in this same tx — recomposes every product of the team, archived too, writes
// each one's history line and tags `need_reprint_code` on those some warehouse holds stock of, with that warehouse's reprint
// wait. A recompose it refuses (two products would carry one code) rolls everything back.
//
// Only a SELLING team's code: no product is composed from a warehouse's or an admin team's (FailedPrecondition). The code
// it has already is no change — nothing written, nothing recomposed.
func (s *Service) TeamCodeUpdate(
	ctx context.Context,
	req *connect.Request[teamv1.TeamCodeUpdateRequest],
) (*connect.Response[teamv1.TeamCodeUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()

	code := strings.TrimSpace(req.Msg.GetTeamCode())
	if code == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errBlankTeamCode)
	}

	if s.recomposer == nil {
		return nil, connect.NewError(connect.CodeInternal, errNoCodeRecomposer)
	}

	change := TeamCodeChange{TeamID: teamID, NewCode: code, IsOverride: san_auth.IsOverride(ctx)}

	identity, identityErr := san_auth.GetIdentity(ctx)
	if identityErr == nil {
		change.ActorID = identity.GetIdentityId()
	}

	var (
		team     team_service_models.Team
		changed  bool
		products RecomposedProducts
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// FOR UPDATE: a second edit of this team waits here and then reads the code the first one committed — never the
		// code both started from, which would recompose nothing and leave the products under the first edit's code.
		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND deleted = ?", teamID, false).
			Take(&team).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errTeamMissing
		}

		if err != nil {
			return err
		}

		if team.Type != typeSelling {
			return errNotSellingTeam
		}

		if team.TeamCode == code {
			return nil
		}

		err = refuseTakenCode(tx, code, teamID)
		if err != nil {
			return err
		}

		change.OldCode = team.TeamCode
		changed = true

		err = s.retireCode(tx, team.ID, team.TeamCode, code)
		if err != nil {
			return err
		}

		err = tx.
			Model(&team_service_models.Team{}).
			Where("id = ?", teamID).
			Updates(withUpdatedAt(map[string]any{"team_code": code})).
			Error
		if err != nil {
			return err
		}

		products, err = s.recomposer.RecomposeTeamCodes(ctx, tx, change)
		if err != nil {
			return err
		}

		return tx.
			Where("id = ?", teamID).
			Take(&team).
			Error
	})
	if err != nil {
		return nil, s.teamCodeErr(ctx, err, code, teamID)
	}

	resp := &teamv1.TeamCodeUpdateResponse{
		Team:               teamToProto(&team),
		Changed:            changed,
		ProductsRecomposed: uint32(products.Recomposed),
		ProductsTagged:     uint32(products.Tagged),
		ProductsLeftAlone:  uint32(products.LeftAlone),
	}

	resp.LeftAloneCodes = products.LeftAloneCodes
	if len(resp.LeftAloneCodes) > leftAloneShown {
		resp.LeftAloneCodes = resp.LeftAloneCodes[:leftAloneShown]
	}

	return connect.NewResponse(resp), nil
}

// retireCode keeps the team's old code among its former codes — taken for good — and, when the new code is one of its OWN
// former codes, takes it back out of them (it is current again).
func (s *Service) retireCode(tx *gorm.DB, teamID uint64, oldCode, newCode string) error {
	err := tx.
		Where("team_code = ? AND team_id = ?", newCode, teamID).
		Delete(&team_service_models.TeamFormerCode{}).
		Error
	if err != nil {
		return err
	}

	return tx.
		Create(&team_service_models.TeamFormerCode{TeamCode: oldCode, TeamID: teamID, RetiredAt: time.Now()}).
		Error
}

// teamCodeErr maps TeamCodeUpdate's refusals.
func (s *Service) teamCodeErr(ctx context.Context, err error, code string, teamID uint64) error {
	var taken *errCodeTaken

	switch {
	case errors.As(err, &taken):
		return codeTakenAnswer(taken)
	case errors.Is(err, errTeamMissing):
		return notFound()
	case errors.Is(err, errNotSellingTeam):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrProductCodeClash):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case isUniqueViolation(err):
		return s.codeRaceAnswer(ctx, code, teamID)
	}

	return connect.NewError(connect.CodeInternal, err)
}
