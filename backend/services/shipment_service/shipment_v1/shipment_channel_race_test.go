//go:build raceaudit

// Concurrency audit for the ShipmentChannel write RPCs (the audit-sql skill).
//
// ⚠ san_race.New is given NO tables: `shipment_channels` holds migration-seeded reference rows
// (jne/jnt/sicepat) that the rolling-back unit tests read, and a DELETE FROM would wipe them from
// warehouse_test. Every row here uses a `race_` code and is deleted by that prefix instead.
//
//	go test -tags raceaudit -run TestRace_ShipmentChannel -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

func raceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t)

	clean := func() {
		err := h.DB().Exec(`DELETE FROM shipment_channels WHERE code LIKE 'race\_%'`).Error
		if err != nil {
			t.Errorf("clean race rows: %v", err)
		}
	}

	clean()
	t.Cleanup(clean)

	return h
}

func loadChannel(t *testing.T, db *gorm.DB, id uint64) shipment_service_models.ShipmentChannel {
	t.Helper()

	var c shipment_service_models.ShipmentChannel

	err := db.Where("id = ?", id).First(&c).Error
	if err != nil {
		t.Fatalf("load channel %d: %v", id, err)
	}

	return c
}

// Two creates of one code: exactly one row, one success, the rest AlreadyExists — never Internal.
func TestRace_ShipmentChannelCreate_SameCode(t *testing.T) {
	h := raceHarness(t)
	svc := shipment_v1.NewService(h.DB())

	for round := range 10 {
		code := fmt.Sprintf("race_dup_%d", round)
		codes := make([]connect.Code, 8)

		res := h.Race(t, 8, func(i int) error {
			_, err := svc.ShipmentChannelCreate(context.Background(), connect.NewRequest(
				&shipmentv1.ShipmentChannelCreateRequest{Code: code, Name: "Race"}))
			codes[i] = connect.CodeOf(err)
			return err
		})

		if round == 0 {
			res.Report(t)
		}

		var rows int64
		h.DB().Model(&shipment_service_models.ShipmentChannel{}).Where("code = ?", code).Count(&rows)

		if rows != 1 {
			t.Fatalf("round %d: %d rows for one code", round, rows)
		}

		if res.Count(san_race.None) != 1 {
			t.Fatalf("round %d: %d creates succeeded", round, res.Count(san_race.None))
		}

		for i, o := range res.Outcomes {
			if o.Err != nil && codes[i] != connect.CodeAlreadyExists {
				t.Fatalf("round %d caller %d: code %v, want already_exists: %v", round, i, codes[i], o.Err)
			}
		}
	}
}

// The losing window, forced: B's pre-check runs while A's INSERT is uncommitted, so B passes the
// check and reaches its own INSERT, which must WAIT on the unique index and then be refused as
// AlreadyExists — the path the pre-check cannot cover.
func TestRace_ShipmentChannelCreate_Interleave(t *testing.T) {
	h := raceHarness(t)

	const code = "race_interleave"

	var errB error

	create := func(tx *gorm.DB) error {
		_, err := shipment_v1.NewService(tx).ShipmentChannelCreate(context.Background(),
			connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{Code: code, Name: "Race"}))
		return err
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A creates (uncommitted)", create),
		san_race.Block("B", "B creates the same code", func(tx *gorm.DB) error {
			errB = create(tx)
			return errB
		}),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	sched.Report(t)

	b := sched.Get("B creates the same code")
	if !b.Blocked {
		t.Fatalf("B's INSERT did not wait on the unique index")
	}

	if connect.CodeOf(errB) != connect.CodeAlreadyExists {
		t.Fatalf("B got %v (%v), want already_exists", connect.CodeOf(errB), errB)
	}
}

// Delete and restore hammering one row: no caller errors, and the row ends in one coherent state.
func TestRace_ShipmentChannelDeleteRestore(t *testing.T) {
	h := raceHarness(t)
	svc := shipment_v1.NewService(h.DB())
	ch := mustCreate(t, svc, "race_toggle", "Toggle")
	ctx := context.Background()

	res := h.Race(t, 16, func(i int) error {
		id := ch.GetId()

		if i%2 == 0 {
			r, err := svc.ShipmentChannelDelete(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: id}))
			if err == nil && !r.Msg.GetChannel().GetIsDeleted() {
				return fmt.Errorf("delete returned is_deleted=false")
			}
			return err
		}

		r, err := svc.ShipmentChannelRestore(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelRestoreRequest{ChannelId: id}))
		if err == nil && r.Msg.GetChannel().GetIsDeleted() {
			return fmt.Errorf("restore returned is_deleted=true")
		}
		return err
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d callers failed", res.Failed())
	}

	final := loadChannel(t, h.DB(), ch.GetId())
	if final.Code != "race_toggle" || final.Name != "Toggle" {
		t.Fatalf("row corrupted: %+v", final)
	}

	t.Logf("final is_deleted=%v", final.IsDeleted)
}

// Delete holds the row; restore waits, then applies on top of the committed delete — last writer
// wins, and its RETURNING shows its own write.
func TestRace_ShipmentChannelDeleteRestore_Interleave(t *testing.T) {
	h := raceHarness(t)
	ch := mustCreate(t, shipment_v1.NewService(h.DB()), "race_dr", "DR")
	ctx := context.Background()

	var restored *shipmentv1.ShipmentChannel

	sched := h.Interleave(t,
		san_race.Do("A", "A deletes", func(tx *gorm.DB) error {
			_, err := shipment_v1.NewService(tx).ShipmentChannelDelete(ctx,
				connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: ch.GetId()}))
			return err
		}),
		san_race.Block("B", "B restores", func(tx *gorm.DB) error {
			r, err := shipment_v1.NewService(tx).ShipmentChannelRestore(ctx,
				connect.NewRequest(&shipmentv1.ShipmentChannelRestoreRequest{ChannelId: ch.GetId()}))
			if err == nil {
				restored = r.Msg.GetChannel()
			}
			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B restores")
	if !b.Blocked || b.Err != nil {
		t.Fatalf("B blocked=%v err=%v", b.Blocked, b.Err)
	}

	if restored.GetIsDeleted() {
		t.Fatalf("restore's RETURNING shows is_deleted=true")
	}

	if loadChannel(t, h.DB(), ch.GetId()).IsDeleted {
		t.Fatalf("final row is deleted, want restored (B committed last)")
	}
}

// Update vs delete on one row: disjoint columns, so neither write may erase the other.
func TestRace_ShipmentChannelUpdateDelete_Interleave(t *testing.T) {
	h := raceHarness(t)
	ch := mustCreate(t, shipment_v1.NewService(h.DB()), "race_ud", "Before")
	ctx := context.Background()

	var deleted *shipmentv1.ShipmentChannel

	sched := h.Interleave(t,
		san_race.Do("A", "A renames", func(tx *gorm.DB) error {
			_, err := shipment_v1.NewService(tx).ShipmentChannelUpdate(ctx,
				connect.NewRequest(&shipmentv1.ShipmentChannelUpdateRequest{ChannelId: ch.GetId(), Name: "After", Desc: "d"}))
			return err
		}),
		san_race.Block("B", "B deletes", func(tx *gorm.DB) error {
			r, err := shipment_v1.NewService(tx).ShipmentChannelDelete(ctx,
				connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: ch.GetId()}))
			if err == nil {
				deleted = r.Msg.GetChannel()
			}
			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B deletes").Blocked {
		t.Fatalf("B did not wait for A's row lock")
	}

	if deleted.GetName() != "After" {
		t.Fatalf("delete's RETURNING shows name %q — it acted on a stale row", deleted.GetName())
	}

	final := loadChannel(t, h.DB(), ch.GetId())
	if final.Name != "After" || final.Desc != "d" || !final.IsDeleted {
		t.Fatalf("lost update: %+v", final)
	}
}

// N concurrent renames: every caller succeeds and the row ends on exactly one of the submitted names.
func TestRace_ShipmentChannelUpdate(t *testing.T) {
	h := raceHarness(t)
	svc := shipment_v1.NewService(h.DB())
	ch := mustCreate(t, svc, "race_upd", "Start")

	res := h.Race(t, 8, func(i int) error {
		_, err := svc.ShipmentChannelUpdate(context.Background(), connect.NewRequest(
			&shipmentv1.ShipmentChannelUpdateRequest{ChannelId: ch.GetId(), Name: fmt.Sprintf("N%d", i), Desc: fmt.Sprintf("D%d", i)}))
		return err
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d callers failed", res.Failed())
	}

	final := loadChannel(t, h.DB(), ch.GetId())
	if final.Name[1:] != final.Desc[1:] {
		t.Fatalf("torn row: name %q desc %q from different callers", final.Name, final.Desc)
	}
}
