package settlement_v1

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// ErrAlreadyPosted means this exact movement is already in the ledger.
//
// ⚠ IT IS A NORMAL ANSWER, NOT A FAILURE, and callers must treat it as one. The order fees arrive on
// Pub/Sub, which delivers AT LEAST ONCE — a redelivered order is expected. A consumer that NACKed
// this would make Pub/Sub redeliver a message that can never succeed: a poison loop built entirely
// out of correct behaviour. ACK it and move on.
var ErrAlreadyPosted = errors.New("settlement: this movement is already posted")

// Posting is one movement between two teams, stated in the only terms that cannot be misread: WHO
// OWES, WHO IS OWED, and a POSITIVE amount.
//
// Deliberately NOT a signed amount with a single team. A caller passing a sign has to know the
// convention, and the day somebody gets it backwards the ledger says the creditor owes the debtor —
// arithmetically consistent, completely wrong, and invisible until a person reads the screen.
type Posting struct {
	// The team that owes. Its balance moves DOWN (a payable).
	DebtorTeamID uint64
	// The team that is owed. Its balance moves UP (a receivable).
	CreditorTeamID uint64

	// Whole rupiah, always positive — direction is carried by the two fields above.
	Amount int64

	// What caused this, and its id in whichever service owns it. Together with the counterparty and
	// `Reversal` they form the idempotency key.
	SourceType SourceType
	SourceID   uint64

	// Whether this movement UNDOES an earlier one. A reversal is an equal-and-opposite entry: the
	// original stays, the balance nets to zero, and the history shows the fee was charged and then
	// returned. "The fee briefly existed" is exactly what an audit needs to see.
	//
	// Set it rather than swapping debtor and creditor: the swap would produce the right arithmetic
	// with the wrong idempotency key, so a double cancel would reverse twice.
	Reversal bool
}

// PostEntry writes BOTH LEGS of one movement, in one transaction.
//
// ⚠ IT IS POLICY-FREE. It records; it never refuses. There is no credit check here and there must
// never be one — the ledger records what happened, and the order flow chooses to gate itself before
// calling. A ledger that sometimes declines to record reality is how books stop matching the world.
//
// `tx` is supplied by the caller so a posting can join a transaction it must be atomic with — the COD
// obligation is written in the SAME transaction as the restock acceptance (#184), because a stock
// movement that commits without its obligation leaves the warehouse out of pocket with no record,
// which is precisely the situation this service exists to fix.
//
// Returns the group id shared by both legs. `ErrAlreadyPosted` if this movement is already recorded.
func (s *Service) PostEntry(ctx context.Context, tx *gorm.DB, p Posting) (uint64, error) {
	if p.DebtorTeamID == 0 || p.CreditorTeamID == 0 {
		return 0, errors.New("settlement: a posting needs both sides")
	}

	if p.DebtorTeamID == p.CreditorTeamID {
		return 0, errSameTeam
	}

	// A zero or negative posting is refused rather than stored. Zero would be an entry that changes
	// nothing while consuming the pair's idempotency key for that source — so the real fee, when it
	// arrived, would be swallowed as a duplicate.
	if p.Amount <= 0 {
		return 0, errors.New("settlement: a posting must be a positive amount")
	}

	if tx == nil {
		tx = s.db
	}

	tx = tx.WithContext(ctx)

	sourceType := sourceTypeText(p.SourceType)
	if sourceType == "" {
		return 0, errors.New("settlement: a posting must say what caused it")
	}

	var groupID uint64

	err := tx.Raw("SELECT nextval('settlement_group_seq')").Scan(&groupID).Error
	if err != nil {
		return 0, err
	}

	// A REVERSAL FLIPS WHO GAINS, and nothing else. The source and the counterparty stay as they
	// were, so the history reads as one story: the fee, then its return.
	creditorAmount := p.Amount
	if p.Reversal {
		creditorAmount = -p.Amount
	}

	// The creditor's leg first, then the debtor's mirror. Order is irrelevant to correctness — they
	// are in one transaction — but a fixed order makes deadlocks between concurrent postings for the
	// same pair impossible rather than unlikely.
	err = s.postLeg(tx, p, groupID, p.CreditorTeamID, p.DebtorTeamID, creditorAmount, sourceType)
	if err != nil {
		return 0, err
	}

	err = s.postLeg(tx, p, groupID, p.DebtorTeamID, p.CreditorTeamID, -creditorAmount, sourceType)
	if err != nil {
		return 0, err
	}

	return groupID, nil
}

// postLeg writes one side: it moves that side's balance, then records the entry that moved it.
//
// Balance first, entry second, so `balance_after` on the entry is the balance that actually resulted
// rather than one computed alongside it. The two cannot disagree, because only one of them is
// calculated.
func (s *Service) postLeg(
	tx *gorm.DB,
	p Posting,
	groupID, teamID, counterpartyID uint64,
	amount int64,
	sourceType string,
) error {
	balance, err := s.moveBalance(tx, teamID, counterpartyID, amount)
	if err != nil {
		return err
	}

	entry := settlement_service_models.SettlementEntry{
		TeamID:         teamID,
		CounterpartyID: counterpartyID,
		Amount:         amount,
		SourceType:     sourceType,
		SourceID:       p.SourceID,
		Reversal:       p.Reversal,
		GroupID:        groupID,
		BalanceAfter:   balance,
	}

	err = tx.Create(&entry).Error
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		// The unique index fired: this movement is already in the ledger. The transaction is doomed
		// either way — the caller rolls back, and the balance move above goes with it.
		return ErrAlreadyPosted
	}

	return err
}

// moveBalance applies the delta to one side's running total and returns the result.
//
// ⚠ THE UPSERT IS THE POINT. Lock-then-read cannot protect a row that does not exist yet: two
// concurrent first-postings for a new pair both find nothing, both insert, and one update is lost.
// `ON CONFLICT ... DO UPDATE` against the unique index makes the database serialise them instead.
//
// It also maintains the ageing clock. `oldest_unsettled_at` is set as the balance LEAVES zero and
// cleared as it RETURNS — so paying in full resets it and a partial payment does not. Both are done
// in the same statement as the arithmetic, because a balance and the age of its debt disagreeing is
// exactly the sort of thing nobody notices until a manager chases the wrong team.
func (s *Service) moveBalance(tx *gorm.DB, teamID, counterpartyID uint64, amount int64) (int64, error) {
	now := time.Now()

	// Hand-written rather than built through GORM's OnConflict clause, and the reason is worth
	// recording: the `CASE` below needs the proposed value twice and the stored value three times.
	// Expressed as GORM assignments each fragment carries its own placeholders, and the arguments no
	// longer line up with the statement they were written for — the first version of this compiled,
	// ran, updated the balance correctly, and silently never cleared the ageing clock.
	//
	// `EXCLUDED` is what removes the risk entirely: the proposed row is named rather than re-bound,
	// so there is exactly one placeholder per value. RETURNING then gives the resulting balance
	// without a second query that could read a different transaction's answer.
	const upsert = `
INSERT INTO settlement_balances
    (team_id, counterparty_id, balance, oldest_unsettled_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (team_id, counterparty_id) DO UPDATE SET
    balance = settlement_balances.balance + EXCLUDED.balance,
    oldest_unsettled_at = CASE
        -- Square again: stop the clock.
        WHEN settlement_balances.balance + EXCLUDED.balance = 0 THEN NULL
        -- Debt begins here: start it.
        WHEN settlement_balances.balance = 0 THEN EXCLUDED.oldest_unsettled_at
        -- More debt on an existing run: the oldest unsettled is still the oldest.
        ELSE settlement_balances.oldest_unsettled_at
    END,
    updated_at = EXCLUDED.updated_at
RETURNING balance`

	var balance int64

	err := tx.
		Raw(upsert, teamID, counterpartyID, amount, now, now, now).
		Scan(&balance).
		Error
	if err != nil {
		return 0, err
	}

	return balance, nil
}
