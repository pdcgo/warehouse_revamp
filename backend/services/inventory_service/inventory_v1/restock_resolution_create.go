package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockResolutionCreate is the restock's SELLING team recording ONE resolution row on a problem restock (Diterima
// carrying *Barang kurang* / *Barang rusak*), a settled one (it stays settled) or a lost one (Hilang) —
// a-restock-problem-is-settled-by-resolution-rows, each 🔄 applied:
//
//   - REFUND: its amount (above 0) and the account it goes into — one of the team's ACTIVE accounts, asked of
//     financial_account before the transaction; after commit RestockRefunded posts it INTO that account as a `restock`
//     row, the way a cancelled restock's money comes back (restock-is-never-typed-by-hand).
//   - RETURN: links an EXISTING outbound reship of this restock that is not cancelled and not yet a row — a new reship is
//     made WITH its row by CustomShipmentCreate (`resolution`). Never on a Hilang restock.
//   - RESHIPPING: creates its INBOUND custom shipment in the same transaction (a-suppliers-reshipping-comes-in-as-a-
//     custom-shipment, 🔄 A): the lines as the seller typed them (the team's own products, each once, a price that moves
//     no money), the courier, the resi, the warehouse (the restock's unless another is named), the supplier — and the
//     link joining the restock, the row and the parcel.
//
// Under the restock row's lock (the lock its accept, cancel, settle and an inbound Terima take), so two resolutions of
// one restock queue and a settle is judged against what committed. The key is unique per restock: a double tap is
// refused as AlreadyExists, never recorded twice. Who: the caller's identity, never the body.
func (s *Service) RestockResolutionCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockResolutionCreateRequest],
) (*connect.Response[inventoryv1.RestockResolutionCreateResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()
	kind := resolutionTypeFromProto(msg.GetType())

	// The fields that belong to each type, and nothing of the others — checked before anything is asked or written.
	err := resolutionShape(msg, kind)
	if err != nil {
		return nil, resolutionErr(err)
	}

	// Asked before the transaction: a call to another service never runs under a lock.
	var facts map[uint64]ProductFact

	switch kind {
	case models.RestockResolutionRefund:
		err = s.askPayingAccount(ctx, teamID, msg.GetFinanceAccountId()).checkActive()
	case models.RestockResolutionReshipping:
		facts, err = s.reshippingFacts(ctx, teamID, msg.GetReshipping())
	}

	if err != nil {
		return nil, resolutionErr(err)
	}

	row := models.RestockResolution{
		RestockID:           msg.GetRestockId(),
		ResolutionType:      kind,
		Note:                msg.GetNote(),
		IdempotencyKey:      msg.GetIdempotencyKey(),
		CreatedByUserID:     actorFrom(ctx),
		CreatedByIsOverride: overrideFrom(ctx),
	}

	if kind == models.RestockResolutionRefund {
		row.RefundAmount = msg.GetRefundAmount()
		row.FinanceAccountID = msg.GetFinanceAccountId()
	}

	var (
		rr      *models.Restock
		parcel  *models.CustomShipment
		created bool
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		rr, lockErr = lockSellingRestock(tx, msg.GetRestockId(), teamID)
		if lockErr != nil {
			return lockErr
		}

		eligibleErr := restockTakesResolutions(tx, rr)
		if eligibleErr != nil {
			return eligibleErr
		}

		if kind == models.RestockResolutionReturn && rr.Status == restockStatusLost {
			return errResolutionReturnOnLost
		}

		insertErr := insertResolution(tx, &row)
		if insertErr != nil {
			return insertErr
		}

		// The Riwayat's row for it, in this transaction (restock_settlement_log.go).
		logErr := recordResolutionLog(tx, rr, &row)
		if logErr != nil {
			return logErr
		}

		switch kind {
		case models.RestockResolutionReturn:
			var linkErr error

			parcel, linkErr = linkReturnParcel(tx, rr, row.ID, msg.GetCustomShipmentId())

			return linkErr
		case models.RestockResolutionReshipping:
			var createErr error

			parcel, createErr = createReshippingParcel(tx, rr, &row, msg.GetReshipping(), facts)
			created = createErr == nil

			return createErr
		}

		return nil
	})
	if err != nil {
		return nil, resolutionErr(err)
	}

	// AFTER the commit: the refund reaches its account (financial_account's restock listener), and a parcel just created
	// is announced as every parcel is (a WAREHOUSE payer's, so its listener posts nothing at create).
	if kind == models.RestockResolutionRefund {
		s.publishRestockRefund(ctx, restockRefundedEvent(rr, &row))
	}

	if created {
		s.publishCustomShipmentEvent(ctx, customShipmentCreatedEvent(parcel, row.CreatedByIsOverride))
	}

	out := &inventoryv1.RestockResolutionCreateResponse{
		Resolution: resolutionToProto(&resolutionRow{RestockResolution: row}, true),
	}

	if parcel != nil {
		out.Resolution.CustomShipmentId = parcel.ID

		out.CustomShipment, err = customShipmentForWire(s.db.WithContext(ctx), parcel.ID, teamID)
		if err != nil {
			return nil, resolutionErr(err)
		}
	}

	return connect.NewResponse(out), nil
}

// resolutionShape is the cross-field rule protovalidate cannot say: each type carries its own fields and none of the
// others'.
func resolutionShape(msg *inventoryv1.RestockResolutionCreateRequest, kind models.RestockResolutionType) error {
	refund := msg.GetRefundAmount() != 0 || msg.GetFinanceAccountId() != 0
	ret := msg.GetCustomShipmentId() != 0
	reship := msg.GetReshipping() != nil

	switch kind {
	case models.RestockResolutionRefund:
		if !san_money.Positive(msg.GetRefundAmount()) || msg.GetFinanceAccountId() == 0 || ret || reship {
			return errResolutionShape
		}
	case models.RestockResolutionReturn:
		if !ret || refund || reship {
			return errResolutionShape
		}
	case models.RestockResolutionReshipping:
		if !reship || refund || ret {
			return errResolutionShape
		}
	default:
		// UNSPECIFIED is refused by validation; a handler called directly gets no interceptor.
		return errResolutionShape
	}

	return nil
}

// reshippingFacts asks product_service for the reshipping's lines — each the team's OWN product
// (a-restock-carries-only-the-teams-own-products), each once. Before the transaction.
func (s *Service) reshippingFacts(
	ctx context.Context,
	teamID uint64,
	parcel *inventoryv1.RestockReshippingParcel,
) (map[uint64]ProductFact, error) {
	ids := make([]uint64, 0, len(parcel.GetLines()))
	seen := map[uint64]bool{}

	for _, line := range parcel.GetLines() {
		if seen[line.GetProductId()] {
			return nil, errReshippingLineTwice
		}

		seen[line.GetProductId()] = true
		ids = append(ids, line.GetProductId())
	}

	facts, err := s.products.Facts(ctx, teamID, ids)
	if err != nil {
		return nil, fmt.Errorf("ask product facts: %w", err)
	}

	for _, id := range ids {
		fact, ok := facts[id]
		if !ok || fact.TeamID != teamID {
			return nil, fmt.Errorf("%w: product %d", errReshippingNotOwned, id)
		}
	}

	return facts, nil
}

// linkReturnParcel is a RETURN row's link to an EXISTING outbound reship: the team's, of THIS restock, not cancelled —
// locked after the restock (the lock order) — and not yet any row's (the link's unique parcel key).
func linkReturnParcel(tx *gorm.DB, rr *models.Restock, resolutionID, shipmentID uint64) (*models.CustomShipment, error) {
	var cs models.CustomShipment

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND team_id = ? AND restock_id = ? AND kind = ?", shipmentID, rr.TeamID, rr.ID,
			models.CustomShipmentReship).
		First(&cs).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errResolutionParcelMissing
		}

		return nil, err
	}

	if cs.Status == models.CustomShipmentCancelled {
		return nil, errResolutionParcelDead
	}

	err = linkResolutionParcel(tx, rr.ID, resolutionID, cs.ID)
	if err != nil {
		return nil, err
	}

	return &cs, nil
}

// resolutionErr maps a resolution's refusal to Connect — its own first, then the custom shipment's (a reshipping's
// parcel) and the restock's.
func resolutionErr(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errRestockMissing)
	case errors.Is(err, errResolutionKeyUsed):
		return connect.NewError(connect.CodeAlreadyExists, errResolutionKeyUsed)
	case errors.Is(err, errResolutionParcelMissing):
		return connect.NewError(connect.CodeNotFound, errResolutionParcelMissing)
	case errors.Is(err, errResolutionNotAProblem),
		errors.Is(err, errResolutionReturnOnLost),
		errors.Is(err, errResolutionParcelTaken),
		errors.Is(err, errResolutionParcelDead),
		errors.Is(err, errRestockAlreadySettled),
		errors.Is(err, errAccountNotActive):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errResolutionShape),
		errors.Is(err, errReshippingNotOwned),
		errors.Is(err, errReshippingLineTwice),
		errors.Is(err, errReshippingSupplier):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return customShipmentErr(err)
	}
}
