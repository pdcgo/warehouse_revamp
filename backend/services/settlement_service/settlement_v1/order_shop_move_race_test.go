//go:build raceaudit

// Concurrency audit for MoveOrderShop (the audit-sql skill) — an-orders-shop-is-fixed-and-counted-on-the-day.
//
// The move is one transaction under the ORDER ACCOUNT's row lock — the lock every post on the order takes: the claim,
// the order's sums per shop and type, the pairs of rows, the account's new shop. Two things could go wrong without it:
// a post landing between the sums and the account's new shop (its money left behind under the old shop, the account
// moved without it), and two deliveries of moves both moving. Both are proved here.
//
//	go test -tags raceaudit -count=5 -run 'TestRace_MoveOrderShop' -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

var shopMoveTables = []string{
	"settlement_logs",
	"order_settlements",
	"shop_settlements",
	"order_settlement_shop_moves",
}

// A MOVE RACING THE STATEMENT, × 20 rounds: the move to the new shop and six lines at once — three naming the old shop,
// three the new. Each line either landed before the move (old shop — then moved with it) or after it (new shop); every
// other is refused as the wrong shop. Whatever the order: the account is on the new shop, the old shop nets to 0 on
// every type, the new one holds every landed line, and the account's balance is the log's sum.
func TestRace_MoveOrderShop_AgainstTheStatement(t *testing.T) {
	h := san_race.New(t, shopMoveTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	const lines = 6

	// Across the rounds, lines landed under each shop — so both sides of the move were run.
	landedOld, landedNew := 0, 0

	for round := range 20 {
		orderID := order + uint64(round)*10

		_, err := svc.PostEntry(ctx, settlement_v1.PostInput{
			TeamID: team, ShopID: shop, OrderID: orderID, UniqueID: fmt.Sprintf("open-%d", orderID),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER, Change: -sale, OccurredOn: "2026-08-28",
		})
		if err != nil {
			t.Fatalf("round %d: open: %v", round, err)
		}

		landed := make([]bool, lines)

		res := h.Race(t, lines+1, func(i int) error {
			if i == lines {
				_, err := svc.MoveOrderShop(ctx, settlement_v1.ShopMoveInput{
					TeamID: team, OrderID: orderID, ToShopID: newShop, ChangeID: uint64(round + 1), OccurredOn: "2026-11-18",
				})

				return err
			}

			target := shop
			if i%2 == 1 {
				target = newShop
			}

			_, err := svc.PostEntry(ctx, settlement_v1.PostInput{
				TeamID: team, ShopID: target, OrderID: orderID, UniqueID: fmt.Sprintf("line-%d-%d", orderID, i),
				SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
				SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: 1_000, OccurredOn: "2026-11-18",
			})

			// The wrong shop for the moment it arrived is an answer, not a failure of the race.
			if connect.CodeOf(err) == connect.CodeInvalidArgument {
				return nil
			}

			landed[i] = err == nil

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		var state struct {
			ShopID      uint64
			LastBalance float64
		}

		err = db.Raw(`SELECT shop_id, last_balance FROM order_settlements WHERE order_id = ?`, orderID).Scan(&state).Error
		if err != nil || state.ShopID != newShop {
			t.Fatalf("round %d: the account is on %d (err %v), want %d", round, state.ShopID, err, newShop)
		}

		var sums []struct {
			ShopID         uint64
			SettlementType string
			Total          float64
		}

		err = db.Raw(`SELECT shop_id, settlement_type, SUM(change) AS total FROM settlement_logs WHERE order_id = ?
GROUP BY shop_id, settlement_type`, orderID).Scan(&sums).Error
		if err != nil {
			t.Fatalf("round %d: sums: %v", round, err)
		}

		landedCount := 0

		for i, ok := range landed {
			if !ok {
				continue
			}

			landedCount++

			if i%2 == 1 {
				landedNew++
			} else {
				landedOld++
			}
		}

		total := 0.0

		for _, sum := range sums {
			total += sum.Total

			switch {
			case sum.ShopID == shop && !san_money.IsZero(sum.Total):
				t.Fatalf("round %d: the old shop keeps %v of %s — a line was left behind", round, sum.Total, sum.SettlementType)
			case sum.ShopID == newShop && sum.SettlementType == "fund" && !san_money.Equal(sum.Total, float64(landedCount)*1_000):
				t.Fatalf("round %d: the new shop holds %v of fund, %d lines landed", round, sum.Total, landedCount)
			}
		}

		if !san_money.Equal(total, state.LastBalance) {
			t.Fatalf("round %d: the account's balance %v, the log's sum %v", round, state.LastBalance, total)
		}
	}

	t.Logf("lines landed: %d under the old shop (before the move, then moved), %d under the new", landedOld, landedNew)

	if landedOld == 0 || landedNew == 0 {
		t.Fatalf("only one side ran (%d old, %d new) — the race proves nothing about the other", landedOld, landedNew)
	}
}

// THE SAME MOVE DELIVERED FOUR TIMES AT ONCE, and an older fix beside it, × 10 rounds: exactly one moves — one pair per
// type, never two.
func TestRace_MoveOrderShop_RedeliveriesMoveOnce(t *testing.T) {
	h := san_race.New(t, shopMoveTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	for round := range 10 {
		orderID := order + uint64(round)*10

		_, err := svc.PostEntry(ctx, settlement_v1.PostInput{
			TeamID: team, ShopID: shop, OrderID: orderID, UniqueID: fmt.Sprintf("open-%d", orderID),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER, Change: -sale, OccurredOn: "2026-08-28",
		})
		if err != nil {
			t.Fatalf("round %d: open: %v", round, err)
		}

		change := uint64(1000 + round*10)

		res := h.Race(t, 5, func(i int) error {
			in := settlement_v1.ShopMoveInput{
				TeamID: team, OrderID: orderID, ToShopID: newShop, ChangeID: change, OccurredOn: "2026-11-18",
			}
			if i == 4 {
				in.ChangeID, in.ToShopID = change-1, 32
			}

			_, err := svc.MoveOrderShop(ctx, in)

			return err
		})

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		var moving int64

		err = db.Raw(`SELECT count(*) FROM settlement_logs WHERE order_id = ? AND unique_id LIKE 'order-shop-moved:%'`, orderID).
			Scan(&moving).Error
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}

		var shopID uint64

		err = db.Raw(`SELECT shop_id FROM order_settlements WHERE order_id = ?`, orderID).Scan(&shopID).Error
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}

		// The older fix to 32 either ran first (a pair to 32, then the newer one's pair to 31) or was found stale.
		if shopID != newShop || (moving != 2 && moving != 4) {
			t.Fatalf("round %d: account on %d with %d moving rows, want shop %d and one pair per applied fix",
				round, shopID, moving, newShop)
		}
	}
}
