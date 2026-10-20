package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var errOrderLineTwice = errors.New("an order transaction lists each product once")

// OrderTransactionCreate is an order's take on the decided ledgers (docs/business/inventory/order.md §Inventory Service
// Flow When Order Created Called Our `OrderTransactionCreate`), in the decided order:
//
//  1. K is looked up first; a used key is refused, never answered with the earlier take (a-used-key-is-refused-first).
//  2. The products are read from product_service BEFORE any transaction (the-take-checks-the-product-first): a borrowed
//     line on a private product, or one whose owner's total stock — every warehouse, a plain read — is below its
//     reserve, is refused (the-reserve-is-read-before-the-take, the-reserve-stops-other-teams-at-low-stock).
//  3. One transaction: every line counted under the batch lock, then the take, then K claimed with it — a same-second
//     twin meets the unique index and is refused as a used key (the-key-is-claimed-in-its-own-table).
//
// Each refusal is ONE error with ONE reason, naming every refused line (a-refusal-names-its-reason-and-every-line).
func (s *Service) OrderTransactionCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.OrderTransactionCreateRequest],
) (*connect.Response[inventoryv1.OrderTransactionCreateResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()

	ids := make([]uint64, 0, len(msg.GetLines()))
	seen := make(map[uint64]struct{}, len(msg.GetLines()))

	for _, line := range msg.GetLines() {
		if _, dup := seen[line.GetProductId()]; dup {
			return nil, connect.NewError(connect.CodeInvalidArgument, errOrderLineTwice)
		}

		seen[line.GetProductId()] = struct{}{}
		ids = append(ids, line.GetProductId())
	}

	// 1. THE KEY FIRST.
	used, err := keyClaimed(s.db.WithContext(ctx), msg.GetIdempotencyKey())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if used {
		return nil, refusal(connect.CodeAlreadyExists, inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED, nil)
	}

	// 2. THE PRODUCTS, before any transaction — a call to another service never runs under a lock.
	facts, err := s.products.Facts(ctx, teamID, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ask product facts: %w", err))
	}

	notAllowed, err := s.notAllowedLines(ctx, teamID, msg.GetLines(), facts)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if len(notAllowed) > 0 {
		return nil, refusal(connect.CodeFailedPrecondition,
			inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ALLOWED, notAllowed)
	}

	order := inventory_mutations.Order{
		WarehouseID: msg.GetWarehouseId(),
		TeamID:      teamID,
		ActorID:     actorFrom(ctx),
	}

	for _, line := range msg.GetLines() {
		order.Lines = append(order.Lines, inventory_mutations.OrderLine{
			ProductID:   line.GetProductId(),
			OwnerTeamID: facts[line.GetProductId()].TeamID,
			Quantity:    line.GetQuantity(),
		})
	}

	// 3. ONE TRANSACTION: the take, then K claimed with it.
	var (
		t     inventory_service_models.InventoryTransaction
		taken []inventory_mutations.TakenLine
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var postErr error

		t, taken, postErr = inventory_mutations.PostOrder(tx, order)
		if postErr != nil {
			return postErr
		}

		return tx.Exec(`INSERT INTO idempotency_order_check (idempotency_key, transaction_id) VALUES (?, ?)`,
			msg.GetIdempotencyKey(), t.ID).Error
	})
	if err != nil {
		var short *inventory_mutations.ShortLinesError
		if errors.As(err, &short) {
			lines := make([]*inventoryv1.OrderTransactionRefusedLine, 0, len(short.Lines))
			for _, l := range short.Lines {
				lines = append(lines, &inventoryv1.OrderTransactionRefusedLine{
					ProductId: l.ProductID, Wanted: l.Wanted, Available: l.Available,
				})
			}

			return nil, refusal(connect.CodeFailedPrecondition,
				inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ENOUGH_STOCK, lines)
		}

		if isUniqueViolation(err) {
			return nil, refusal(connect.CodeAlreadyExists, inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED, nil)
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(pricedTake(t, taken, teamID, facts)), nil
}

// notAllowedLines names every borrowed line the owner's rules stop: a product that exists nowhere, a private one, or one
// whose owner's total stock across every warehouse is below its reserve. The ordering team's own lines are never
// stopped — the reserve and the lock are rules for OTHER teams.
func (s *Service) notAllowedLines(
	ctx context.Context,
	teamID uint64,
	lines []*inventoryv1.OrderTransactionLine,
	facts map[uint64]ProductFact,
) ([]*inventoryv1.OrderTransactionRefusedLine, error) {
	var refused []*inventoryv1.OrderTransactionRefusedLine

	for _, line := range lines {
		fact, ok := facts[line.GetProductId()]

		allowed := ok
		if ok && fact.TeamID != teamID {
			if fact.Private {
				allowed = false
			}

			if allowed && fact.ReservedStock > 0 {
				total, err := ownerTotalStock(s.db.WithContext(ctx), fact.TeamID, line.GetProductId())
				if err != nil {
					return nil, err
				}

				allowed = total >= fact.ReservedStock
			}
		}

		if !allowed {
			refused = append(refused, &inventoryv1.OrderTransactionRefusedLine{
				ProductId: line.GetProductId(), Wanted: line.GetQuantity(),
			})
		}
	}

	return refused, nil
}

// ownerTotalStock is the owner's units of a product across every warehouse — a plain read, outside any lock
// (the-reserve-is-read-before-the-take): two borrowers in the same second may both pass, an accepted cost.
func ownerTotalStock(db *gorm.DB, teamID, productID uint64) (int64, error) {
	var total int64

	err := db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE team_id = ? AND product_id = ?`,
		teamID, productID).Scan(&total).Error
	if err != nil {
		return 0, fmt.Errorf("owner's total stock of product %d: %w", productID, err)
	}

	return total, nil
}

// keyClaimed reports whether K is already in idempotency_order_check — by a take, or by a release that came first.
func keyClaimed(db *gorm.DB, key string) (bool, error) {
	var count int64

	err := db.Model(&inventory_service_models.IdempotencyOrderCheck{}).Where("idempotency_key = ?", key).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("look up the order key: %w", err)
	}

	return count > 0, nil
}

// pricedTake answers the take: per line its owner, its cost, and — for another team's product — the owner's markup on
// top (inventory-computes-the-markup, the-take-names-the-orderer-and-each-owner).
func pricedTake(
	t inventory_service_models.InventoryTransaction,
	taken []inventory_mutations.TakenLine,
	teamID uint64,
	facts map[uint64]ProductFact,
) *inventoryv1.OrderTransactionCreateResponse {
	sort.Slice(taken, func(i, j int) bool { return taken[i].ProductID < taken[j].ProductID })

	res := &inventoryv1.OrderTransactionCreateResponse{TransactionId: t.ID, WarehouseId: t.WarehouseID}

	for _, line := range taken {
		unitCost := line.Value / float64(line.Quantity)

		withMarkup := unitCost
		if line.OwnerTeamID != teamID {
			withMarkup = unitCost * (1 + float64(facts[line.ProductID].CrossMarkupBps)/10000)
		}

		total := withMarkup * float64(line.Quantity)

		res.Items = append(res.Items, &inventoryv1.OrderTransactionItem{
			ProductId:          line.ProductID,
			OwnerTeamId:        line.OwnerTeamID,
			Quantity:           line.Quantity,
			UnitCost:           unitCost,
			UnitCostWithMarkup: withMarkup,
			MarkupTotal:        total - line.Value,
			Total:              total,
		})

		res.Total += total
	}

	return res
}

// refusal is the one error a refused take returns, carrying its reason and the lines it names.
func refusal(
	code connect.Code,
	reason inventoryv1.OrderTransactionRefusalReason,
	lines []*inventoryv1.OrderTransactionRefusedLine,
) error {
	err := connect.NewError(code, fmt.Errorf("order transaction refused: %s", reason.String()))

	detail, detailErr := connect.NewErrorDetail(&inventoryv1.OrderTransactionRefusal{Reason: reason, Lines: lines})
	if detailErr == nil {
		err.AddDetail(detail)
	}

	return err
}
