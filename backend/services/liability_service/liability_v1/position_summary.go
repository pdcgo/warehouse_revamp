package liability_v1

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// positionSummary is *"Summarize All Balance"* (team_balance_design.md §Frontend Requirements 1) —
// the whole set, never the page.
//
// ⚠ IT EXISTS BECAUSE THE SUMMARY LIVES ON A PAGINATED LIST. the-summary-is-tiles-on-the-list
// settles that the summary is the tiles on top of the pair rows rather than a screen of its own, so
// it can never run a query of its own scope — and the screen was reducing the 20 rows it had loaded.
// A creditor with 21 counterparties read a headline that omitted the 21st, and turning to page 2
// changed the "total". It looked right while being wrong, which is the worst way for a number to
// fail.
type positionSummary struct {
	// Σ of positive balances — what the whole world owes this team.
	TotalReceivable int64
	// Σ of negative balances AS A MAGNITUDE. Direction is words on this screen, never a sign
	// (features/liability/direction.ts), so the negation happens once here rather than in every reader.
	TotalPayable int64
	// Whose debt is oldest, and when it was posted. 0/0 when nothing is outstanding.
	OldestCounterpartyID  uint64
	OldestUnsettledAtUnix int64
}

// summarizePositions aggregates the SAME filtered set the rows came from.
//
// ⚠ IT TAKES A `scope` FUNCTION, NOT A `*gorm.DB`, and that is a correctness requirement rather than
// a style choice. GORM's chain methods MUTATE the shared Statement, so a query handed over after the
// caller has ordered and paged it carries that ordering — Postgres then rejects the aggregate because
// the ordered column is not grouped, and `Session` does not help: it changes how LATER calls clone,
// not the statement already shared. Calling `scope()` builds a fresh query from the one definition of
// the filter, so the count, the rows and the summary cannot drift apart.
//
// ⚠ IT HONOURS THE FILTER AND IGNORES THE PAGE. A page is a window on one answer; a filter changes
// which question is being asked. `unsettledOnly` on with a total that counted settled pairs would be
// a new way to mislead.
//
// TWO QUERIES, ON PURPOSE. The sums are an aggregate and the oldest is a ROW — one `ORDER BY … LIMIT
// 1`, because the tile renders the counterparty's NAME beneath the age and `MIN(oldest_unsettled_at)`
// would hand back a timestamp with nobody attached.
func summarizePositions(scope func() *gorm.DB) (positionSummary, error) {
	var out positionSummary

	// ⚠ `SUM` OVER NO ROWS IS NULL, not 0 — COALESCE is not decoration here. A team with no
	// counterparties would otherwise fail to scan rather than report zero.
	var sums struct {
		TotalReceivable int64
		TotalPayable    int64
	}

	err := scope().
		Select(`
			COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS total_receivable,
			COALESCE(-SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END), 0) AS total_payable`).
		Scan(&sums).
		Error
	if err != nil {
		return out, err
	}

	out.TotalReceivable = sums.TotalReceivable
	out.TotalPayable = sums.TotalPayable

	// THE OLDEST STILL-OUTSTANDING DEBT, whoever it belongs to. `oldest_unsettled_at IS NOT NULL` is
	// what "still outstanding" means on this table — a squared pair has it cleared, so a settled row
	// can never win this ordering. `id` breaks ties, matching how the rows themselves are ordered.
	var oldest liability_service_models.LiabilityBalance

	err = scope().
		Where("oldest_unsettled_at IS NOT NULL").
		Order("oldest_unsettled_at ASC, id ASC").
		Limit(1).
		Find(&oldest).
		Error
	if err != nil {
		return out, err
	}

	// ⚠ `Find` ON NO ROWS IS NOT AN ERROR, it simply leaves the struct zeroed — which is the answer
	// we want ("nothing is outstanding") rather than a NotFound to translate. `Take` would have
	// returned ErrRecordNotFound for the ordinary case of a team that owes nobody.
	if oldest.OldestUnsettledAt != nil {
		out.OldestCounterpartyID = oldest.CounterpartyID
		out.OldestUnsettledAtUnix = oldest.OldestUnsettledAt.Unix()
	}

	return out, nil
}
