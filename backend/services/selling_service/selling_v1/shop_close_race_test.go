//go:build raceaudit

// Concurrency audit for ShopClose, ShopReopen and ShopUpdate's new status check (the audit-sql skill) — the shop's
// lifecycle writes against each other and against an order being placed on the shop.
//
// Every row belongs to one race team and is cleaned by that scope (orders first: shops are their FK parent).
//
//	go test -tags raceaudit -p 1 -run 'TestRace_Shop(Close|Reopen|Update)' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// raceCloseTeam is the team every row of these audits belongs to — the scope they are cleaned by.
const raceCloseTeam uint64 = 7_700_043

func closeRaceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t)

	clean := func() {
		for _, sql := range []string{
			`DELETE FROM orders WHERE team_id = ?`,
			`DELETE FROM shop_users WHERE shop_id IN (SELECT id FROM shops WHERE team_id = ?)`,
			`DELETE FROM shops WHERE team_id = ?`,
		} {
			err := h.DB().Exec(sql, raceCloseTeam).Error
			if err != nil {
				t.Errorf("cleaning the race team: %v", err)
			}
		}
	}

	clean()
	t.Cleanup(clean)

	return h
}

func raceCloseOrder(svc *selling_v1.Service, shopID uint64) error {
	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		ShipmentChannelId:     testShipmentChannel,
		IdempotencyKey:        newOrderKey(),
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                raceCloseTeam, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, ProductCode: "SKU1", Name: "Widget", Quantity: 1},
		},
	}))

	return err
}

func raceCloseShop(svc *selling_v1.Service, shopID uint64) (*sellingv1.Shop, error) {
	res, err := svc.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{
		TeamId: raceCloseTeam, ShopId: shopID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetShop(), nil
}

func raceShopRow(t *testing.T, db *gorm.DB, shopID uint64) selling_service_models.Shop {
	t.Helper()

	var shop selling_service_models.Shop

	err := db.First(&shop, shopID).Error
	if err != nil {
		t.Fatalf("read shop %d: %v", shopID, err)
	}

	return shop
}

// lockedPicker is the stock take of an order placed from several goroutines — fakePicker is not safe for that.
type lockedPicker struct {
	mu sync.Mutex
	fakePicker
}

func (p *lockedPicker) Pick(ctx context.Context, teamID, warehouseID uint64, lines []selling_v1.PickLine, key string) (selling_v1.Take, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.fakePicker.Pick(ctx, teamID, warehouseID, lines, key)
}

func (p *lockedPicker) Return(ctx context.Context, teamID, warehouseID uint64, key string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.fakePicker.Return(ctx, teamID, warehouseID, key)
}

// A CLOSE AGAINST AN ORDER BEING PLACED (a-closed-shop-refuses-only-new-selling). OrderCreate's gate reads the shop
// before the take, outside any transaction; the close can land after it. The invariant: NO ORDER IS COMMITTED ON THE
// SHOP AFTER THE CLOSE — every committed order on it was created before its closed_at. The order's transaction holds
// the shop FOR SHARE and reads its status again (refuseClosedShopInTx), so either the order commits first and the close
// waits for it, or the close commits first and the order is refused, "the shop is closed", its take released.
// The closer sleeps round%10 ms so both orderings are hit; the counts are logged.
func TestRace_ShopClose_OrderCreate(t *testing.T) {
	h := closeRaceHarness(t)
	db := h.DB()

	picker := &lockedPicker{}
	svc := selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil, nil)

	placed, refused := 0, 0

	for round := range 30 {
		shopID := insertShop(t, db, raceCloseTeam, fmt.Sprintf("Race Close %d", round), fmt.Sprintf("RC-%d", round), "shopee")

		var orderErr error

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				orderErr = raceCloseOrder(svc, shopID)

				return nil
			}

			time.Sleep(time.Duration(round%10) * time.Millisecond)

			_, err := raceCloseShop(svc, shopID)

			return err
		})

		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: the close failed", round)
		}

		switch {
		case orderErr == nil:
			placed++
		case connect.CodeOf(orderErr) == connect.CodeFailedPrecondition && strings.Contains(orderErr.Error(), "the shop is closed"):
			refused++
		default:
			t.Fatalf("round %d: the order failed otherwise: %v", round, orderErr)
		}

		shop := raceShopRow(t, db, shopID)
		if shop.Status != selling_service_models.ShopClosed || shop.ClosedAt == nil {
			t.Fatalf("round %d: the shop is %q after the close", round, shop.Status)
		}

		var late int64

		err := db.
			Model(&selling_service_models.Order{}).
			Where("shop_id = ? AND created_at >= ?", shopID, *shop.ClosedAt).
			Count(&late).
			Error
		if err != nil {
			t.Fatalf("count late orders: %v", err)
		}

		if late > 0 {
			t.Fatalf("round %d: %d order(s) committed on the shop after its close", round, late)
		}

		var orders int64

		db.Model(&selling_service_models.Order{}).Where("shop_id = ?", shopID).Count(&orders)

		if (orderErr == nil) != (orders == 1) {
			t.Fatalf("round %d: order answer %v but %d order rows", round, orderErr, orders)
		}
	}

	picker.mu.Lock()
	defer picker.mu.Unlock()

	// A refused order was refused at the gate (nothing taken) or inside its transaction (taken, then released): every
	// take not released is a placed order.
	inTx := len(picker.returned)

	t.Logf("30 rounds: %d orders placed before the close, %d refused after it — %d at the gate, %d inside the order's "+
		"transaction (refuseClosedShopInTx, the take released)", placed, refused, refused-inTx, inTx)

	if len(picker.picked)-inTx != placed {
		t.Fatalf("%d takes, %d released, %d orders placed — every take kept must be a placed order",
			len(picker.picked), inTx, placed)
	}
}

// EIGHT MANAGERS CLOSE ONE SHOP AT ONCE: every one is answered closed, and the close happened once — every answer
// carries the same close date, the one stored.
func TestRace_ShopClose_SameShopAtOnce(t *testing.T) {
	h := closeRaceHarness(t)
	db := h.DB()
	svc := newService(t, db)

	const n = 8

	for round := range 5 {
		shopID := insertShop(t, db, raceCloseTeam, fmt.Sprintf("Race Twice %d", round), fmt.Sprintf("RT-%d", round), "shopee")

		answers := make([]*sellingv1.Shop, n)

		res := h.Race(t, n, func(i int) error {
			shop, err := raceCloseShop(svc, shopID)
			answers[i] = shop

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d closes failed", round, res.Failed())
		}

		stored := raceShopRow(t, db, shopID)

		for i, shop := range answers {
			if shop.GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_CLOSED || shop.GetClosedAtUnix() != stored.ClosedAt.Unix() {
				t.Fatalf("round %d close %d: answered %v at %d, stored closed at %d — want one close, its date in every answer",
					round, i, shop.GetStatus(), shop.GetClosedAtUnix(), stored.ClosedAt.Unix())
			}
		}
	}
}

// TWO CLOSED SHOPS ON ONE CODE, REOPENED AT ONCE (a-shop-code-is-unique-among-open-shops): never both open. Each
// reopen locks its own row, so both may find no open holder — the partial unique index is then the last word, and the
// loser is refused as a held code, never as an internal error.
func TestRace_ShopReopen_TwoShopsOneCode(t *testing.T) {
	h := closeRaceHarness(t)
	db := h.DB()
	svc := newService(t, db)

	for round := range 10 {
		code := fmt.Sprintf("RR-%d", round)

		a := insertShop(t, db, raceCloseTeam, "Race Reopen A", code, "shopee")

		_, err := raceCloseShop(svc, a)
		if err != nil {
			t.Fatalf("close a: %v", err)
		}

		b := insertShop(t, db, raceCloseTeam, "Race Reopen B", code, "shopee")

		_, err = raceCloseShop(svc, b)
		if err != nil {
			t.Fatalf("close b: %v", err)
		}

		shops := []uint64{a, b}

		res := h.Race(t, 2, func(i int) error {
			_, err := svc.ShopReopen(context.Background(), connect.NewRequest(&sellingv1.ShopReopenRequest{
				TeamId: raceCloseTeam, ShopId: shops[i],
			}))

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		opened, held := 0, 0

		for _, o := range res.Outcomes {
			switch {
			case o.Err == nil:
				opened++
			case connect.CodeOf(o.Err) == connect.CodeFailedPrecondition && strings.Contains(o.Err.Error(), code):
				held++
			default:
				t.Fatalf("round %d: a reopen failed otherwise: %v", round, o.Err)
			}
		}

		var open int64

		db.Model(&selling_service_models.Shop{}).
			Where("team_id = ? AND shop_code = ? AND status = ?", raceCloseTeam, code, selling_service_models.ShopOpen).
			Count(&open)

		if opened != 1 || held != 1 || open != 1 {
			t.Fatalf("round %d: %d reopened, %d refused, %d open on %s — want exactly one", round, opened, held, open, code)
		}
	}
}

// AN EDIT AGAINST A CLOSE (a-closed-shop-locks-all-but-its-grants): an edit either lands before the close, or is
// refused "reopen the shop first" — never written onto a shop already closed. Both take the row FOR NO KEY UPDATE;
// the close stamps updated_at with its closed_at, so a stored updated_at past the close is an edit that came after it.
func TestRace_ShopUpdate_ShopClose(t *testing.T) {
	h := closeRaceHarness(t)
	db := h.DB()
	svc := newService(t, db)

	edited, refused := 0, 0

	for round := range 20 {
		shopID := insertShop(t, db, raceCloseTeam, "Race Edit", fmt.Sprintf("RE-%d", round), "shopee")

		var editErr error

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, editErr = svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
					TeamId: raceCloseTeam, ShopId: shopID, Name: proto.String("Race Edited"),
				}))

				return nil
			}

			time.Sleep(time.Duration(round%10) * time.Millisecond)

			_, err := raceCloseShop(svc, shopID)

			return err
		})

		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: the close failed", round)
		}

		stored := raceShopRow(t, db, shopID)

		switch {
		case editErr == nil:
			edited++

			if stored.Name != "Race Edited" {
				t.Fatalf("round %d: the edit was answered but not stored", round)
			}
		case connect.CodeOf(editErr) == connect.CodeFailedPrecondition && strings.Contains(editErr.Error(), "reopen the shop first"):
			refused++

			if stored.Name != "Race Edit" {
				t.Fatalf("round %d: a refused edit was stored", round)
			}
		default:
			t.Fatalf("round %d: the edit failed otherwise: %v", round, editErr)
		}

		if stored.ClosedAt == nil || stored.UpdatedAt.After(*stored.ClosedAt) {
			t.Fatalf("round %d: updated %v after the close %v — an edit landed on a closed shop", round, stored.UpdatedAt, stored.ClosedAt)
		}
	}

	t.Logf("20 rounds: %d edits before the close, %d refused after it", edited, refused)
}
