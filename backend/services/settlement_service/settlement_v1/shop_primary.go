package settlement_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
)

// ShopPrimary answers who an IMPORTED SHOP ROW counts for — the shop's primary CS
// (#settlement-asks-the-shop-for-its-primary-cs).
//
// An interface settlement owns, so settlement_service never imports the shop's service. The composition
// root answers it with a Connect client to ShopAccessCheck, under the caller's own token — which is also
// what keeps it out of a Go import cycle, since the shop's service calls settlement on every placed
// order. Where the shop lives (the-shop-gets-its-own-service) changes that adapter, never this.
type ShopPrimary interface {
	// PrimaryUser returns the shop's primary CS — 0 when it has none. askingUserID is whose token the
	// question rides on: the row's actor.
	PrimaryUser(ctx context.Context, teamID, shopID, askingUserID uint64) (uint64, error)
}

// noShopPrimary is a settlement with no shop to ask. An imported shop row is then REFUSED — never
// counted for the wrong person, which is the direction the decision takes when the shop cannot answer.
type noShopPrimary struct{}

func (noShopPrimary) PrimaryUser(context.Context, uint64, uint64, uint64) (uint64, error) {
	return 0, errors.New("no shop service is wired to answer the shop's primary CS")
}

var (
	// A shop with no primary CS: its imported rows would count for nobody
	// (#a-shop-with-no-primary-cs-cannot-import). The importer refuses such a shop before it stores the
	// file; this catches a primary removed mid-import — the line is held, and the same file again posts it.
	errNoPrimaryCS = connect.NewError(
		connect.CodeFailedPrecondition,
		errors.New("the shop has no primary CS — choose one before importing its statements"),
	)

	// withdrawal names no order (#withdrawal-is-a-settlement-type) — the wallet paying the bank is the
	// shop's movement, and filing it against one order would move that order's balance for it.
	errWithdrawalIsShopWide = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("withdrawal is shop-addressed and must not name an order"),
	)
)

// importedShopRowUser asks the shop for the person an imported shop row counts for.
//
// ⚠ CALLED BEFORE THE LEDGER'S TRANSACTION, never inside it: the shop's account row is taken FOR UPDATE
// there, and a network call under that lock would make every post on the shop wait on the shop service.
//
// ⚠ A FAILED ASK REFUSES THE POST — never a quiet fallback to the actor, which would count the row for
// the wrong person for good (the user carry is kept). The importer holds the line with the reason.
func (s *Service) importedShopRowUser(ctx context.Context, in PostInput) (uint64, error) {
	primary, err := s.shops.PrimaryUser(ctx, in.TeamID, in.ShopID, in.ActorID)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeNotFound {
			return 0, connect.NewError(connect.CodeNotFound,
				fmt.Errorf("shop %d is not a live shop of team %d", in.ShopID, in.TeamID))
		}

		return 0, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("asking the shop for its primary CS: %w", err))
	}

	if primary == 0 {
		return 0, errNoPrimaryCS
	}

	return primary, nil
}
