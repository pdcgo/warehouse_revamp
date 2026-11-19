package expense_v1

import (
	"context"
	"errors"
	"fmt"
)

// Shops answers, for an expense being recorded, whether the shop it names is one of the team's
// (settlement-and-expense-ask-the-shop-first). The shop owns its rows; expense_service never reads its tables. The
// composition root adapts this to ShopAccessCheck, under the caller's own token.
//
// `found` is false for another team's shop AND for one that does not exist — the two must read the same, or the answer
// confirms an id (every-shop-call-is-scoped-to-its-team). A CLOSED shop is found: an expense still runs on it
// (a-closed-shop-refuses-only-new-selling). Who in the team may spend is not asked — the request's policy decided it.
type Shops interface {
	ShopOfTeam(ctx context.Context, teamID, shopID uint64) (found bool, err error)
}

// noShops answers "not found" to every shop: with no shop service wired, no shop is trusted. An expense naming none
// never asks.
type noShops struct{}

func (noShops) ShopOfTeam(context.Context, uint64, uint64) (bool, error) {
	return false, nil
}

// errShopNotTheTeams is a shop that is not one of the team's — NotFound (costErr), naming only the id it was given.
var errShopNotTheTeams = errors.New("is not one of this team's shops")

// checkShop refuses a shop that is not one of the team's — NotFound, nothing stored. Asked BEFORE any transaction, like
// the account: a call to another service never holds a pooled connection or a lock across its round-trip. A shop of 0
// is no shop, and asks nothing.
func (s *Service) checkShop(ctx context.Context, teamID, shopID uint64) error {
	if shopID == 0 {
		return nil
	}

	found, err := s.shops.ShopOfTeam(ctx, teamID, shopID)
	if err != nil {
		return fmt.Errorf("ask the shop: %w", err)
	}

	if !found {
		return fmt.Errorf("shop #%d %w", shopID, errShopNotTheTeams)
	}

	return nil
}
