package product_v1

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TeamCodeLookup reads many teams' codes at once — the bulk form of TeamCodes, for the one-shot recompose. A team it does
// not know (or has deleted) is simply absent from the map.
type TeamCodeLookup func(ctx context.Context, teamIDs []uint64) (map[uint64]string, error)

// RecomposeReport is what a recompose did — printed by `san product recompose-codes`, and asserted on by its tests.
type RecomposeReport struct {
	// Recomposed rows took their team's code in front: SHOE-42 → ABC-SHOE-42.
	Recomposed int
	// AlreadyComposed rows already began with `<their team's code>-` and were left alone — which is what makes a second
	// run a no-op.
	AlreadyComposed int
	// NoTeamCode lists the products whose team has no code to read (unknown or deleted): left as they were.
	NoTeamCode []uint64
}

// recomposeHold is the placeholder a row being recomposed holds for a moment, unique by its id — see RecomposeProductCodes.
const recomposeHold = "#recompose#"

// RecomposeProductCodes puts each product's team code in front of the code it already has, ONCE — the rows written before
// the code was composed on write (the-field-is-product-code-composed-on-write, "today's rows"). The team codes come from
// team_service through codes; a migration could not do this, because it would have to read another service's table
// (HARD RULE 3).
//
// A row whose code already begins with `<its team's code>-` counts as composed and is left alone, so running it twice
// changes nothing. ⚠ A row a person typed that way before composition existed reads as composed too — it is exactly the
// string composition would have produced, so there is nothing to tell apart.
//
// It is one transaction: every row is locked, every code is first parked on a placeholder unique by id and then set, so
// two rows trading codes cannot trip the unique index halfway. A real collision — two products that would carry one code
// — fails the whole run with both named, and nothing is written.
func RecomposeProductCodes(ctx context.Context, db *gorm.DB, codes TeamCodeLookup) (RecomposeReport, error) {
	var report RecomposeReport

	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []struct {
			ID          uint64
			TeamID      uint64
			ProductCode string
		}

		err := tx.
			Table("products").
			Select("id", "team_id", "product_code").
			Order("id").
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Find(&rows).
			Error
		if err != nil {
			return err
		}

		if len(rows) == 0 {
			return nil
		}

		seen := map[uint64]bool{}
		teamIDs := []uint64{}

		for _, row := range rows {
			if !seen[row.TeamID] {
				seen[row.TeamID] = true
				teamIDs = append(teamIDs, row.TeamID)
			}
		}

		teamCodes, err := codes(ctx, teamIDs)
		if err != nil {
			return fmt.Errorf("read the team codes: %w", err)
		}

		next := map[uint64]string{}
		holder := map[string]uint64{}

		for _, row := range rows {
			teamCode := teamCodes[row.TeamID]

			switch {
			case teamCode == "":
				report.NoTeamCode = append(report.NoTeamCode, row.ID)
				holder[row.ProductCode] = row.ID
			case strings.HasPrefix(row.ProductCode, teamCode+productCodeSeparator):
				report.AlreadyComposed++
				holder[row.ProductCode] = row.ID
			default:
				next[row.ID] = composeProductCode(teamCode, row.ProductCode)
			}
		}

		if len(next) == 0 {
			return nil
		}

		ids := make([]uint64, 0, len(next))
		for id := range next {
			ids = append(ids, id)
		}

		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

		// A collision is found here, by name, before anything is written — the index would only say "duplicate key".
		for _, id := range ids {
			if other, taken := holder[next[id]]; taken {
				return fmt.Errorf("%w: product %d would become %q, which product %d already carries — rename one of them, then run this again",
					errRecomposeCollision, id, next[id], other)
			}

			holder[next[id]] = id
		}

		err = tx.
			Table("products").
			Where("id IN ?", ids).
			Update("product_code", gorm.Expr("? || id::text", recomposeHold)).
			Error
		if err != nil {
			return err
		}

		for _, id := range ids {
			err = tx.
				Table("products").
				Where("id = ?", id).
				Update("product_code", next[id]).
				Error
			if err != nil {
				return fmt.Errorf("product %d → %q: %w", id, next[id], err)
			}
		}

		report.Recomposed = len(ids)

		return nil
	})
	if err != nil {
		return RecomposeReport{}, err
	}

	return report, nil
}

var errRecomposeCollision = errors.New("two products would carry one code")
