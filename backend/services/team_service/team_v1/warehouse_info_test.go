package team_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func day(w teamv1.Weekday, open bool, o, c string) *teamv1.DayHours {
	return &teamv1.DayHours{Weekday: w, Open: open, OpenTime: o, CloseTime: c}
}

// Update then Detail round-trips both schedules.
func TestWarehouseInfo_UpdateThenDetail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH1")

	_, err := svc.WarehouseInfoUpdate(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoUpdateRequest{
		TeamId: teamID,
		OperatingHours: []*teamv1.DayHours{
			day(teamv1.Weekday_WEEKDAY_MONDAY, true, "09:00", "17:00"),
			day(teamv1.Weekday_WEEKDAY_SUNDAY, false, "", ""),
		},
		ReceivingHours: []*teamv1.DayHours{
			day(teamv1.Weekday_WEEKDAY_MONDAY, true, "10:00", "15:00"),
		},
	}))
	if err != nil {
		t.Fatalf("WarehouseInfoUpdate: %v", err)
	}

	res, err := svc.WarehouseInfoDetail(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoDetailRequest{
		TeamId: teamID,
	}))
	if err != nil {
		t.Fatalf("WarehouseInfoDetail: %v", err)
	}

	op := res.Msg.GetInfo().GetOperatingHours()
	if len(op) != 2 {
		t.Fatalf("operating rows = %d, want 2", len(op))
	}

	if op[0].GetWeekday() != teamv1.Weekday_WEEKDAY_MONDAY || op[0].GetOpenTime() != "09:00" || op[0].GetCloseTime() != "17:00" {
		t.Errorf("monday operating = %+v, want Mon 09:00-17:00", op[0])
	}

	// A closed day keeps its flag and drops its times.
	if op[1].GetOpen() {
		t.Errorf("sunday should be closed, got %+v", op[1])
	}

	rc := res.Msg.GetInfo().GetReceivingHours()
	if len(rc) != 1 || rc[0].GetOpenTime() != "10:00" {
		t.Errorf("receiving = %+v, want one Mon 10:00-15:00 row", rc)
	}
}

// A second update fully REPLACES the schedule (not merges).
func TestWarehouseInfo_UpdateReplaces(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH2")

	update := func(rows ...*teamv1.DayHours) {
		_, err := svc.WarehouseInfoUpdate(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoUpdateRequest{
			TeamId: teamID, OperatingHours: rows,
		}))
		if err != nil {
			t.Fatalf("update: %v", err)
		}
	}

	update(day(teamv1.Weekday_WEEKDAY_MONDAY, true, "09:00", "17:00"), day(teamv1.Weekday_WEEKDAY_TUESDAY, true, "09:00", "17:00"))
	update(day(teamv1.Weekday_WEEKDAY_MONDAY, true, "08:00", "12:00"))

	res, _ := svc.WarehouseInfoDetail(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoDetailRequest{TeamId: teamID}))
	op := res.Msg.GetInfo().GetOperatingHours()

	if len(op) != 1 || op[0].GetOpenTime() != "08:00" {
		t.Fatalf("after replace, operating = %+v, want a single Mon 08:00-12:00", op)
	}
}

// Hours can only be set on a WAREHOUSE team.
func TestWarehouseInfo_RejectsNonWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "selling", "SELL1")

	_, err := svc.WarehouseInfoUpdate(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoUpdateRequest{
		TeamId:         teamID,
		OperatingHours: []*teamv1.DayHours{day(teamv1.Weekday_WEEKDAY_MONDAY, true, "09:00", "17:00")},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument for a non-warehouse team", connect.CodeOf(err))
	}
}

func TestWarehouseInfo_ValidationRejects(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH3")

	cases := map[string][]*teamv1.DayHours{
		"open after close":  {day(teamv1.Weekday_WEEKDAY_MONDAY, true, "17:00", "09:00")},
		"bad time format":   {day(teamv1.Weekday_WEEKDAY_MONDAY, true, "9am", "5pm")},
		"duplicate weekday": {day(teamv1.Weekday_WEEKDAY_MONDAY, true, "09:00", "12:00"), day(teamv1.Weekday_WEEKDAY_MONDAY, true, "13:00", "17:00")},
	}

	for name, rows := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := svc.WarehouseInfoUpdate(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoUpdateRequest{
				TeamId: teamID, OperatingHours: rows,
			}))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
			}
		})
	}
}

// A warehouse with no hours set returns empty schedules, not an error.
func TestWarehouseInfo_DetailEmptyWhenUnset(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	teamID := newTeam(t, db, "warehouse", "WH4")

	res, err := svc.WarehouseInfoDetail(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoDetailRequest{
		TeamId: teamID,
	}))
	if err != nil {
		t.Fatalf("WarehouseInfoDetail on an un-set warehouse should succeed, got: %v", err)
	}

	if len(res.Msg.GetInfo().GetOperatingHours()) != 0 || len(res.Msg.GetInfo().GetReceivingHours()) != 0 {
		t.Errorf("want empty schedules, got %+v", res.Msg.GetInfo())
	}
}

// Detail on a non-warehouse / missing team is NotFound.
func TestWarehouseInfo_DetailNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(db)

	_, err := svc.WarehouseInfoDetail(context.Background(), connect.NewRequest(&teamv1.WarehouseInfoDetailRequest{
		TeamId: 999999,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
