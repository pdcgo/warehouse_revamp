package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A team that has set a return warehouse is answered with it; one that has not is ABSENT — the absence is what
// root's Teams list marks (root-sees-which-teams-have-no-return-warehouse).
func TestTeamReturnConfigurationByIds_AbsentMeansNotSet(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setReturnWarehouse(t, svc, 2, 41)
	setReturnWarehouse(t, svc, 4, 58)

	res, err := svc.TeamReturnConfigurationByIds(context.Background(), connect.NewRequest(
		&sellingv1.TeamReturnConfigurationByIdsRequest{
			Filter: &sellingv1.TeamReturnConfigurationByIdsFilter{Ids: []uint64{2, 3, 4}},
		},
	))
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}

	items := res.Msg.GetItems()

	if _, ok := items[3]; ok {
		t.Fatalf("team 3 set nothing, but is answered: %+v", items[3])
	}

	for team, want := range map[uint64]uint64{2: 41, 4: 58} {
		list := items[team].GetItems()
		if len(list) != 1 {
			t.Fatalf("team %d: %d slices, want the one CONFIGURATION slice", team, len(list))
		}

		got := list[0].GetConfiguration().GetMapData()[team]
		if got.GetWarehouseId() != want {
			t.Fatalf("team %d: warehouse %d, want %d", team, got.GetWarehouseId(), want)
		}
	}
}
