package inventory_v1

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestAccept is the receiving WAREHOUSE counting the box in (any-warehouse-member-counts-what-arrived): per
// line, what is in the box and how many of those are broken; the short units are the difference, written as MISSING
// (a-short-unit-at-the-door-is-missing). The good units become stock on the placements named, in ONE transaction with
// the status — the restock row is locked first, and only an ongoing or arrived restock is accepted
// (accept-locks-the-restock).
//
// More in the box than the line says is refused: the selling team adds the extra by an edit first
// (accept-refuses-more-than-the-line-says, extra-units-are-added-by-the-selling-teams-edit).
func (s *Service) RestockRequestAccept(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestAcceptRequest],
) (*connect.Response[inventoryv1.RestockRequestAcceptResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	// THE COURIER'S CHARGE AT THE DOOR — one per restock, with its note (the-courier-is-paid-once-per-restock). Checked
	// before anything is written: the note rule spans two fields, which protovalidate cannot express.
	courierCharge := req.Msg.GetWarehouseAdditionalCost()
	courierNote := req.Msg.GetWarehouseAdditionalCostNote()

	if courierCharge > 0 && courierNote == "" {
		return nil, restockErr(errRestockCostNoteMissing)
	}

	var rr inventory_service_models.Restock

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			// The lock is on the restock row — the SAME lock cancel takes, so an accept and a cancel at the same
			// second queue on it and the second sees what the first did. Lines load separately (FOR UPDATE and a
			// join do not mix).
			Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), warehouseID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusOngoing && rr.Status != restockStatusArrived {
			return errRestockNotAcceptable
		}

		if len(rr.Items) == 0 {
			return errRestockNoItems
		}

		type placement struct {
			rack     uint64
			quantity int64
		}

		type countedLine struct {
			received    int64
			broken      int64
			brokenNote  string
			missingNote string
			placements  []placement
		}

		counted := make(map[uint64]countedLine, len(req.Msg.GetLines()))

		// Every rack named, checked once after the lines (ledger-writes-are-set-based).
		var named []uint64

		for _, line := range req.Msg.GetLines() {
			if _, dup := counted[line.GetItemId()]; dup {
				return errRestockCountIncomplete
			}

			cl := countedLine{
				received:    line.GetReceivedCount(),
				broken:      line.GetBrokenCount(),
				brokenNote:  line.GetBrokenNote(),
				missingNote: line.GetMissingNote(),
			}

			if cl.broken > cl.received {
				return errRestockBrokenOverReceived
			}

			// WHERE THE GOOD UNITS WENT. Every unit in stock is on a placement (there-is-no-unplaced-pile), each named
			// once, and together they hold exactly received − broken.
			var placed int64

			seen := make(map[uint64]struct{}, len(line.GetPlacements()))

			for _, p := range line.GetPlacements() {
				id := p.GetPlacementId()

				if _, dup := seen[id]; dup {
					return errRestockPlacementDuplicate
				}

				seen[id] = struct{}{}
				named = append(named, id)

				placed += p.GetQuantity()

				cl.placements = append(cl.placements, placement{rack: id, quantity: p.GetQuantity()})
			}

			good := cl.received - cl.broken

			if good > 0 && len(cl.placements) == 0 {
				return errRestockLineNoPlace
			}

			if placed != good {
				return errRestockPlacementMismatch
			}

			counted[line.GetItemId()] = cl
		}

		// Placements of the ACCEPTING warehouse — another warehouse's reads as NotFound.
		exists, checkErr := racksExist(tx, warehouseID, named)
		if checkErr != nil {
			return checkErr
		}

		if !exists {
			return errRackMissing
		}

		if len(counted) != len(rr.Items) {
			return errRestockCountIncomplete
		}

		// Nothing above the line's count — checked against the line, which only the loaded rows know.
		for i := range rr.Items {
			line, ok := counted[rr.Items[i].ID]
			if !ok {
				return errRestockCountIncomplete
			}

			if line.received > rr.Items[i].Count {
				return errRestockOverCount
			}
		}

		actor := actorFrom(ctx)

		// THE FREIGHT every unit carries: the shipping and the courier's charge — part of what the goods cost to get here
		// (the-couriers-ask-is-in-the-unit-price), outside the restock's total, inside the unit price.
		freight := rr.ShipmentCost + courierCharge

		// The landed unit price, over every unit ORDERED (all-qty-is-every-unit-ordered): the batch's price below and a
		// broken or missing unit's, FILLED BY THE SYSTEM and stored (the-problem-price-is-filled-by-the-system).
		var allQty int64
		for i := range rr.Items {
			allQty += rr.Items[i].Count
		}

		itemIDs := make([]int64, 0, len(rr.Items))
		received := make([]int64, 0, len(rr.Items))
		problems := make([]inventory_service_models.RestockProblemItem, 0, len(rr.Items))

		for i := range rr.Items {
			item := rr.Items[i]
			line := counted[item.ID]

			// What was IN THE BOX, broken included (any-warehouse-member-counts-what-arrived); the good units are this
			// less the broken row below.
			rr.Items[i].ReceivedCount = line.received
			itemIDs = append(itemIDs, int64(item.ID))
			received = append(received, line.received)

			// THE PROBLEM ROWS, written before stock moves: broken as typed, missing worked out, each with the warehouse's
			// optional note (a-broken-reason-is-optional) and the landed price — the same as a good unit's
			// (all-qty-is-every-unit-ordered). Keyed by restock and product, one row per kind.
			landed := inventory_mutations.LandedPrice(item.Total, item.Count, freight, allQty)

			problem := func(kind string, count int64, note string) inventory_service_models.RestockProblemItem {
				return inventory_service_models.RestockProblemItem{
					RestockID:         rr.ID,
					ProductID:         item.ProductID,
					SupplierChannelID: item.SupplierChannelID,
					ProblemType:       kind,
					Count:             count,
					PriceUnit:         landed,
					Total:             landed * float64(count),
					Note:              note,
				}
			}

			if line.broken > 0 {
				problems = append(problems, problem(restockProblemBroken, line.broken, line.brokenNote))
			}

			if missing := item.Count - line.received; missing > 0 {
				problems = append(problems, problem(restockProblemMissing, missing, line.missingNote))
			}

			// Where the good units went, for the answer — the ledger's rack rows below are the record.
			for _, p := range line.placements {
				rack := p.rack

				rr.Items[i].Placements = append(rr.Items[i].Placements, inventory_service_models.RestockReceivedPlacement{
					RestockItemID: item.ID,
					RackID:        &rack,
					Quantity:      p.quantity,
				})
			}
		}

		// Every line's box count in ONE statement, and every problem row in ONE insert
		// (ledger-writes-are-set-based).
		countErr := tx.Exec(`
			UPDATE restock_items AS i
			SET received_count = v.received_count, updated_at = NOW()
			FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS v(id, received_count)
			WHERE i.id = v.id`,
			int64Array(itemIDs), int64Array(received),
		).Error
		if countErr != nil {
			return countErr
		}

		if len(problems) > 0 {
			problemErr := tx.Create(&problems).Error
			if problemErr != nil {
				return problemErr
			}

			rr.Problems = append(rr.Problems, problems...)
		}

		// THE DECIDED LEDGERS, in the same transaction (the-decided-ledgers-come-before-the-restock-accept): one batch per
		// line with good units at the landed price over every unit ORDERED, its units on the racks named, one item per
		// product. They are the stock record — nothing else is written for the goods.
		ledgerLines := make([]inventory_mutations.RestockLine, 0, len(rr.Items))

		for i := range rr.Items {
			item := rr.Items[i]
			line := counted[item.ID]

			placements := make([]inventory_mutations.RestockPlacement, 0, len(line.placements))
			for _, p := range line.placements {
				placements = append(placements, inventory_mutations.RestockPlacement{PlacementID: p.rack, Count: p.quantity})
			}

			ledgerLines = append(ledgerLines, inventory_mutations.RestockLine{
				ProductID:         item.ProductID,
				Good:              line.received - line.broken,
				PriceUnit:         inventory_mutations.LandedPrice(item.Total, item.Count, freight, allQty),
				SupplierID:        derefID(item.SupplierID),
				SupplierChannelID: derefID(item.SupplierChannelID),
				Placements:        placements,
			})
		}

		ledgerTx, ledgerErr := inventory_mutations.PostRestock(tx, inventory_mutations.Restock{
			WarehouseID: rr.WarehouseID,
			TeamID:      rr.TeamID,
			ActorID:     actor,
			Lines:       ledgerLines,
		})
		if ledgerErr != nil {
			return ledgerErr
		}

		rr.TransactionID = ledgerTx.ID

		// Accepted from ongoing or from arrived (accept-locks-the-restock); the trail says which.
		from := rr.Status
		rr.Status = restockStatusAccepted

		acceptedAt := time.Now()

		rr.AcceptedByUserID = actor
		rr.AcceptedAt = &acceptedAt

		// The courier's charge: ONE per restock, on the restock, with its note (the-courier-is-paid-once-per-restock).
		rr.WarehouseAdditionalCost = courierCharge
		rr.WarehouseAdditionalCostNote = courierNote

		updates := map[string]any{
			"status":                         restockStatusAccepted,
			"accepted_by_user_id":            actor,
			"accepted_at":                    acceptedAt,
			"warehouse_additional_cost":      courierCharge,
			"warehouse_additional_cost_note": courierNote,
			"transaction_id":                 rr.TransactionID,
			"updated_at":                     acceptedAt,
		}

		// Counted straight from ongoing, the box arrived the moment it was counted: the same person signed for it
		// (the-restock-prototype-is-accepted — the accept screen stamps it so).
		if rr.ArrivedAt == nil {
			rr.ArrivedAt = &acceptedAt
			rr.ArrivedByUserID = actor
			updates["arrived_at"] = acceptedAt
			updates["arrived_by_user_id"] = actor
		}

		// The lines and problems are already written — without the Omit, GORM would upsert them all again from rr.
		statusErr := tx.Model(&rr).Omit(clause.Associations).Updates(updates).Error
		if statusErr != nil {
			return statusErr
		}

		logErr := recordRestockLog(tx, rr.ID, from, restockStatusAccepted, actor, acceptDescription(rr, courierCharge), acceptedAt)
		if logErr != nil {
			return logErr
		}

		// WHAT THE SELLING TEAM OWES THE WAREHOUSE for the charge is NOT written here: balance posts it from *Restock
		// Accepted*, which carries the charge (balance-posts-the-couriers-debt-from-the-event). The charge saved on the
		// restock above is the record a lost event can be posted again from.
		return nil
	})
	if err != nil {
		return nil, restockErr(err)
	}

	// AFTER the commit, never inside: downstream folds must not be able to fail the accept.
	s.publishAccepted(ctx, &rr)

	return connect.NewResponse(&inventoryv1.RestockRequestAcceptResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// acceptDescription is the accept's trail row in words: what broke, what was missing and what the courier asked at the
// door — "accepted — 1 broken, 2 missing; courier's charge Rp 5.000". The charge sits on the step that paid it, so the
// team that owes it sees it on its own timeline (#184) without a step of its own (every-status-change-is-logged).
func acceptDescription(rr inventory_service_models.Restock, courierCharge float64) string {
	var broken, missing int64

	for _, c := range problemCountsByProduct(rr.Problems) {
		broken += c.broken
		missing += c.missing
	}

	parts := []string{fmt.Sprintf("%d broken, %d missing", broken, missing)}
	if courierCharge > 0 {
		parts = append(parts, "courier's charge "+rupiahText(courierCharge))
	}

	return restockLogAccepted + " — " + strings.Join(parts, "; ")
}

// rupiahText is an amount as a person reads it, to the rupiah: "Rp 5.000". Rounded for the words only — the amount
// itself is stored as it was typed.
func rupiahText(v float64) string {
	digits := strconv.FormatInt(int64(math.Round(v)), 10)

	var b strings.Builder

	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}

		b.WriteRune(c)
	}

	return "Rp " + b.String()
}

// derefID reads an optional id: 0 when the line names none.
func derefID(id *uint64) uint64 {
	if id == nil {
		return 0
	}

	return *id
}
