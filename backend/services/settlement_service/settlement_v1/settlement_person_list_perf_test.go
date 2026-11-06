//go:build perfaudit

// Performance audit for SettlementPersonList (the audit-rpc-performance skill).
//
//	go test -tags perfaudit -run TestPerf_SettlementPersonList -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// Two teams of 200 people × 250 days — 100 000 person-day rows, half another team's, and the 400 person state rows the
// fold keeps beside them: the picker's first page (200), for a team and for the root team, which reads both.
func TestPerf_SettlementPersonList(t *testing.T) {
	base := san_testdb.DB(t)

	san_perf.SeedRows(t, base, userDayRows(team))
	san_perf.SeedRows(t, base, userDayRows(team+1))

	// The state rows as the fold leaves them: each scope's newest close and its last day.
	err := base.Exec(`
INSERT INTO user_settlement_reports (user_id, team_id, close_balance, last_day, last_updated)
SELECT DISTINCT ON (user_id, team_id) user_id, team_id, close_balance, day, NOW()
FROM user_settlement_daily_reports
ORDER BY user_id, team_id, day DESC`).Error
	if err != nil {
		t.Fatalf("seed the person state: %v", err)
	}

	err = base.Exec(`ANALYZE user_settlement_reports`).Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	db, probe := san_perf.Wrap(base)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)
	ctx := context.Background()

	for _, c := range []struct {
		name   string
		teamID uint64
	}{{"SettlementPersonList team", team}, {"SettlementPersonList root", san_auth.RootTeamID}} {
		name, teamID := c.name, c.teamID

		measureRPC(t, probe, name, func() error {
			res, err := svc.SettlementPersonList(ctx, connect.NewRequest(&settlementv1.SettlementPersonListRequest{
				TeamId: teamID,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 200},
			}))
			if err == nil && len(res.Msg.GetIds()) != 200 {
				t.Fatalf("%s: %d ids, want 200", name, len(res.Msg.GetIds()))
			}

			return err
		})

		explain(t, base, probe)
	}
}
