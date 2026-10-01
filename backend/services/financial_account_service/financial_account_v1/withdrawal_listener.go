package financial_account_v1

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// WithdrawalHandler is the listener that posts a shop's WITHDRAWALS — settlement's `withdrawal` rows on
// `SettlementLogPosted` — into the account the shop withdraws into (revenue-stays-in-settlement,
// a-shop-names-the-account-it-withdraws-into). Every other settlement type is ACKED and ignored: revenue
// stays in settlement, and settlement's ads never reach an account (settlement-ads-and-accounts-are-independent).
//
// It follows the handler contract (one-contract-for-both-handler-types): one event, its own transaction, the
// event id CLAIMED inside it beside the write — so a redelivery posts nothing, and a failure rolls the claim
// back with the post, and the redelivery genuinely retries.
func (s *Service) WithdrawalHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		posted := event.GetSettlementLogPosted()
		if posted == nil || posted.GetSettlementType() != settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL {
			return nil
		}

		return s.postWithdrawal(ctx, event, posted)
	}
}

func (s *Service) postWithdrawal(ctx context.Context, event *eventsv1.Event, posted *eventsv1.SettlementLogPosted) error {
	occurredAt, err := withdrawalDay(posted)
	if err != nil {
		// NOT acked: a withdrawal this build cannot date is money it cannot file, and dropping it would leave
		// an account short with nothing disagreeing — the dead-letter queue is where a person sees it.
		return fmt.Errorf("financial_account: %s: %w", event.GetEventId(), err)
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		isNew, err := s.dedup.Claim(ctx, tx, event)
		if err != nil {
			return err
		}

		if !isNew {
			return nil
		}

		account, err := s.accountOfShop(tx, posted.GetTeamId(), posted.GetShopId())
		if err != nil {
			return err
		}

		description := fmt.Sprintf("Withdrawal from shop #%d", posted.GetShopId())
		if note := strings.TrimSpace(posted.GetNote()); note != "" {
			description += " · " + note
		}

		// THE SIGN TURNED: a withdrawal is NEGATIVE in settlement — money leaving the marketplace wallet — and
		// that is money ARRIVING here. A reversal of one is positive there, so it comes back out here.
		_, err = post(tx, account, entry{
			changeType:  m.ChangeWithdrawal,
			change:      -float64(posted.GetChange()),
			description: description,
			occurredAt:  occurredAt,
			// A row a listener posted names the person settlement says is answerable for it.
			actorID: posted.GetActorId(),
		})

		return err
	})
}

// accountOfShop is the LOCKED account a shop withdraws into — or, when the shop names none, an `unknown`
// account made for it and linked, in this same transaction (a-shop-with-no-account-gets-an-unknown-one):
// nothing is held back, and the money waits there until a person says which bank it is
// (an-unknown-account-is-filled-in-or-moved-in).
//
// ⚠ Two first withdrawals from one new shop at once: both make an account, one commits, the other hits the
// unique shop_id, rolls back with its claim and is redelivered — and finds the first one's row (my spec).
//
// An archived account still takes the withdrawal (my spec): refusing would dead-letter money that moved.
func (s *Service) accountOfShop(tx *gorm.DB, teamID, shopID uint64) (*m.FinancialAccount, error) {
	var link m.ShopAccount

	err := tx.Where("shop_id = ?", shopID).Limit(1).Find(&link).Error
	if err != nil {
		return nil, err
	}

	if link.ID != 0 {
		account, err := lockAccount(tx, link.TeamID, link.AccountID)
		if err != nil {
			return nil, err
		}

		// ⚠ RE-CHECK THE LINK UNDER THE LOCK. It was read before the lock, so a move-in that committed while
		// this waited (an-unknown-account-is-filled-in-or-moved-in re-points the shop and archives the unknown
		// account) leaves it naming an account the shop no longer withdraws into. Posting anyway would put the
		// money in an archived account its shop has left. The lock is held now, so this read is the shop's
		// current answer; a stale one is RETRIED — the error rolls the claim back and the broker redelivers,
		// which finds the new link. No second lock is taken while one is held, so this cannot deadlock.
		var current m.ShopAccount

		err = tx.Where("shop_id = ?", shopID).Limit(1).Find(&current).Error
		if err != nil {
			return nil, err
		}

		if current.AccountID != account.ID {
			return nil, fmt.Errorf("financial_account: shop %d moved from account %d to %d while this withdrawal waited — retry", shopID, account.ID, current.AccountID)
		}

		return account, nil
	}

	// No row: the shop's first withdrawal with no account named. The name says whose money it is — the
	// screens show the shop by name beside it; a listener has no caller to ask the shop's service with.
	unknown := m.FinancialAccount{
		TeamID:   teamID,
		Type:     m.TypeUnknown,
		Provider: m.ProviderUnknown,
		Status:   m.StatusActive,
		Name:     fmt.Sprintf("Unknown — shop #%d", shopID),
	}

	err = tx.Create(&unknown).Error
	if err != nil {
		return nil, err
	}

	err = tx.Create(&m.ShopAccount{TeamID: teamID, ShopID: shopID, AccountID: unknown.ID}).Error
	if err != nil {
		return nil, err
	}

	return lockAccount(tx, teamID, unknown.ID)
}

// withdrawalDay is when the money MOVED (the-log-keeps-the-day-the-money-moved): the row's `occurred_on` — the
// day the money belongs to — else the day settlement posted it, as midnight Jakarta, so its Jakarta date is
// exactly that day (a-row-counts-on-the-day-the-money-moved).
func withdrawalDay(posted *eventsv1.SettlementLogPosted) (time.Time, error) {
	day := posted.GetOccurredOn()
	if day == "" {
		day = posted.GetPostedOn()
	}

	t, err := time.ParseInLocation(dateLayout, day, jakarta)
	if err != nil {
		return time.Time{}, fmt.Errorf("withdrawal day %q: %w", day, err)
	}

	return t, nil
}
