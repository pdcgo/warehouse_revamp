package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A team that has set nothing gets an ABSENT configuration and no error — "not set" is the state the
// settings screen asks to fix, and the create check will refuse, so it must be answerable.
func TestTeamReturnConfigurationDetail_NotSetIsAbsent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	res, err := svc.TeamReturnConfigurationDetail(context.Background(), connect.NewRequest(
		&sellingv1.TeamReturnConfigurationDetailRequest{TeamId: 2},
	))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if res.Msg.Configuration != nil {
		t.Fatalf("configuration = %+v, want absent", res.Msg.GetConfiguration())
	}
}

// Each team reads its own row — team 3's warehouse never answers for team 2.
func TestTeamReturnConfigurationDetail_ReadsOnlyItsTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	setReturnWarehouse(t, svc, 3, 77)

	res, err := svc.TeamReturnConfigurationDetail(ctx, connect.NewRequest(
		&sellingv1.TeamReturnConfigurationDetailRequest{TeamId: 2},
	))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if res.Msg.Configuration != nil {
		t.Fatalf("team 2 read %+v — another team's row", res.Msg.GetConfiguration())
	}

	setReturnWarehouse(t, svc, 2, 41)

	res, err = svc.TeamReturnConfigurationDetail(ctx, connect.NewRequest(
		&sellingv1.TeamReturnConfigurationDetailRequest{TeamId: 2},
	))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	got := res.Msg.GetConfiguration()
	if got.GetTeamId() != 2 || got.GetWarehouseId() != 41 {
		t.Fatalf("configuration = %+v, want team 2 → warehouse 41", got)
	}

	if got.GetUpdatedAtUnix() == 0 {
		t.Errorf("updated_at_unix = 0, want the time it was set")
	}
}

func setReturnWarehouse(
	t *testing.T,
	svc *selling_v1.Service,
	teamID, warehouseID uint64,
) *sellingv1.TeamReturnConfiguration {
	t.Helper()

	res, err := svc.TeamReturnConfigurationSet(context.Background(), connect.NewRequest(
		&sellingv1.TeamReturnConfigurationSetRequest{TeamId: teamID, WarehouseId: warehouseID},
	))
	if err != nil {
		t.Fatalf("set team %d → warehouse %d: %v", teamID, warehouseID, err)
	}

	return res.Msg.GetConfiguration()
}
