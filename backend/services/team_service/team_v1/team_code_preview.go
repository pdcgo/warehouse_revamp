package team_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// TeamCodePreview implements [teamv1connect.TeamServiceHandler] — what a TeamCodeUpdate to the code WOULD do, read when
// the confirm opens (backlog #150; the-team-code-and-product-tags-prototype-is-accepted, *the confirm* and *refused*).
//
// The write's own checks, in its order, on the caller's db with no transaction and no lock — it writes nothing:
//
//  1. a team that is not there is NotFound, one that is not SELLING FailedPrecondition (TeamCodeUpdate's answers);
//  2. the team's own code is SAME — the write would change nothing;
//  3. a code another team holds now is TAKEN, one another team held once FORMER — named, as the write's TeamCodeTaken
//     detail names it (holderOf, the one statement TeamCreate and TeamCodeUpdate refuse by);
//  4. otherwise CHANGES, with what product_service says the recompose would do (ProductCodeRecomposer.PreviewTeamCodes —
//     the #149 seam): how many products, one example, the warehouses holding them — named here, from this service's
//     own teams.
//
// A preview is a snapshot: another team may take the code before Save, and the write's refusal still says so.
func (s *Service) TeamCodePreview(
	ctx context.Context,
	req *connect.Request[teamv1.TeamCodePreviewRequest],
) (*connect.Response[teamv1.TeamCodePreviewResponse], error) {
	teamID := req.Msg.GetTeamId()

	code := strings.TrimSpace(req.Msg.GetTeamCode())
	if code == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errBlankTeamCode)
	}

	if s.recomposer == nil {
		return nil, connect.NewError(connect.CodeInternal, errNoCodeRecomposer)
	}

	db := s.db.WithContext(ctx)

	var team team_service_models.Team

	err := db.
		Where("id = ? AND deleted = ?", teamID, false).
		Take(&team).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, notFound()
	}

	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if team.Type != typeSelling {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errNotSellingTeam)
	}

	resp := &teamv1.TeamCodePreviewResponse{}

	if team.TeamCode == code {
		resp.Verdict = teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_SAME

		return connect.NewResponse(resp), nil
	}

	holder, err := holderOf(db, code, teamID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if holder != nil {
		resp.Verdict = teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_TAKEN
		if holder.Former {
			resp.Verdict = teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_FORMER
		}

		resp.HolderTeamName = holder.Name

		return connect.NewResponse(resp), nil
	}

	products, err := s.recomposer.PreviewTeamCodes(ctx, db, TeamCodeChange{TeamID: teamID, OldCode: team.TeamCode, NewCode: code})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp.Verdict = teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_CHANGES
	resp.Products = uint32(products.Products)
	resp.ExampleOldCode = products.ExampleOld
	resp.ExampleNewCode = products.ExampleNew

	resp.WarehouseNames, err = teamNames(db, products.WarehouseIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(resp), nil
}

// teamNames is the teams' names, sorted — ONE statement. A team deleted since it shelved the stock is still named: its
// shelves are what the write would wait on.
func teamNames(db *gorm.DB, ids []uint64) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	var names []string

	err := db.
		Model(&team_service_models.Team{}).
		Where("id IN ?", ids).
		Order("name, id").
		Pluck("name", &names).
		Error
	if err != nil {
		return nil, err
	}

	return names, nil
}
