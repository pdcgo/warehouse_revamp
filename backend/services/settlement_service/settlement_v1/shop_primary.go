package settlement_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
)

// ShopPrimary is settlement's one question to the shop, ShopAccessCheck read two ways:
//
//   - WHETHER THE SHOP IS THE TEAM'S (settlement-and-expense-ask-the-shop-first): every shop-addressed row asks it
//     before it is written, so no team opens — or writes on — another team's shop account. Another team's shop, or one
//     that does not exist, answers NotFound (every-shop-call-is-scoped-to-its-team); a CLOSED shop is answered, and its
//     money rows still post (a-closed-shop-refuses-only-new-selling).
//   - WHO AN IMPORTED SHOP ROW COUNTS FOR — the shop's primary CS (#settlement-asks-the-shop-for-its-primary-cs).
//
// An interface settlement owns, so settlement_service never imports the shop's service. The composition
// root answers it with a Connect client to ShopAccessCheck, under the caller's own token — which is also
// what keeps it out of a Go import cycle, since the shop's service calls settlement on every placed
// order. Where the shop lives (the-shop-gets-its-own-service) changes that adapter, never this.
type ShopPrimary interface {
	// PrimaryUser returns the shop's primary CS — 0 when it has none — and NotFound when the shop is not one of the
	// team's. askingUserID is whose token the question rides on: the row's actor.
	PrimaryUser(ctx context.Context, teamID, shopID, askingUserID uint64) (uint64, error)
}

// noShopPrimary is a settlement with no shop to ask. A shop-addressed row is then REFUSED — never written on a shop
// nobody vouched for, and never counted for the wrong person, which is the direction both decisions take when the
// shop cannot answer.
type noShopPrimary struct{}

func (noShopPrimary) PrimaryUser(context.Context, uint64, uint64, uint64) (uint64, error) {
	return 0, errors.New("no shop service is wired to answer for the shop")
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

// askShop asks the shop about a SHOP-ADDRESSED row before it is written (settlement-and-expense-ask-the-shop-first):
// is the shop the team's, and — for an imported row only — who the row counts for. A row posted by hand counts for its
// actor (#a-shop-addressed-row-is-attributed-to-its-actor), so its user is 0 and a shop with no primary CS does not
// refuse it.
//
// ⚠ CALLED BEFORE THE LEDGER'S TRANSACTION, never inside it: the shop's account row is taken FOR UPDATE
// there, and a network call under that lock would make every post on the shop wait on the shop service.
//
// ⚠ A FAILED ASK REFUSES A NEW ROW — never a quiet fallback: not the team's shop is NotFound, nothing written; no
// answer is Unavailable; no primary on an imported row is FailedPrecondition (never counted for the actor, which
// would count the row for the wrong person for good). The importer holds the line with the reason. The caller HOLDS
// the error until the transaction's idempotency check, so a retry of a row already written is answered from the
// ledger whatever the shop says now.
func (s *Service) askShop(ctx context.Context, in PostInput, sourceText string) (uint64, error) {
	primary, err := s.shops.PrimaryUser(ctx, in.TeamID, in.ShopID, in.ActorID)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeNotFound {
			return 0, errShopNotTheTeams(in.ShopID)
		}

		return 0, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("asking the shop whether it is the team's: %w", err))
	}

	// Only an imported shop row counts for the shop's primary CS.
	if sourceText != sourceImporter {
		return 0, nil
	}

	if primary == 0 {
		return 0, errNoPrimaryCS
	}

	return primary, nil
}

// errShopNotTheTeams is the shop's NotFound in settlement's words: another team's shop reads exactly as one that never
// existed, so the answer confirms no id (every-shop-call-is-scoped-to-its-team).
func errShopNotTheTeams(shopID uint64) error {
	return connect.NewError(connect.CodeNotFound, fmt.Errorf("shop #%d is not one of this team's shops", shopID))
}

// isShopNotTheTeams is whether a held ask said the shop is not the team's.
func isShopNotTheTeams(err error) bool {
	return err != nil && connect.CodeOf(err) == connect.CodeNotFound
}
