package settlement_v1

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strconv"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// OrderShopHandler moves a FIXED order's account to its new shop (an-orders-shop-is-fixed-and-counted-on-the-day) from
// selling's OrderShopChanged — settlement's own subscription on that topic, beside the order metrics' fold. The order
// never calls settlement: it publishes, and this push handler moves the account.
//
// Any other variant is ACKED: redelivering a message nothing here will ever handle is a loop, not a retry.
func (s *Service) OrderShopHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		fixed := event.GetOrderShopChanged()
		if fixed == nil {
			return nil
		}

		_, err := s.MoveOrderShop(ctx, ShopMoveInput{
			TeamID:   fixed.GetTeamId(),
			OrderID:  fixed.GetOrderId(),
			ToShopID: fixed.GetToShopId(),
			ChangeID: fixed.GetChangeId(),
			// The fix's own day — the act's, never the delivery's (the-cancel-key-is-order-plus-act-date's reason).
			OccurredOn: event.GetOccurredAt().AsTime().In(jakarta).Format(time.DateOnly),
			ActorID:    fixed.GetActorId(),
			IsOverride: fixed.GetActorIsOverride(),
		})

		return err
	}
}

// ShopMoveInput is one fix of an order's shop, as settlement applies it.
type ShopMoveInput struct {
	TeamID  uint64
	OrderID uint64
	// The shop the order is filed under now.
	ToShopID uint64
	// The fix's id (selling's `order_shop_changes`) — the claim, and how fixes of one order are ordered.
	ChangeID uint64
	// YYYY-MM-DD — the day the fix was made; the moving rows' `occurred_on`.
	OccurredOn string
	// Who fixed it, and whether from outside the team — stamped on the moving rows.
	ActorID    uint64
	IsOverride bool
}

// ShopMoveResult is what a move did: the rows it posted and the account as it now is. Moved false = nothing moved —
// a redelivery, a fix older than one already applied, an account already on that shop, or no account yet.
type ShopMoveResult struct {
	Moved   bool
	Entries []settlement_service_models.SettlementLog
	State   settlement_service_models.OrderSettlement
}

// shopMoveSum is the order's rows of one type under one shop — what a move takes out of that shop.
type shopMoveSum struct {
	ShopID         uint64
	SettlementType string
	Total          float64
}

// MoveOrderShop moves an order's account to the shop the order is now filed under, so that shop's statement imports
// (a-file-with-another-shops-orders-is-refused no longer meets it, and SettlementPost's errWrongShop takes the new
// shop's rows) and the shop reports count the move.
//
// ⚠ THE LEDGER IS NOT EDITED. Its rows are immutable — a correction is a new row — so the move is a PAIR OF ROWS PER
// SETTLEMENT TYPE: the order's figure of that type out of the old shop (−) and into the new (+), source `order`,
// `occurred_on` the fix's day and `posted_on` the day settlement wrote them. Folded like every row, they take the
// order's figures off the old shop's report and onto the new one's on that day — the old shop −, the new + — and no
// past day changes (an-orders-shop-is-fixed-and-counted-on-the-day). The order's own balance and live sale end where
// they were; only the account's shop moves.
//
// ⚠ UNDER THE ACCOUNT'S LOCK — the one every post on the order takes. A post that committed first is in the sums and
// moves with them; one after it names the account's new shop or is refused (errWrongShop). Two fixes' events serialise
// on it too.
//
// THE CLAIM (order_settlement_shop_moves) makes it once-only and ORDERED: a redelivery finds its own row and moves
// nothing, and a fix older than one already applied moves nothing either — the later fix already took the account to
// a newer shop. With no account yet (the sale never opened), nothing moves: the statement's first line opens it under
// the shop it names.
func (s *Service) MoveOrderShop(ctx context.Context, in ShopMoveInput) (ShopMoveResult, error) {
	var out ShopMoveResult

	occurred, err := parseDate(in.OccurredOn)
	if err != nil {
		return out, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var accounts []settlement_service_models.OrderSettlement

		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("order_id = ?", in.OrderID).
			Limit(1).
			Find(&accounts).
			Error
		if err != nil {
			return dbError(err)
		}

		hasAccount := len(accounts) == 1
		if hasAccount {
			out.State = accounts[0]

			// The order is the selling team's; an account of another team under its id is not this event's to move.
			if out.State.TeamID != in.TeamID {
				return errWrongTeam
			}
		}

		var latest uint64

		err = tx.
			Raw(`SELECT COALESCE(MAX(change_id), 0) FROM order_settlement_shop_moves WHERE order_id = ?`, in.OrderID).
			Scan(&latest).
			Error
		if err != nil {
			return dbError(err)
		}

		from := out.State.ShopID
		moving := hasAccount && latest < in.ChangeID && from != in.ToShopID

		to := from
		if moving {
			to = in.ToShopID
		}

		claim := tx.Exec(`
INSERT INTO order_settlement_shop_moves (change_id, order_id, team_id, from_shop_id, to_shop_id)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (change_id) DO NOTHING`,
			in.ChangeID, in.OrderID, in.TeamID, from, to)
		if claim.Error != nil {
			return dbError(claim.Error)
		}

		if claim.RowsAffected == 0 || !moving {
			return nil
		}

		// What the order has under every shop but the new one, per type — one shop in practice, the one the account
		// was on; a shop an earlier move emptied nets to 0 and moves nothing.
		var sums []shopMoveSum

		err = tx.
			Raw(`
SELECT shop_id, settlement_type, SUM(change) AS total
FROM settlement_logs
WHERE order_id = ? AND shop_id <> ?
GROUP BY shop_id, settlement_type`, in.OrderID, to).
			Scan(&sums).
			Error
		if err != nil {
			return dbError(err)
		}

		out.Entries = shopMoveEntries(in, sums, out.State, occurred)

		balance := out.State.LastBalance

		for i := range out.Entries {
			balance += out.Entries[i].Change
			out.Entries[i].Balance = balance

			err = tx.
				Create(&out.Entries[i]).
				Error
			if isUniqueViolation(err) {
				// A key only this move writes, taken: the ledger already holds a move this claim says never ran.
				return errUniqueIDTaken
			}

			if err != nil {
				return dbError(err)
			}
		}

		err = tx.
			Model(&settlement_service_models.OrderSettlement{}).
			Where("order_id = ?", in.OrderID).
			Updates(map[string]any{
				"shop_id":      to,
				"last_balance": balance,
				"updated_at":   gorm.Expr("NOW()"),
			}).
			Error
		if err != nil {
			return dbError(err)
		}

		out.State.ShopID = to
		out.State.LastBalance = balance
		out.Moved = true

		return nil
	})
	if err != nil {
		return ShopMoveResult{}, err
	}

	// ANNOUNCED AFTER THE COMMIT, never fatal (publishPosted): each row folds into the shop and person reports like
	// any other — the old shop's figure out, the new shop's in, on the day they were posted.
	for i := range out.Entries {
		state := out.State
		s.publishPosted(ctx, PostResult{Entry: out.Entries[i], State: &state, Created: true})
	}

	return out, nil
}

// shopMoveEntries is the move's rows, in a fixed order — by type, each type's rows out of the old shop(s) first, then its
// one row into the new shop. Balances are filled by the caller as they are written.
func shopMoveEntries(
	in ShopMoveInput,
	sums []shopMoveSum,
	account settlement_service_models.OrderSettlement,
	occurred time.Time,
) []settlement_service_models.SettlementLog {
	slices.SortFunc(sums, func(a, b shopMoveSum) int {
		return cmp.Or(cmp.Compare(a.SettlementType, b.SettlementType), cmp.Compare(a.ShopID, b.ShopID))
	})

	change := strconv.FormatUint(in.ChangeID, 10)
	entries := []settlement_service_models.SettlementLog{}

	row := func(shopID uint64, settlementType string, amount float64, note string) {
		order := in.OrderID

		entries = append(entries, settlement_service_models.SettlementLog{
			OrderID:        &order,
			ShopID:         shopID,
			TeamID:         account.TeamID,
			ActorID:        in.ActorID,
			IsOverride:     in.IsOverride,
			SourceType:     sourceOrder,
			SettlementType: settlementType,
			Change:         amount,
			UniqueID:       "order-shop-moved:" + change + ":" + strconv.FormatUint(shopID, 10) + ":" + settlementType,
			OccurredOn:     occurred,
			Note:           note,
		})
	}

	for i := 0; i < len(sums); {
		settlementType := sums[i].SettlementType
		moved := 0.0

		for ; i < len(sums) && sums[i].SettlementType == settlementType; i++ {
			if san_money.IsZero(sums[i].Total) {
				continue
			}

			moved += sums[i].Total
			row(sums[i].ShopID, settlementType, -sums[i].Total,
				fmt.Sprintf("order's shop fixed — moved out of shop %d to shop %d", sums[i].ShopID, in.ToShopID))
		}

		if san_money.IsZero(moved) {
			continue
		}

		row(in.ToShopID, settlementType, moved,
			fmt.Sprintf("order's shop fixed — moved into shop %d", in.ToShopID))
	}

	return entries
}
