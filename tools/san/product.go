package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/urfave/cli/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// NewTeamCodes is team_service, built for the one thing a san command asks of it: TeamByIds, the team codes a product
// code is composed from. Its user client is nil — TeamByIds never calls user_service, and no san command reaches a
// team_service path that does.
func NewTeamCodes(db *gorm.DB) *team_v1.Service {
	return team_v1.NewService(db, nil, nil)
}

// productCommand is product_service's operator actions: today, the one-shot recompose of the codes written before a code
// was composed on write (the-field-is-product-code-composed-on-write).
func productCommand() *cli.Command {
	return &cli.Command{
		Name:  "product",
		Usage: "product_service operations",
		Commands: []*cli.Command{
			{
				Name:      "recompose-codes",
				Usage:     "put each team's code in front of the product codes written before codes were composed, once",
				ArgsUsage: " ",
				Description: "One-shot, and safe to run again. Reads every product, asks team_service (TeamByIds) for each\n" +
					"owning team's team_code, and rewrites SHOE-42 as ABC-SHOE-42 — archived products too, since they keep\n" +
					"their code. A code that already begins with its team's code and a dash is left alone, so a second\n" +
					"run changes nothing. A product whose team has no code (unknown or deleted) is left as it was and\n" +
					"named, and so is one under a code its team HELD ONCE (a team code change recomposes its products\n" +
					"itself, so such a code is never a bare part). Refused — nothing written — if two products would end\n" +
					"up carrying one code.\n" +
					"Order, restock and transfer lines keep the code they were written under: they are snapshots.",
				Action: runProductRecompose,
			},
		},
	}
}

func runProductRecompose(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		report, err := san.RecomposeProductCodes(ctx)
		if err != nil {
			return err
		}

		log.Printf("[%s] product codes: %d recomposed, %d already composed", san.target,
			report.Recomposed, report.AlreadyComposed)

		if len(report.NoTeamCode) > 0 {
			log.Printf("[%s] product codes: %d left as they were — their team has no code: products %v", san.target,
				len(report.NoTeamCode), report.NoTeamCode)
		}

		if len(report.UnderFormerCode) > 0 {
			log.Printf("[%s] product codes: %d left as they were — under a code their team held once, not a bare part: products %v",
				san.target, len(report.UnderFormerCode), report.UnderFormerCode)
		}

		return nil
	})
}

// RecomposeProductCodes runs product_service's own recompose, the team codes read through team_service's TeamByIds
// handler — never its table — and each team's FORMER codes through team_service's own FormerCodesOf (backlog #149): a
// product still under a code its team held once is not a bare part, and is left alone rather than given a second prefix
// after a real team code change.
func (s *San) RecomposeProductCodes(ctx context.Context) (product_v1.RecomposeReport, error) {
	return product_v1.RecomposeProductCodes(ctx, s.db, s.teamCodes, s.formerCodes)
}

// formerCodes is the guard's read: each team's former codes, from team_service's own function over its own table.
func (s *San) formerCodes(ctx context.Context, teamIDs []uint64) (map[uint64][]string, error) {
	return team_v1.FormerCodesOf(ctx, s.db, teamIDs)
}

// teamCodes is the recompose's bulk team-code read: TeamByIds over every owning team, in pages of the most the filter
// takes (200). A team it omits — unknown or deleted — has no code; so has team 0, which is never asked. The handler is
// called directly, so the request is validated here, as the interceptor would on the server (HARD RULE 3b).
func (s *San) teamCodes(ctx context.Context, teamIDs []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}

	ids := make([]uint64, 0, len(teamIDs))
	for _, id := range teamIDs {
		if id > 0 {
			ids = append(ids, id)
		}
	}

	for start := 0; start < len(ids); start += teamByIdsPage {
		end := min(start+teamByIdsPage, len(ids))

		req := &teamv1.TeamByIdsRequest{
			Filter:      &teamv1.TeamByIdsFilter{Ids: ids[start:end]},
			DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM},
		}

		err := protovalidate.Validate(req)
		if err != nil {
			return nil, err
		}

		resp, err := s.teams.TeamByIds(ctx, connect.NewRequest(req))
		if err != nil {
			return nil, err
		}

		for id, list := range resp.Msg.GetItems() {
			for _, item := range list.GetItems() {
				if team := item.GetTeam().GetMapData()[id]; team != nil {
					out[id] = team.GetTeamCode()
				}
			}
		}
	}

	return out, nil
}

// teamByIdsPage is TeamByIdsFilter.ids' max_items.
const teamByIdsPage = 200

// recomposeCodesOn is `product recompose-codes` for `dev setup`, on the handle setup already holds — the SAME function
// the command runs, so setup cannot drift from it. Idempotent: on a database already recomposed it changes nothing.
func recomposeCodesOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	san := &San{db: gdb, teams: NewTeamCodes(gdb), target: target}

	report, err := san.RecomposeProductCodes(ctx)
	if err != nil {
		return err
	}

	fmt.Printf("  %d recomposed, %d already composed, %d left without a team code, %d left under a former team code\n",
		report.Recomposed, report.AlreadyComposed, len(report.NoTeamCode), len(report.UnderFormerCode))

	return nil
}
