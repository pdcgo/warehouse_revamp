package financial_account_v1

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// THE LEDGER'S ONE WRITE PATH. Every row — by hand or from a listener — goes through `post`, and `post`
// runs on an account its caller has LOCKED. That lock is the whole concurrency story:
//
//   - balance_after is the account's balance + the change, read under the lock — two posts on one account
//     queue, so neither reads a balance the other is about to move;
//   - the day's report row and every later day's shift (the-daily-row-is-written-with-the-log-row) are
//     per account, so the same lock serialises them — no advisory lock, no event table.
//
// A transfer locks BOTH accounts, always in id order, so two opposite transfers cannot deadlock.

// entry is one row to post, in the ledger's own terms.
type entry struct {
	changeType       string
	change           float64
	description      string
	occurredAt       time.Time
	actorID          uint64
	groupID          uint64
	counterAccountID uint64
}

// lockAccounts loads the team's accounts FOR UPDATE, in id order. Another team's account, or one that does
// not exist, is errAccountNotFound — an id leaks nothing.
func lockAccounts(tx *gorm.DB, teamID uint64, ids ...uint64) (map[uint64]*m.FinancialAccount, error) {
	wanted := slices.Clone(ids)
	slices.Sort(wanted)
	wanted = slices.Compact(wanted)

	rows := []m.FinancialAccount{}

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id IN ? AND team_id = ?", wanted, teamID).
		Order("id").
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if len(rows) != len(wanted) {
		return nil, errAccountNotFound
	}

	out := make(map[uint64]*m.FinancialAccount, len(rows))
	for i := range rows {
		out[rows[i].ID] = &rows[i]
	}

	return out, nil
}

// lockAccount is lockAccounts for one.
func lockAccount(tx *gorm.DB, teamID, id uint64) (*m.FinancialAccount, error) {
	locked, err := lockAccounts(tx, teamID, id)
	if err != nil {
		return nil, err
	}

	return locked[id], nil
}

// post appends one row to an account the caller has LOCKED: the log row, the balance, the day's report row.
//
// ⚠ IT IS POLICY-FREE. It records; it never refuses — below zero included (below-zero-is-warned-never-refused).
// Whether a row may be posted at all (an archived account, a hand row on an unknown one) is the caller's
// decision, made before it calls.
func post(tx *gorm.DB, account *m.FinancialAccount, e entry) (m.FinancialAccountLog, error) {
	if !slices.Contains(changeTypes, e.changeType) {
		return m.FinancialAccountLog{}, fmt.Errorf("financial_account: unknown change type %q", e.changeType)
	}

	change := rupiah(e.change)
	after := account.Balance + change

	row := m.FinancialAccountLog{
		TeamID:           account.TeamID,
		AccountID:        account.ID,
		ChangeType:       e.changeType,
		Change:           change,
		BalanceAfter:     after,
		Description:      e.description,
		ActorID:          e.actorID,
		OccurredAt:       e.occurredAt,
		GroupID:          e.groupID,
		CounterAccountID: e.counterAccountID,
	}

	err := tx.Create(&row).Error
	if err != nil {
		return m.FinancialAccountLog{}, dbError(err)
	}

	err = tx.
		Model(&m.FinancialAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]any{"balance": after, "updated_at": gorm.Expr("NOW()")}).
		Error
	if err != nil {
		return m.FinancialAccountLog{}, dbError(err)
	}

	account.Balance = after

	err = foldDay(tx, account, e.changeType, change, e.occurredAt.In(jakarta).Format(dateLayout))
	if err != nil {
		return m.FinancialAccountLog{}, err
	}

	return row, nil
}

// foldDay applies one movement to the account's daily report: the day's own row, then every later day.
//
// The statements are settlement's fold (analytic_context.md §How we computed balance), keyed by account and
// run in the log row's transaction instead of a webhook's. ⚠ The day is bound as a STRING cast to date — a
// Go time.Time is a timestamptz, and comparing a date against it moves the boundary by the session offset.
func foldDay(tx *gorm.DB, account *m.FinancialAccount, column string, change float64, day string) error {
	args := map[string]any{
		"day":     day,
		"account": account.ID,
		"team":    account.TeamID,
		"change":  change,
	}

	// The day's row — one statement, no branch. A new row opens from the account's LAST row before it (a
	// quiet day has no row), or at 0 when there is none. `column` is a change type, checked by post.
	upsert := fmt.Sprintf(`
INSERT INTO financial_account_daily_reports AS d (day, account_id, team_id, %[1]s, change, open_balance, close_balance, last_updated)
VALUES (
    CAST(@day AS date), @account, @team, @change, @change,
    COALESCE((SELECT p.close_balance FROM financial_account_daily_reports p
              WHERE p.account_id = @account AND p.day < CAST(@day AS date)
              ORDER BY p.day DESC LIMIT 1), 0),
    COALESCE((SELECT p.close_balance FROM financial_account_daily_reports p
              WHERE p.account_id = @account AND p.day < CAST(@day AS date)
              ORDER BY p.day DESC LIMIT 1), 0) + @change,
    NOW()
)
ON CONFLICT (account_id, day) DO UPDATE
SET %[1]s         = d.%[1]s + EXCLUDED.%[1]s,
    change        = d.change + EXCLUDED.change,
    close_balance = d.close_balance + EXCLUDED.change,
    last_updated  = NOW()`, column)

	err := tx.Exec(upsert, args).Error
	if err != nil {
		return fmt.Errorf("financial_account: the day's report row: %w", err)
	}

	// Every LATER day — a shift, never a recomputation: a row dated last week moves every day since.
	err = tx.Exec(`
UPDATE financial_account_daily_reports
SET open_balance  = open_balance + @change,
    close_balance = close_balance + @change,
    last_updated  = NOW()
WHERE account_id = @account AND day > CAST(@day AS date)`, args).Error
	if err != nil {
		return fmt.Errorf("financial_account: the later days' report rows: %w", err)
	}

	return nil
}

// nextGroup is a fresh id both legs of one act share.
func nextGroup(tx *gorm.DB) (uint64, error) {
	var id uint64

	err := tx.Raw(`SELECT nextval('financial_account_log_groups')`).Scan(&id).Error
	if err != nil {
		return 0, dbError(err)
	}

	return id, nil
}

// transferLegs posts a transfer: `transfer` out of `from`, `transfer` into `to`, one group id. Both accounts
// must already be LOCKED by the caller.
func transferLegs(
	tx *gorm.DB,
	from, to *m.FinancialAccount,
	amount float64,
	occurredAt time.Time,
	note string,
	actorID uint64,
) ([]m.FinancialAccountLog, error) {
	group, err := nextGroup(tx)
	if err != nil {
		return nil, err
	}

	suffix := ""
	if strings.TrimSpace(note) != "" {
		suffix = " — " + strings.TrimSpace(note)
	}

	out, err := post(tx, from, entry{
		changeType:       m.ChangeTransfer,
		change:           -amount,
		description:      "To " + to.Name + suffix,
		occurredAt:       occurredAt,
		actorID:          actorID,
		groupID:          group,
		counterAccountID: to.ID,
	})
	if err != nil {
		return nil, err
	}

	in, err := post(tx, to, entry{
		changeType:       m.ChangeTransfer,
		change:           amount,
		description:      "From " + from.Name + suffix,
		occurredAt:       occurredAt,
		actorID:          actorID,
		groupID:          group,
		counterAccountID: from.ID,
	})
	if err != nil {
		return nil, err
	}

	return []m.FinancialAccountLog{out, in}, nil
}

// extrasOf loads what a page of accounts does not hold itself — the operational marks and the shops — in two
// queries for the whole page, never one per account.
func extrasOf(db *gorm.DB, ids []uint64) (map[uint64]accountExtras, error) {
	out := make(map[uint64]accountExtras, len(ids))
	if len(ids) == 0 {
		return out, nil
	}

	marked := []uint64{}

	err := db.Model(&m.OperationalAccount{}).Where("account_id IN ?", ids).Pluck("account_id", &marked).Error
	if err != nil {
		return nil, dbError(err)
	}

	links := []m.ShopAccount{}

	err = db.Where("account_id IN ?", ids).Order("shop_id").Find(&links).Error
	if err != nil {
		return nil, dbError(err)
	}

	for _, id := range marked {
		extra := out[id]
		extra.operational = true
		out[id] = extra
	}

	for _, link := range links {
		extra := out[link.AccountID]
		extra.shopIDs = append(extra.shopIDs, link.ShopID)
		out[link.AccountID] = extra
	}

	return out, nil
}

// renderAccount is one account on the wire, with its extras — what every write RPC answers with.
func renderAccount(db *gorm.DB, a m.FinancialAccount) (*financial_accountv1.FinancialAccount, error) {
	extras, err := extrasOf(db, []uint64{a.ID})
	if err != nil {
		return nil, err
	}

	return accountToProto(a, extras[a.ID]), nil
}

// reloadAccount reads an account back after a write, so the answer carries what the database now holds.
func reloadAccount(db *gorm.DB, id uint64) (*financial_accountv1.FinancialAccount, error) {
	var a m.FinancialAccount

	err := db.Where("id = ?", id).Take(&a).Error
	if err != nil {
		return nil, dbError(err)
	}

	return renderAccount(db, a)
}
