package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentCostSet is *Ubah Ongkir* — the owning SELLING team replacing the account that pays its courier and the
// cost, when the TEAM pays (*Kami bayar*), until the handover: while REQUESTED or PICKED
// (the-courier-is-paid-by-the-team-or-by-the-warehouse: *its cost editable until the handover*). A courier the warehouse
// pays is refused — the warehouse types that cost at the handover. Another team's parcel reads NotFound.
//
// A CHANGED account must be one of the team's ACTIVE accounts, operational or not, as a transfer's shipping
// (a-transfers-shipping-is-paid-from-any-active-account) — asked BEFORE the transaction, judged under the parcel's lock
// once it is known to have changed; an unchanged one is not asked again (an account archived since must not freeze the
// cost). An edit that moved money bumps the cost revision, writes a trail row whose from equals its to ("Rp 15.000 →
// Rp 20.000" — the team's own words, never sent to the warehouse) and, after commit, CustomShipmentCostUpdated carrying
// both sides. An edit that changes neither writes nothing and publishes nothing.
func (s *Service) CustomShipmentCostSet(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentCostSetRequest],
) (*connect.Response[inventoryv1.CustomShipmentCostSetResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)
	account := msg.GetFinanceAccountId()
	cost := msg.GetShippingCost()

	// The contract requires the account; a handler called directly gets no interceptor.
	if account == 0 {
		return nil, customShipmentMoveErr(errCustomShipmentAccountNeeded)
	}

	// Asked before the transaction: a call to another service never holds a lock.
	answer := s.askPayingAccount(ctx, msg.GetTeamId(), account)

	var (
		cs         *models.CustomShipment
		oldAccount uint64
		oldCost    float64
		moved      bool
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		cs, lockErr = lockCustomShipment(tx, msg.GetId(), msg.GetTeamId(), customShipmentOwner)
		if lockErr != nil {
			return lockErr
		}

		if cs.Payer != models.CustomShipmentPayerTeam {
			return errCustomShipmentTeamPaysNot
		}

		statusErr := requireCustomShipmentStatus(cs, "edited", models.CustomShipmentRequested, models.CustomShipmentPicked)
		if statusErr != nil {
			return statusErr
		}

		if account != cs.FinanceAccountID {
			accountErr := answer.checkActive()
			if accountErr != nil {
				return accountErr
			}
		}

		oldAccount, oldCost = cs.FinanceAccountID, cs.ShippingCost
		moved = oldAccount != account || !san_money.Equal(oldCost, cost)

		if !moved {
			return nil
		}

		now := inventory_ledgers.TxNow(tx)
		cs.CostRevision++

		updateErr := tx.
			Model(cs).
			Updates(map[string]any{
				"finance_account_id": account,
				"shipping_cost":      cost,
				"cost_revision":      cs.CostRevision,
				"updated_at":         now,
			}).
			Error
		if updateErr != nil {
			return updateErr
		}

		cs.FinanceAccountID, cs.ShippingCost, cs.UpdatedAt = account, cost, now

		return appendCustomShipmentLog(tx, cs.ID, cs.Status, cs.Status, actor, override,
			customShipmentCostText(oldCost, cost))
	})
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	if moved {
		s.publishCustomShipmentEvent(ctx, customShipmentCostUpdatedEvent(cs, oldAccount, oldCost, actor, override))
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, msg.GetTeamId())
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentCostSetResponse{CustomShipment: wire}), nil
}
