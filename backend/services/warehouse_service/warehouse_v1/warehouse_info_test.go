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

// THE PROFILE MOVED HERE (the-warehouse-profile-lives-in-warehouse-service): a warehouse with none reads empty grids —
// its hours not set (a-warehouse-with-no-hours-is-not-closed); an update replaces both grids and the location, and the
// detail reads them back.
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
// one open every day receives now, and a warehouse with no profile at all has none either. Both of those have their
// hours NOT SET (a-warehouse-with-no-hours-is-not-closed), which the answer says.
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

		if s := states[id]; s.GetHoursSet() {
			t.Fatalf("warehouse %d = %+v, want its hours not set", id, s)
		}
	}

	if !states[alwaysOpen].GetHoursSet() {
		t.Fatalf("the all-day warehouse = %+v, want its hours set", states[alwaysOpen])
	}
}

// a-warehouse-with-no-hours-is-not-closed, through the handler and the stored rows: a warehouse with NO PROFILE ROW, or
// with a grid that opens on NO DAY, is answered `hours_set` false with nothing to warn; one with hours set is open or
// closed by them (closed now: the only open day is tomorrow's weekday, 08:00–17:00 WIB — closed whatever the hour); and a
// CLOSURE still warns for a warehouse with no hours set — with no profile row at all, or an all-closed grid.
func TestWarehouseReceivingStatus_NoHoursSetIsNotClosed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const noRow, allClosed, openNow, closedNow, closureNoRow, closureAllClosed uint64 = 21, 22, 23, 24, 25, 26

	wibZone := time.FixedZone("WIB", 7*3600)
	now := time.Now().In(wibZone)

	allDay := make([]*warehousev1.DayHours, 0, 7)
	for d := warehousev1.Weekday_WEEKDAY_MONDAY; d <= warehousev1.Weekday_WEEKDAY_SUNDAY; d++ {
		allDay = append(allDay, &warehousev1.DayHours{Weekday: d, Open: true, OpenTime: "00:00", CloseTime: "23:59"})
	}

	// Open on ONE weekday only — tomorrow's, in Jakarta. Proto weekdays are Monday=1 … Sunday=7.
	tomorrow := now.AddDate(0, 0, 1).Weekday()
	protoDay := warehousev1.Weekday(int32(tomorrow))
	if tomorrow == time.Sunday {
		protoDay = warehousev1.Weekday_WEEKDAY_SUNDAY
	}

	oneDay := []*warehousev1.DayHours{{Weekday: protoDay, Open: true, OpenTime: "08:00", CloseTime: "17:00"}}

	for id, receiving := range map[uint64][]*warehousev1.DayHours{
		allClosed: grid(false), openNow: allDay, closedNow: oneDay, closureAllClosed: grid(false),
	} {
		_, err := svc.WarehouseInfoUpdate(ctx, connect.NewRequest(&warehousev1.WarehouseInfoUpdateRequest{TeamId: id, ReceivingHours: receiving}))
		if err != nil {
			t.Fatalf("update %d: %v", id, err)
		}
	}

	// A closure around today, a day either side, so the test does not race midnight.
	for _, id := range []uint64{closureNoRow, closureAllClosed} {
		_, err := svc.WarehouseClosureAdd(ctx, connect.NewRequest(&warehousev1.WarehouseClosureAddRequest{
			TeamId:   id,
			FirstDay: now.AddDate(0, 0, -1).Format("2006-01-02"),
			LastDay:  now.AddDate(0, 0, 1).Format("2006-01-02"),
			Reason:   "Idul Fitri",
		}))
		if err != nil {
			t.Fatalf("closure %d: %v", id, err)
		}
	}

	res, err := svc.WarehouseReceivingStatus(ctx, connect.NewRequest(&warehousev1.WarehouseReceivingStatusRequest{
		WarehouseIds: []uint64{noRow, allClosed, openNow, closedNow, closureNoRow, closureAllClosed},
	}))
	if err != nil {
		t.Fatalf("status: %v", err)
	}

	states := res.Msg.GetStates()

	for _, id := range []uint64{noRow, allClosed} {
		s := states[id]
		if s.GetHoursSet() || s.GetReceivingNow() || s.GetNextOpeningUnix() != 0 || s.GetClosureReason() != "" {
			t.Fatalf("warehouse %d = %+v, want hours not set and nothing to warn", id, s)
		}
	}

	if s := states[openNow]; !s.GetHoursSet() || (!s.GetReceivingNow() && !(now.Hour() == 23 && now.Minute() == 59)) {
		t.Fatalf("the all-day warehouse = %+v, want hours set and receiving now", s)
	}

	s := states[closedNow]
	if !s.GetHoursSet() || s.GetReceivingNow() || s.GetClosureReason() != "" || s.GetNextOpeningUnix() == 0 {
		t.Fatalf("the one-day warehouse = %+v, want hours set, closed now, a next opening", s)
	}

	next := time.Unix(s.GetNextOpeningUnix(), 0).In(wibZone)
	// Tomorrow's weekday — or today's, had midnight passed between the clock read above and the handler's.
	if (next.Weekday() != tomorrow && next.Weekday() != now.Weekday()) || next.Hour() != 8 || next.Minute() != 0 {
		t.Fatalf("the one-day warehouse opens next %s, want %s 08:00 WIB", next, tomorrow)
	}

	for _, id := range []uint64{closureNoRow, closureAllClosed} {
		s := states[id]
		if s.GetHoursSet() || s.GetReceivingNow() || s.GetClosureReason() != "Idul Fitri" || s.GetNextOpeningUnix() != 0 {
			t.Fatalf("warehouse %d in a closure = %+v, want closed for Idul Fitri with its hours not set", id, s)
		}
	}
}
