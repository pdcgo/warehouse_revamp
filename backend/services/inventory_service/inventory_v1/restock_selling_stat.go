package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockSellingStat is the selling restock list's statistics (the-restock-statistics-count-transactions-under-the-tabs):
// the cards under its status tabs and Rincian's value per paying account, over the restocks the list's filter means.
//
//	which restocks  THE LIST'S ONE PREDICATE (restockListScope) with the status cleared on a COPY of the filter — the
//	                census answers every status at once and the tab picks the pile — narrowed to the restocks this team
//	                RAISED (`team_id`), never the list's other side: a warehouse sees no restock money
//	                (the-warehouse-sees-the-cod-it-paid), and the request carries no warehouse role.
//	per pile        how many restocks; the pieces ORDERED on their lines, on every status
//	                (jumlah-barang-counts-the-pieces-ordered); the different products; the goods (Σ subtotal); the
//	                freight; the courier's charge at the door, outside the value (the-couriers-charge-stays-out-of-total);
//	                and the value, Σ total = goods + shipping.
//	the total       every status at once. Its different products are counted over every status's lines together (a
//	                grouping set), never the largest pile's.
//	per account     each status × paying account (a-restock-names-its-paying-account): how many, and their value. Account
//	                0 — a restock raised before naming one was required — is a row of its own, so the rows add up.
//
// ONE statement, no LIMIT: the scoped restocks are read once (a CTE), then grouped by status and account, and their
// lines grouped by status with the total's set beside them — one snapshot, so the counts and the pieces describe the
// same restocks, and the list's predicate (a free-text search included) is paid once.
func (s *Service) RestockSellingStat(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockSellingStatRequest],
) (*connect.Response[inventoryv1.RestockSellingStatResponse], error) {
	teamID := req.Msg.GetTeamId()

	// A census across the tabs ignores the status — on a COPY, never the caller's message and never a second predicate
	// (restock_list_scope.go).
	filter := &inventoryv1.RestockRequestListFilter{}
	if req.Msg.GetFilter() != nil {
		filter = proto.Clone(req.Msg.GetFilter()).(*inventoryv1.RestockRequestListFilter)
	}

	filter.Status = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED

	// The list's set, the raising side only. A selling team is never a restock's warehouse, so for one this narrows
	// nothing the list shows; for any other team it keeps the warehouse side's restocks — and their money — out.
	scoped := restockListScope(s.db.WithContext(ctx), teamID, filter).
		Where("restocks.team_id = ?", teamID).
		Select(`restocks.id, restocks.status, restocks.finance_account_id, restocks.subtotal, restocks.shipment_cost,
			restocks.warehouse_additional_cost, restocks.total`)

	var rows []restockSellingRow

	err := s.db.
		WithContext(ctx).
		Raw(restockSellingStatSQL, scoped).
		Scan(&rows).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(restockSellingStatOf(rows)), nil
}

// restockSellingStatSQL reads the scoped restocks (the CTE, bound to the list's predicate) twice: a row per status ×
// paying account with its money, and — `line` — a row per status with its lines' pieces and different products, plus the
// grouping set's `()` row over every status at once (`is_total`), which is the total's. The pieces are the ORDERED
// `count`, never what was received (jumlah-barang-counts-the-pieces-ordered).
const restockSellingStatSQL = `
WITH r AS MATERIALIZED (?)
SELECT false AS line,
       r.status,
       r.finance_account_id,
       COUNT(*) AS restocks,
       COALESCE(SUM(r.subtotal), 0) AS goods,
       COALESCE(SUM(r.shipment_cost), 0) AS shipping,
       COALESCE(SUM(r.warehouse_additional_cost), 0) AS charge,
       COALESCE(SUM(r.total), 0) AS value,
       false AS is_total,
       0::bigint AS units,
       0::bigint AS products
FROM r
GROUP BY r.status, r.finance_account_id
UNION ALL
SELECT true,
       COALESCE(r.status, ''),
       0,
       0,
       0,
       0,
       0,
       0,
       GROUPING(r.status) = 1,
       COALESCE(SUM(i.count), 0)::bigint,
       COUNT(DISTINCT i.product_id)
FROM restock_items AS i
JOIN r ON r.id = i.restock_id
GROUP BY GROUPING SETS ((r.status), ())`

// restockSellingRow is one row of restockSellingStatSQL: a status × paying account of the scoped restocks, or (Line) a
// status's lines — every status's when IsTotal.
type restockSellingRow struct {
	Line             bool
	Status           string
	FinanceAccountID uint64
	Restocks         int64
	Goods            float64
	Shipping         float64
	Charge           float64
	Value            float64
	IsTotal          bool
	Units            int64
	Products         int64
}

// restockSellingStatOf folds the statement's rows into the answer: a pile per status in the order the rows came, the
// total over them, and a row per status × account. A status's pieces and products land on its pile; the grouping set's
// total row on the total.
func restockSellingStatOf(rows []restockSellingRow) *inventoryv1.RestockSellingStatResponse {
	total := &inventoryv1.RestockSellingPile{}
	byStatus := map[string]*inventoryv1.RestockSellingPile{}
	order := make([]string, 0, 5)
	accounts := make([]*inventoryv1.RestockSellingAccount, 0, len(rows))

	for _, row := range rows {
		if row.Line {
			continue
		}

		pile, ok := byStatus[row.Status]
		if !ok {
			pile = &inventoryv1.RestockSellingPile{Status: restockStatusFromText(row.Status)}
			byStatus[row.Status] = pile
			order = append(order, row.Status)
		}

		for _, p := range []*inventoryv1.RestockSellingPile{pile, total} {
			p.RestockCount += row.Restocks
			p.GoodsValue += row.Goods
			p.ShipmentCost += row.Shipping
			p.CourierCharge += row.Charge
			p.Value += row.Value
		}

		accounts = append(accounts, &inventoryv1.RestockSellingAccount{
			Status:           restockStatusFromText(row.Status),
			FinanceAccountId: row.FinanceAccountID,
			RestockCount:     row.Restocks,
			Value:            row.Value,
		})
	}

	for _, row := range rows {
		if !row.Line {
			continue
		}

		pile := total
		if !row.IsTotal {
			pile = byStatus[row.Status]
		}

		// One statement read both halves, so every status with lines has its pile; the check only keeps a nil away.
		if pile == nil {
			continue
		}

		pile.UnitCount = row.Units
		pile.ProductCount = row.Products
	}

	out := make([]*inventoryv1.RestockSellingPile, 0, len(order))
	for _, status := range order {
		out = append(out, byStatus[status])
	}

	return &inventoryv1.RestockSellingStatResponse{
		Total:     total,
		ByStatus:  out,
		ByAccount: accounts,
	}
}
