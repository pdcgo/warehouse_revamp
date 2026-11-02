package warehouse_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func grid(open bool) []*warehousev1.DayHours {
	out := make([]*warehousev1.DayHours, 0, 7)
	for d := warehousev1.Weekday_WEEKDAY_MONDAY; d <= warehousev1.Weekday_WEEKDAY_SUNDAY; d++ {
		out = append(out, &warehousev1.DayHours{Weekday: d, Open: open, OpenTime: "08:00", CloseTime: "17:00"})
	}

	return out
}

// THE PROFILE MOVED HERE (the-warehouse-profile-lives-in-warehouse-service): a warehouse with none reads as closed every
// day; an update replaces both grids and the location, and the detail reads them back.
func TestWarehouseInfo_UpdateAndDetail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	empty, err := svc.WarehouseInfoDetail(ctx, connect.NewRequest(&warehousev1.WarehouseInfoDetailRequest{TeamId: gudangA}))
	if err != nil || len(empty.Msg.GetInfo().GetReceivingHours()) != 0 {
		t.Fatalf("no profile yet = %+v (%v), want empty grids", empty.Msg.GetInfo(), err)
	}

	_, err = svc.WarehouseInfoUpdate(ctx, connect.NewRequest(&warehousev1.WarehouseInfoUpdateRequest{
		TeamId: gudangA, OperatingHours: grid(true), ReceivingHours: grid(true), Location: "Jl. Raya Bekasi 1",
	}))
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	got, err := svc.WarehouseInfoDetail(ctx, connect.NewRequest(&warehousev1.WarehouseInfoDetailRequest{TeamId: gudangA}))
	if err != nil || len(got.Msg.GetInfo().GetReceivingHours()) != 7 || got.Msg.GetInfo().GetLocation() != "Jl. Raya Bekasi 1" {
		t.Fatalf("detail = %+v (%v), want the seven days and the location", got.Msg.GetInfo(), err)
	}
}

// a-warehouse-records-its-holidays: a closure is added with its reason, read back on the profile while it is still to
// come, refused when its days are backwards, and deleted only by its own warehouse.
func TestWarehouseClosure_AddReadAndDelete(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	first := time.Now().AddDate(0, 0, 10).Format("2006-01-02")
	last := time.Now().AddDate(0, 0, 17).Format("2006-01-02")

	added, err := svc.WarehouseClosureAdd(ctx, connect.NewRequest(&warehousev1.WarehouseClosureAddRequest{
		TeamId: gudangA, FirstDay: first, LastDay: last, Reason: "Idul Fitri",
	}))
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	got, err := svc.WarehouseInfoDetail(ctx, connect.NewRequest(&warehousev1.WarehouseInfoDetailRequest{TeamId: gudangA}))
	if err != nil || len(got.Msg.GetInfo().GetClosures()) != 1 || got.Msg.GetInfo().GetClosures()[0].GetReason() != "Idul Fitri" {
		t.Fatalf("closures on the profile = %+v (%v), want Idul Fitri", got.Msg.GetInfo().GetClosures(), err)
	}

	_, err = svc.WarehouseClosureAdd(ctx, connect.NewRequest(&warehousev1.WarehouseClosureAddRequest{
		TeamId: gudangA, FirstDay: last, LastDay: first, Reason: "backwards",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a backwards closure: %v, want InvalidArgument", err)
	}

	id := added.Msg.GetClosure().GetId()

	_, err = svc.WarehouseClosureDelete(ctx, connect.NewRequest(&warehousev1.WarehouseClosureDeleteRequest{TeamId: gudangA + 1, ClosureId: id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another warehouse deleting it: %v, want NotFound", err)
	}

	_, err = svc.WarehouseClosureDelete(ctx, connect.NewRequest(&warehousev1.WarehouseClosureDeleteRequest{TeamId: gudangA, ClosureId: id}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
}

// a-closed-day-warns-and-never-refuses: every asked warehouse is answered — one closed every day has no next opening,
// one open every day receives now, and a warehouse with no profile at all is closed.
func TestWarehouseReceivingStatus_AnswersEveryAskedWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const alwaysOpen, neverOpen, noProfile uint64 = 11, 12, 13

	allDay := make([]*warehousev1.DayHours, 0, 7)
	for d := warehousev1.Weekday_WEEKDAY_MONDAY; d <= warehousev1.Weekday_WEEKDAY_SUNDAY; d++ {
		allDay = append(allDay, &warehousev1.DayHours{Weekday: d, Open: true, OpenTime: "00:00", CloseTime: "23:59"})
	}

	for id, receiving := range map[uint64][]*warehousev1.DayHours{alwaysOpen: allDay, neverOpen: grid(false)} {
		_, err := svc.WarehouseInfoUpdate(ctx, connect.NewRequest(&warehousev1.WarehouseInfoUpdateRequest{TeamId: id, ReceivingHours: receiving}))
		if err != nil {
			t.Fatalf("update %d: %v", id, err)
		}
	}

	res, err := svc.WarehouseReceivingStatus(ctx, connect.NewRequest(&warehousev1.WarehouseReceivingStatusRequest{
		WarehouseIds: []uint64{alwaysOpen, neverOpen, noProfile},
	}))
	if err != nil {
		t.Fatalf("status: %v", err)
	}

	states := res.Msg.GetStates()
	if len(states) != 3 {
		t.Fatalf("%d states, want every asked warehouse", len(states))
	}

	// 23:59 to 00:00 is the one minute an all-day grid is closed; the test does not race it.
	if now := time.Now().In(time.FixedZone("WIB", 7*3600)); !(now.Hour() == 23 && now.Minute() == 59) && !states[alwaysOpen].GetReceivingNow() {
		t.Fatalf("the all-day warehouse is not receiving now: %+v", states[alwaysOpen])
	}

	for _, id := range []uint64{neverOpen, noProfile} {
		if s := states[id]; s.GetReceivingNow() || s.GetNextOpeningUnix() != 0 {
			t.Fatalf("warehouse %d = %+v, want closed with no next opening", id, s)
		}
	}
}
