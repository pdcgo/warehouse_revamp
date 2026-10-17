package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestCreate records a selling team's restock (status ONGOING) with its priced lines. It does NOT touch stock
// — the warehouse does that when it accepts.
//
// Each line may name a supplier, which must be a LIVE one — any selling team's, since team B restocks from team A's
// supplier on its own restock (a-team-restocks-from-another-teams-supplier). It is asked of supplier_service, which
// owns suppliers (the-supplier-gets-its-own-service); a deleted or unknown one is NotFound. A product appears once
// (a-product-appears-once-per-restock).
func (s *Service) RestockRequestCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestCreateRequest],
) (*connect.Response[inventoryv1.RestockRequestCreateResponse], error) {
	teamID := req.Msg.GetTeamId()

	err := productsOnce(req.Msg.GetItems())
	if err != nil {
		return nil, restockErr(err)
	}

	// Asked BEFORE the transaction, never inside one: a call to another service would hold a pooled connection — and
	// any lock already taken — for a network round-trip (audits/services/inventory_service/concurrency/lock-order.md).
	// A supplier deleted between this answer and the commit leaves the same state as "restock first, then delete",
	// which is kept on purpose.
	err = s.liveLineSuppliers(ctx, teamID, req.Msg.GetItems())
	if err != nil {
		return nil, restockErr(err)
	}

	stores := s.askLineStores(ctx, teamID, req.Msg.GetItems())

	for _, item := range req.Msg.GetItems() {
		err = stores.check(item)
		if err != nil {
			return nil, restockErr(err)
		}
	}

	rr := inventory_service_models.RestockRequest{
		RequestingTeamID: teamID,
		WarehouseID:      req.Msg.GetWarehouseId(),
		Status:           restockStatusOngoing,
		OrderRef:         req.Msg.GetInvoiceRefId(),
		Receipt:          req.Msg.GetReceipt(),
		ReceiptFile:      req.Msg.GetReceiptFile(),
		ShipmentID:       req.Msg.GetShipmentId(),
		FinanceAccountID: req.Msg.GetFinanceAccountId(),
		ShippingCost:     req.Msg.GetShipmentCost(),
		Note:             req.Msg.GetNote(),
		Items:            restockItemModels(req.Msg.GetItems()),
		// WHO RAISED IT, from the caller's identity rather than the request body — a client that could nominate its
		// own author could file somebody else's name against a delivery.
		CreatedByUserID: actorFrom(ctx),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// GORM inserts the restock and its lines in this transaction, stamping their RestockRequestID — a restock
		// without its lines is not a restock.
		createErr := tx.Create(&rr).Error
		if createErr != nil {
			return createErr
		}

		// THE FIRST ROW OF ITS TRAIL (every-status-change-is-logged). `rr.CreatedAt` rather than a fresh time.Now():
		// the log must carry the same instant the row does, or the trail and the created-date filter disagree about
		// which second the restock was raised.
		logErr := recordRestockLog(tx, rr.ID, "", restockStatusOngoing, rr.CreatedByUserID, restockLogCreated, rr.CreatedAt)
		if logErr != nil {
			return logErr
		}

		// Asking a warehouse to stock a product is what makes that product VISIBLE to it (#142). In the same
		// transaction, because a restock whose products the warehouse cannot see is one nobody there can act on.
		return linkWarehouseProducts(tx, rr.WarehouseID, rr.Items)
	})
	if err != nil {
		return nil, restockErr(err)
	}

	// AFTER the commit: the paying account hears the money left it (a-created-restock-tells-the-financial-account).
	s.publishRestockMoney(ctx, restockCreatedEvent(&rr))

	return connect.NewResponse(&inventoryv1.RestockRequestCreateResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// productsOnce refuses a restock that lists a product twice (a-product-appears-once-per-restock). The database refuses
// it too (00024's unique index); this says so as InvalidArgument instead of an internal constraint error.
func productsOnce(items []*inventoryv1.RestockRequestItem) error {
	seen := make(map[uint64]struct{}, len(items))

	for _, item := range items {
		if _, dup := seen[item.GetProductId()]; dup {
			return errRestockProductTwice
		}

		seen[item.GetProductId()] = struct{}{}
	}

	return nil
}

// liveLineSuppliers asks supplier_service once per distinct supplier the lines name, and refuses the first that is
// not live.
func (s *Service) liveLineSuppliers(ctx context.Context, teamID uint64, items []*inventoryv1.RestockRequestItem) error {
	asked := make(map[uint64]struct{}, len(items))

	for _, item := range items {
		id := item.GetSupplierId()
		if id == 0 {
			continue
		}

		if _, done := asked[id]; done {
			continue
		}

		asked[id] = struct{}{}

		live, err := s.suppliers.SupplierIsLive(ctx, teamID, id)
		if err != nil {
			return err
		}

		if !live {
			return errRestockSupplierMissing
		}
	}

	return nil
}
