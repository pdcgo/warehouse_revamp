package main

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
)

// THE SEED'S DAILY GROUND (backlog #126, P4) — what the main lists and the other daily screens need to draw real rows,
// made after audit_frontend_seed.go's ground and THROUGH THE SAME API (HARD RULE 3b: the real handlers, the real push):
//
//	orders      25 on shop 1 from the warehouse's ready stock — the orders list and an order's page, the warehouse's
//	            order queue and one order's pick page, settlement (an account opens per order), the analytic order
//	            metrics, the warehouse's daily statement and fee entries on the warehouse–seller ledger
//	drafts      25 — the drafts list, two pages
//	expenses    a capital deposit and 24 running costs on the first account — the expenses list, the account's ledger
//	found       3 found reports on rack C — the found-stock list
//	opname      one count of rack J, LAST: an open count locks its rack's stock, so nothing seeded after it moves
//	            there, and no order takes product 54 (rack J's only line)
//	batch       the newest batch's id, read back (BatchList) — a batch's page
//
// Its events settle before the template's API stops: the ledger's entries (the courier charges and each order's
// warehouse fee), one settlement account per order and the first account's log; the order metrics' fold, which no
// list reads back, is given auditFoldQuiet after the others. It never touches a product, rack or restock the ten P1
// screens read (rack A, product 1, product 60, the open restocks), so their counts stand on the same ground.
//
// This file is one of the template's inputs (auditTemplateInputs): changing it rebuilds the template.

// The daily ground's sizes.
const (
	auditOrders      = 25
	auditDrafts      = 25
	auditExpenses    = 24 // running costs, after one capital deposit
	auditFound       = 3
	auditOrderTotal  = 150000
	auditExpenseCost = 50000
	auditDeposit     = 10000000
	auditFoldQuiet   = 3 * time.Second
)

// auditOrderProducts are the products (0-based) the seeded orders take one unit of, in turn: 46–58, which sit on racks
// B–J, ten units each — never product 54 (rack J, the counted rack), product 60 (the order form's pick) or rack A's.
func auditOrderProducts() []int {
	var out []int

	for p := auditRackALines; p < auditProducts-2; p++ {
		if p == 53 {
			continue
		}

		out = append(out, p)
	}

	return out
}

// auditDailyIDs is what the daily ground made, beside auditSeedIDs.
type auditDailyIDs struct {
	Orders        []uint64 `json:"orders"`
	Drafts        int      `json:"drafts"`
	Expenses      int      `json:"expenses"`
	Found         []uint64 `json:"found"`
	OpnameSession uint64   `json:"opname_session"`
	Batch         uint64   `json:"batch"`
}

// auditDailyClients are the clients the daily ground calls, as root.
type auditDailyClients struct {
	order      sellingv1connect.OrderServiceClient
	draft      sellingv1connect.OrderDraftServiceClient
	expense    expensev1connect.ExpenseServiceClient
	found      inventoryv1connect.FoundRequestServiceClient
	opname     inventoryv1connect.OpnameServiceClient
	inventory  inventoryv1connect.InventoryServiceClient
	settlement settlementv1connect.SettlementServiceClient
}

func (s *auditSeeder) daily() auditDailyClients {
	h := s.httpClient
	opts := s.opts

	return auditDailyClients{
		order:      sellingv1connect.NewOrderServiceClient(h, s.api, opts),
		draft:      sellingv1connect.NewOrderDraftServiceClient(h, s.api, opts),
		expense:    expensev1connect.NewExpenseServiceClient(h, s.api, opts),
		found:      inventoryv1connect.NewFoundRequestServiceClient(h, s.api, opts),
		opname:     inventoryv1connect.NewOpnameServiceClient(h, s.api, opts),
		inventory:  inventoryv1connect.NewInventoryServiceClient(h, s.api, opts),
		settlement: settlementv1connect.NewSettlementServiceClient(h, s.api, opts),
	}
}

// seedDaily makes the daily ground, then waits for its events.
func (s *auditSeeder) seedDaily(ctx context.Context, ids *auditSeedIDs) error {
	c := s.daily()
	d := &auditDailyIDs{}
	ids.Daily = d

	logBefore, err := s.accountLogCount(ctx, ids)
	if err != nil {
		return err
	}

	err = s.orders(ctx, c, ids, d)
	if err != nil {
		return err
	}

	err = s.drafts(ctx, c, ids, d)
	if err != nil {
		return err
	}

	err = s.expenses(ctx, c, ids, d)
	if err != nil {
		return err
	}

	err = s.foundAndCount(ctx, c, ids, d)
	if err != nil {
		return err
	}

	batches, err := c.inventory.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: ids.WarehouseTeam, Page: &commonv1.CommonPagination{Page: 1, Limit: 1},
	}))
	if err != nil {
		return fmt.Errorf("BatchList: %w", err)
	}

	s.calls++

	if len(batches.Msg.GetIds()) == 0 {
		return fmt.Errorf("BatchList: the accepted restocks made no batch")
	}

	d.Batch = batches.Msg.GetIds()[0]

	err = s.waitFor(ctx, "the settlement accounts the orders open", len(d.Orders), func() (int, error) {
		return s.settlementCount(ctx, c, ids)
	})
	if err != nil {
		return err
	}

	err = s.waitFor(ctx, "the first account's log (the deposit and the costs)", logBefore+1+auditExpenses,
		func() (int, error) {
			return s.accountLogCount(ctx, ids)
		})
	if err != nil {
		return err
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(auditFoldQuiet):
	}

	return nil
}

// orders places auditOrders orders on shop 1, one unit each of auditOrderProducts in turn, each an hour older than the
// next — through OrderCreate, which takes the stock in the same call.
func (s *auditSeeder) orders(ctx context.Context, c auditDailyClients, ids *auditSeedIDs, d *auditDailyIDs) error {
	products := auditOrderProducts()
	now := time.Now()

	for i := 1; i <= auditOrders; i++ {
		p := products[(i-1)%len(products)]

		res, err := c.order.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
			TeamId:                ids.SellingTeam,
			ShopId:                ids.Shops[0],
			WarehouseId:           ids.WarehouseTeam,
			CustomerName:          fmt.Sprintf("Audit Pembeli %02d", i),
			PlatformTotal:         auditOrderTotal,
			OrderExternalRefId:    fmt.Sprintf("AUDIT-SEED-%02d", i),
			ReceiptCode:           fmt.Sprintf("AUDSEEDRESI%02d", i),
			PlatformCreatedAtUnix: now.Add(-time.Duration(auditOrders-i+1) * time.Hour).Unix(),
			IdempotencyKey:        fmt.Sprintf("audit-seed-order-%02d", i),
			ShipmentChannelId:     ids.Courier,
			Items: []*sellingv1.OrderItem{{
				ProductId: ids.Products[p], ProductCode: ids.ProductCodes[p], Name: fmt.Sprintf("Audit Produk %02d", p+1),
				Quantity: 1,
			}},
		}))
		if err != nil {
			return fmt.Errorf("OrderCreate %d: %w", i, err)
		}

		s.calls++
		d.Orders = append(d.Orders, res.Msg.GetOrder().GetId())
	}

	return nil
}

// drafts pushes auditDrafts order drafts, as a storefront scrape would (OrderDraftPush): each names shop 1, the
// warehouse, the courier and one line by the product's code.
func (s *auditSeeder) drafts(ctx context.Context, c auditDailyClients, ids *auditSeedIDs, d *auditDailyIDs) error {
	products := auditOrderProducts()

	for i := 1; i <= auditDrafts; i++ {
		p := products[(i-1)%len(products)]

		_, err := c.draft.OrderDraftPush(ctx, connect.NewRequest(&sellingv1.OrderDraftPushRequest{
			TeamId:            ids.SellingTeam,
			Source:            "audit",
			ExternalId:        fmt.Sprintf("AUDIT-DRAFT-%02d", i),
			ShopId:            ids.Shops[0],
			WarehouseId:       ids.WarehouseTeam,
			CustomerName:      fmt.Sprintf("Audit Draf %02d", i),
			PlatformTotal:     auditOrderTotal,
			ShipmentChannelId: ids.Courier,
			Items: []*sellingv1.OrderDraftItem{{
				ExternalSku: ids.ProductCodes[p], ExternalName: fmt.Sprintf("Audit Produk %02d", p+1), Quantity: 1,
				UnitPrice: auditOrderTotal,
			}},
		}))
		if err != nil {
			return fmt.Errorf("OrderDraftPush %d: %w", i, err)
		}

		s.calls++
		d.Drafts++
	}

	return nil
}

// expenses records a capital deposit into the first account, then auditExpenses running costs paid from it over the
// last ten days (electricity and internet in turn).
func (s *auditSeeder) expenses(ctx context.Context, c auditDailyClients, ids *auditSeedIDs, d *auditDailyIDs) error {
	today := time.Now().In(jakartaLocation())

	create := func(t expensev1.ExpenseType, amount float64, day time.Time, note string) error {
		_, err := c.expense.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: ids.SellingTeam, Type: t, Amount: amount, OccurredAt: day.Format("2006-01-02"),
			FinanceAccountId: ids.Accounts[0], Note: note,
		}))
		if err != nil {
			return fmt.Errorf("ExpenseCreate (%s): %w", note, err)
		}

		s.calls++
		d.Expenses++

		return nil
	}

	err := create(expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT, auditDeposit, today.AddDate(0, 0, -10), "audit setoran modal")
	if err != nil {
		return err
	}

	for i := 0; i < auditExpenses; i++ {
		t := expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY
		if i%2 == 1 {
			t = expensev1.ExpenseType_EXPENSE_TYPE_INTERNET
		}

		err = create(t, auditExpenseCost, today.AddDate(0, 0, -(i%10)), fmt.Sprintf("audit biaya %02d", i+1))
		if err != nil {
			return err
		}
	}

	return nil
}

// foundAndCount reports auditFound units found on rack C (product 47, which sits there), then opens one count of rack J
// — last, since an open count locks its rack's stock.
func (s *auditSeeder) foundAndCount(ctx context.Context, c auditDailyClients, ids *auditSeedIDs, d *auditDailyIDs) error {
	p := auditRackALines + 1 // product 47 — on rack C (racksAndRestocks)

	for i := 1; i <= auditFound; i++ {
		res, err := c.found.FoundRequestCreate(ctx, connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
			TeamId: ids.WarehouseTeam, ProductId: ids.Products[p], RackId: ids.Racks["C"], Quantity: 1,
			Note: fmt.Sprintf("audit temuan %d", i),
		}))
		if err != nil {
			return fmt.Errorf("FoundRequestCreate %d: %w", i, err)
		}

		s.calls++
		d.Found = append(d.Found, res.Msg.GetFoundRequest().GetId())
	}

	res, err := c.opname.OpnameSessionCreate(ctx, connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
		TeamId: ids.WarehouseTeam, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, FilterPlacementId: ids.Racks["J"],
	}))
	if err != nil {
		return fmt.Errorf("OpnameSessionCreate (rack J): %w", err)
	}

	s.calls++
	d.OpnameSession = res.Msg.GetSession().GetId()

	return nil
}

// settlementCount is how many settlement accounts the selling team holds (one opens per placed order).
func (s *auditSeeder) settlementCount(ctx context.Context, c auditDailyClients, ids *auditSeedIDs) (int, error) {
	res, err := c.settlement.OrderSettlementList(ctx, connect.NewRequest(&settlementv1.OrderSettlementListRequest{
		TeamId: ids.SellingTeam, Filter: &settlementv1.OrderSettlementListFilter{},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 1},
	}))
	if err != nil {
		return 0, err
	}

	return int(res.Msg.GetPageInfo().GetTotalItems()), nil
}

// accountLogCount is how many rows the first account's log holds.
func (s *auditSeeder) accountLogCount(ctx context.Context, ids *auditSeedIDs) (int, error) {
	res, err := s.account.FinancialAccountLogList(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountLogListRequest{
		TeamId: ids.SellingTeam, Filter: &financial_accountv1.FinancialAccountLogListFilter{AccountId: ids.Accounts[0]},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 1},
	}))
	if err != nil {
		return 0, fmt.Errorf("FinancialAccountLogList: %w", err)
	}

	return int(res.Msg.GetPageInfo().GetTotalItems()), nil
}

// waitFor polls count until it reaches want, or auditEventSettleCap.
func (s *auditSeeder) waitFor(ctx context.Context, what string, want int, count func() (int, error)) error {
	deadline := time.Now().Add(auditEventSettleCap)
	got := 0

	for {
		n, err := count()
		if err == nil {
			got = n
			if got >= want {
				return nil
			}
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("%s did not settle: %d of %d after %s — is the Pub/Sub emulator pushing to the audit API "+
				"(project %s)?", what, got, want, auditEventSettleCap, auditProject)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
