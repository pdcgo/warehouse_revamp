package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// THE fix, pinned: a partial TeamInfoUpdate must not blank the fields it did not send.
//
// The source assigned all six fields unconditionally, so a contact-number-only update wiped the
// bank details. With proto3 `optional` (presence), an absent field is left alone. This test goes
// red the moment that regresses.
func TestTeamInfoUpdate_PartialDoesNotBlank(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH-INFO")
	ctx := context.Background()

	// Set the bank details in full.
	_, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
		TeamId:            teamID,
		BankOwnerName:     proto.String("Budi"),
		BankAccountNumber: proto.String("12345"),
		ContactNumber:     proto.String("0811"),
	}))
	if err != nil {
		t.Fatalf("first update: %v", err)
	}

	// Now change ONLY the contact number.
	res, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
		TeamId:        teamID,
		ContactNumber: proto.String("0822"),
	}))
	if err != nil {
		t.Fatalf("partial update: %v", err)
	}

	info := res.Msg.GetInfo()

	if info.GetContactNumber() != "0822" {
		t.Errorf("contact = %q, want 0822", info.GetContactNumber())
	}

	if info.GetBankOwnerName() != "Budi" {
		t.Errorf("bank owner = %q, want Budi — a contact-only update BLANKED the bank details", info.GetBankOwnerName())
	}

	if info.GetBankAccountNumber() != "12345" {
		t.Errorf("bank account = %q, want 12345 — blanked by a partial update", info.GetBankAccountNumber())
	}
}

// The upsert is idempotent and single-row: repeated updates never produce a second info row for
// one team (the UNIQUE index + ON CONFLICT is what closes the source's duplicate-row race).
func TestTeamInfoUpdate_UpsertIsSingleRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH-UPSERT")
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		_, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
			TeamId:        teamID,
			ContactNumber: proto.String("x"),
		}))
		if err != nil {
			t.Fatalf("update %d: %v", i, err)
		}
	}

	var rows int64
	db.Model(&team_service_models.TeamInfo{}).Where("team_id = ?", teamID).Count(&rows)

	if rows != 1 {
		t.Errorf("team_infos rows for one team = %d, want exactly 1", rows)
	}
}

// present-and-zero clears to NULL; absent leaves alone. This is the distinction the source could
// not express (it overloaded 0 to mean "clear", so there was no way to say "leave it").
func TestTeamInfoUpdate_PresentZeroClears(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH-CLEAR")
	ctx := context.Background()

	_, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
		TeamId:            teamID,
		ReturnWarehouseId: proto.Uint64(99),
	}))
	if err != nil {
		t.Fatalf("set: %v", err)
	}

	// present-and-zero => clear
	res, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
		TeamId:            teamID,
		ReturnWarehouseId: proto.Uint64(0),
	}))
	if err != nil {
		t.Fatalf("clear: %v", err)
	}

	if res.Msg.GetInfo().GetReturnWarehouseId() != 0 {
		t.Errorf("return_warehouse_id = %d, want 0 (cleared)", res.Msg.GetInfo().GetReturnWarehouseId())
	}
}

// A missing team is NotFound, not a silently-created orphan info row.
func TestTeamInfoUpdate_MissingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	_, err := svc.TeamInfoUpdate(context.Background(), connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
		TeamId:        9_999_999,
		ContactNumber: proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// #145 — a selling team's DEFAULT SHIPPING WAREHOUSE round-trips, and a present zero clears it.
//
// Every order must name a warehouse (#72), and a selling team almost always ships from the same
// building — so this is that answer, held once. It is a DEFAULT, not a rule: nothing here makes the
// server accept an order that names no warehouse.
func TestTeamInfoUpdate_DefaultWarehouseRoundTripsAndClears(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)
	ctx := context.Background()

	const team, warehouse uint64 = 1, 5

	set := func(id uint64) *teamv1.TeamInfo {
		t.Helper()

		res, err := svc.TeamInfoUpdate(ctx, connect.NewRequest(&teamv1.TeamInfoUpdateRequest{
			TeamId: team, DefaultWarehouseId: &id,
		}))
		if err != nil {
			t.Fatalf("TeamInfoUpdate(%d): %v", id, err)
		}

		return res.Msg.GetInfo()
	}

	if got := set(warehouse).GetDefaultWarehouseId(); got != warehouse {
		t.Fatalf("default warehouse = %d, want %d", got, warehouse)
	}

	// Read it back rather than trusting the write's echo — the value has to have reached the table.
	detail, err := svc.TeamDetail(ctx, connect.NewRequest(&teamv1.TeamDetailRequest{TeamId: team}))
	if err != nil {
		t.Fatalf("TeamDetail: %v", err)
	}
	if got := detail.Msg.GetTeam().GetInfo().GetDefaultWarehouseId(); got != warehouse {
		t.Fatalf("stored default warehouse = %d, want %d", got, warehouse)
	}

	// A present ZERO is an explicit clear, not "leave it alone" — the same rule the return ids follow.
	if got := set(0).GetDefaultWarehouseId(); got != 0 {
		t.Fatalf("after clearing, default warehouse = %d, want 0", got)
	}
}
