package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/urfave/cli/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// capitalImportBatch is how many account rows are read at a time — the import never holds them all.
const capitalImportBatch = 500

// expenseCommand is expense_service's operator actions: today, the one-time import of the account page's capital
// (prive-and-deposit-on-pengeluaran-are-the-accounts-capital; the-expense-types-prototype-is-accepted — *old rows: a
// selling team's old Setor / Tarik Modal are brought into Biaya once*).
func expenseCommand() *cli.Command {
	return &cli.Command{
		Name:  "expense",
		Usage: "expense_service operations",
		Commands: []*cli.Command{
			{
				Name:      "import-capital",
				Usage:     "bring a selling team's Setor / Tarik Modal made on the account page into Biaya, once",
				ArgsUsage: " ",
				Description: "One-shot, and safe to run again. Reads every by-hand capital row of financial_account_service\n" +
					"(a Setor / Tarik Modal made on the account page — never a row Biaya posted), builds the very\n" +
					"FinancialAccountCapitalRecorded the account page publishes since the second door, and records each\n" +
					"SELLING team's through expense_service's own listener code: Setoran modal (money in) or Prive (out),\n" +
					"origin account page, the row's amount, day, note, who and account, linked to the row. Nothing posts\n" +
					"to the account — the row is the act's own. A warehouse team's rows are left alone. A row already on\n" +
					"Biaya (the live door, or an earlier run) is counted, never written twice. --dry-run does it all in\n" +
					"one transaction and rolls it back.",
				Flags: []cli.Flag{
					&cli.BoolFlag{Name: "dry-run", Usage: "count what would be imported, write nothing"},
				},
				Action: runExpenseImportCapital,
			},
		},
	}
}

func runExpenseImportCapital(ctx context.Context, cmd *cli.Command) error {
	dryRun := cmd.Bool("dry-run")

	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		result, err := san.ImportCapital(ctx, dryRun)
		if err != nil {
			return err
		}

		verb := "imported"
		if dryRun {
			verb = "would import (dry run — nothing written)"
		}

		log.Printf("[%s] capital: %s %d, %d already on Biaya, %d left on the account page (not a selling team's)",
			san.target, verb, result.Imported, result.Already, result.NotSelling)

		return nil
	})
}

// importCapitalOn is the `dev setup` step — the same method the command runs, on setup's connection. A second run is the
// expected case there: every row is already on Biaya.
func importCapitalOn(ctx context.Context, db *sql.DB, target string) error {
	gdb, err := gorm.Open(postgres.New(postgres.Config{Conn: db}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	san := &San{db: gdb, teams: NewTeamCodes(gdb), target: target}

	result, err := san.ImportCapital(ctx, false)
	if err != nil {
		return err
	}

	fmt.Printf("  %d imported, %d already on Biaya, %d left on the account page\n",
		result.Imported, result.Already, result.NotSelling)

	return nil
}

// errCapitalDryRun rolls the dry run's transaction back.
var errCapitalDryRun = errors.New("dry run")

// ImportCapital brings every by-hand capital row into Biaya through expense_service's own code, oldest first, in batches
// — the account rows read by financial_account_service's own function (HandCapitalEvents), the side of each team asked of
// team_service's TeamByIds handler, never a table of either. One transaction: a dry run rolls it back.
func (s *San) ImportCapital(ctx context.Context, dryRun bool) (expense_v1.ImportResult, error) {
	total := expense_v1.ImportResult{}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		total = expense_v1.ImportResult{}

		// expense_service on this run's transaction — no broker (nothing here publishes), no account or shop to ask
		// (nothing here is typed by a person).
		expenses := expense_v1.NewService(tx, nil, nil, sanTeamSides{teams: s.teams}, nil)

		var after uint64

		for {
			events, err := financial_account_v1.HandCapitalEvents(tx, after, capitalImportBatch)
			if err != nil {
				return err
			}

			if len(events) == 0 {
				break
			}

			result, err := expenses.ImportCapital(ctx, events)
			if err != nil {
				return err
			}

			total.Imported += result.Imported
			total.Already += result.Already
			total.NotSelling += result.NotSelling

			after = events[len(events)-1].GetFinancialAccountCapitalRecorded().GetLogId()
		}

		if dryRun {
			return errCapitalDryRun
		}

		return nil
	})
	if errors.Is(err, errCapitalDryRun) {
		err = nil
	}

	return total, err
}

// sanTeamSides is expense_service's TeamSides for the tool: team_service's TeamByIds handler, one team at a time (the
// import asks each team once). A team TeamByIds omits — unknown or deleted — sits on neither side, so its rows stay put.
type sanTeamSides struct {
	teams *team_v1.Service
}

func (s sanTeamSides) SideOf(ctx context.Context, teamID uint64) (expense_v1.TeamSide, error) {
	req := &teamv1.TeamByIdsRequest{
		Filter:      &teamv1.TeamByIdsFilter{Ids: []uint64{teamID}},
		DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM},
	}

	// Called directly, so validated here, as the interceptor would on the server (HARD RULE 3b).
	err := protovalidate.Validate(req)
	if err != nil {
		return expense_v1.SideNeither, err
	}

	resp, err := s.teams.TeamByIds(ctx, connect.NewRequest(req))
	if err != nil {
		return expense_v1.SideNeither, err
	}

	for _, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			team := item.GetTeam().GetMapData()[teamID]
			if team == nil {
				continue
			}

			switch team.GetType() {
			case teamv1.TeamType_TEAM_TYPE_SELLING:
				return expense_v1.SideSeller, nil
			case teamv1.TeamType_TEAM_TYPE_WAREHOUSE:
				return expense_v1.SideWarehouse, nil
			}
		}
	}

	return expense_v1.SideNeither, nil
}
