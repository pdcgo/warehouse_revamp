package product_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// RecomposeActor is who changed the team code — written on each product's history line: the person (0 = none recorded)
// and whether they were Root or the Administrator outside the team (an-override-is-stamped-in-every-service).
type RecomposeActor struct {
	UserID     uint64
	IsOverride bool
}

// TeamRecomposeReport is what a team code change did to the team's products.
type TeamRecomposeReport struct {
	// Recomposed products took the new code: ABC-SHOE-42 → XYZ-SHOE-42 — every one under `<old code>-`, archived too.
	Recomposed int
	// Tagged products are those of them some warehouse holds stock of — `need_reprint_code` on, one reprint wait per
	// warehouse holding it (Waits).
	Tagged int
	Waits  int
	// LeftAlone counts the team's products NOT under `<old code>-` — rows written before codes were composed — left as
	// they were; LeftAloneCodes names the first leftAloneNamed of them, by id.
	LeftAlone      int
	LeftAloneCodes []string
}

// leftAloneNamed is how many left-alone codes a report names.
const leftAloneNamed = 20

// ErrTeamRecomposeClash is a change refused because a product of the team would take a code another product already
// carries — possible only through a dash in a team code (AB + C-1 and AB-C + 1 compose alike). Nothing is written.
var ErrTeamRecomposeClash = errors.New("a product would take a code another product already carries")

var errNoStockForReprint = errors.New("the shelves cannot be read, so the products to reprint cannot be told — the team code is left as it is")

// parkPrefix is the placeholder a row being recomposed holds for a moment — `#recompose#<id>:<its code>`, unique by its
// id. A composed code can never begin with it (a team code is at most 10 characters, and the 11th is the dash).
const parkPrefix = "#recompose#"

// RecomposeTeamCodes gives the team's products its NEW code, in the team code change's own transaction `tx` (backlog #149,
// a-team-code-change-recomposes-its-product-codes; team_service's ProductCodeRecomposer, through
// cmd/app_development/product_code_recomposer.go). Every product whose code is `<old>-<part>` — archived ones too, which
// keep their code and may hold stock (⚠2) — becomes `<new>-<part>`: the exact old prefix comes off, so a dash in either
// code is no ambiguity. A product NOT under `<old>-` is left as it was and named in the report.
//
// SET-BASED, never a row-by-row loop, under the team's product-code lock (lockTeamProductCodes — ProductCreate and a
// correction take it too, so none of them lands the old prefix while this runs):
//
//  1. a CLASH — a product of the team would take a code another product carries — refuses the whole change
//     (ErrTeamRecomposeClash, naming both), before anything is written;
//  2. only when one prefix begins with the other (ABC → ABC-X) can a row's new code be ANOTHER row's old code inside the
//     one statement, so only then are the rows parked first on a placeholder unique by id;
//  3. ONE statement clears the moving products' earlier reprint waits and `need_reprint_code` — a second change before a
//     reprint starts the reprint over (⚠7) — joined on the team's rows under the old prefix (never on the update's own
//     RETURNING set: a DELETE … USING a data-modifying CTE is planned as a one-row loop, quadratic at volume);
//  4. ONE statement sets the codes and writes each product's history line (`code_changed`, old → new, who, when);
//  5. the shelves — inventory, in this tx — say which warehouses hold units of each product NOW; ONE statement writes
//     each (product, warehouse) reprint wait and tags those products `need_reprint_code`, put on by the app. A product
//     with nothing on a shelf anywhere takes the new code and is never tagged (⚠4).
//
// Past order, restock and transfer lines are other services' copies and keep their code (🔄 *past lines keep their code*).
func (s *Service) RecomposeTeamCodes(
	ctx context.Context,
	tx *gorm.DB,
	teamID uint64,
	oldCode, newCode string,
	actor RecomposeActor,
) (TeamRecomposeReport, error) {
	var report TeamRecomposeReport

	if oldCode == "" || newCode == "" || oldCode == newCode {
		return report, fmt.Errorf("recompose team %d: from %q to %q is no change", teamID, oldCode, newCode)
	}

	if s.stock == nil {
		return report, errNoStockForReprint
	}

	db := tx.WithContext(ctx)

	err := lockTeamProductCodes(db, teamID)
	if err != nil {
		return report, err
	}

	oldPrefix := oldCode + productCodeSeparator
	newPrefix := newCode + productCodeSeparator

	err = leftAlone(db, teamID, oldPrefix, &report)
	if err != nil {
		return report, err
	}

	err = refuseRecomposeClash(db, teamID, oldPrefix, newPrefix)
	if err != nil {
		return report, err
	}

	reprintTag, err := reprintTagID(db)
	if err != nil {
		return report, err
	}

	// The moving products' earlier reprint waits and `need_reprint_code` go first (⚠7: today's holding warehouses are
	// written below), each joined on the team's rows under the old prefix — the very rows the update moves.
	err = db.
		Exec(`WITH cleared AS (
				DELETE FROM product_reprint_waits w USING products p
				WHERE p.id = w.product_id AND p.team_id = ? AND starts_with(p.product_code, ?)
			)
			DELETE FROM product_tag_links l USING products p
			WHERE p.id = l.product_id AND l.tag_id = ? AND p.team_id = ? AND starts_with(p.product_code, ?)`,
			teamID, oldPrefix, reprintTag, teamID, oldPrefix).
		Error
	if err != nil {
		return report, err
	}

	// The team's rows to move, as the statement below matches them (`starts_with(product_code, matchArg)`): under the old
	// prefix, or parked — and the expression that reads each one's code as it was.
	original := "product_code"
	matchArg := oldPrefix

	if strings.HasPrefix(newPrefix, oldPrefix) || strings.HasPrefix(oldPrefix, newPrefix) {
		err = db.
			Exec("UPDATE products SET product_code = ? || id::text || ':' || product_code WHERE team_id = ? AND starts_with(product_code, ?)",
				parkPrefix, teamID, oldPrefix).
			Error
		if err != nil {
			return report, err
		}

		original = "substr(product_code, char_length(? || id::text || ':') + 1)"
		matchArg = parkPrefix
	}

	newCodeExpr := "? || substr(" + original + ", char_length(?) + 1)"

	args := []any{newPrefix}
	if original != "product_code" {
		args = append(args, parkPrefix)
	}

	args = append(args, oldPrefix, teamID, matchArg,
		product_service_models.ProductLogCodeChanged, oldPrefix, newPrefix, actor.UserID, actor.IsOverride)

	var changed []uint64

	err = db.
		Raw(`WITH changed AS (
				UPDATE products SET product_code = `+newCodeExpr+`
				WHERE team_id = ? AND starts_with(product_code, ?)
				RETURNING id, product_code
			), logged AS (
				INSERT INTO product_logs (product_id, kind, old_code, new_code, actor_id, is_override, created_at)
				SELECT id, ?, ? || substr(product_code, char_length(?) + 1), product_code, ?, ?, NOW() FROM changed
			)
			SELECT id FROM changed ORDER BY id`, args...).
		Scan(&changed).
		Error
	if err != nil {
		if isUniqueViolation(err) {
			return report, fmt.Errorf("%w — another product took one of the new codes while the change ran", ErrTeamRecomposeClash)
		}

		return report, err
	}

	report.Recomposed = len(changed)

	if len(changed) == 0 {
		return report, nil
	}

	shelves, err := s.stock.StockSitsAmong(ctx, tx, changed)
	if err != nil {
		return report, fmt.Errorf("read the shelves: %w", err)
	}

	if len(shelves) == 0 {
		return report, nil
	}

	products := make([]uint64, 0, len(shelves))
	warehouses := make([]uint64, 0, len(shelves))
	tagged := map[uint64]bool{}

	for _, shelf := range shelves {
		products = append(products, shelf.ProductID)
		warehouses = append(warehouses, shelf.WarehouseID)
		tagged[shelf.ProductID] = true
	}

	err = db.
		Exec(`WITH waits AS (
				INSERT INTO product_reprint_waits (product_id, warehouse_id, since)
				SELECT s.product_id, s.warehouse_id, NOW()
				FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS s(product_id, warehouse_id)
				JOIN products p ON p.id = s.product_id AND p.team_id = ?
				RETURNING product_id
			)
			INSERT INTO product_tag_links (product_id, tag_id, added_by_user_id, added_by_is_override, added_at)
			SELECT DISTINCT product_id, CAST(? AS bigint), 0, false, NOW() FROM waits
			ON CONFLICT DO NOTHING`,
			idArray(products), idArray(warehouses), teamID, reprintTag).
		Error
	if err != nil {
		return report, err
	}

	report.Tagged = len(tagged)
	report.Waits = len(shelves)

	return report, nil
}

// leftAlone counts the team's products NOT under the old prefix and names the first leftAloneNamed — one statement.
func leftAlone(db *gorm.DB, teamID uint64, oldPrefix string, report *TeamRecomposeReport) error {
	var rows []struct {
		ProductCode string
		Total       int
	}

	err := db.
		Raw(`SELECT product_code, COUNT(*) OVER () AS total FROM products
			WHERE team_id = ? AND NOT starts_with(product_code, ?)
			ORDER BY id LIMIT ?`, teamID, oldPrefix, leftAloneNamed).
		Scan(&rows).
		Error
	if err != nil {
		return err
	}

	for _, row := range rows {
		report.LeftAlone = row.Total
		report.LeftAloneCodes = append(report.LeftAloneCodes, row.ProductCode)
	}

	return nil
}

// refuseRecomposeClash finds, before anything is written, a product of the team whose NEW code another product carries
// — one that is not itself moving off the old prefix — and refuses the change naming both. ONE statement: each moving
// row's new code is looked up in the code's unique index.
func refuseRecomposeClash(db *gorm.DB, teamID uint64, oldPrefix, newPrefix string) error {
	var clash []struct {
		ID        uint64
		Code      string
		OtherID   uint64
		OtherCode string
	}

	err := db.
		Raw(`SELECT mine.id, mine.product_code AS code, other.id AS other_id, other.product_code AS other_code
			FROM products mine
			JOIN products other ON other.product_code = ? || substr(mine.product_code, char_length(?) + 1)
			WHERE mine.team_id = ? AND starts_with(mine.product_code, ?)
			  AND NOT (other.team_id = ? AND starts_with(other.product_code, ?))
			ORDER BY mine.id
			LIMIT 1`, newPrefix, oldPrefix, teamID, oldPrefix, teamID, oldPrefix).
		Scan(&clash).
		Error
	if err != nil {
		return err
	}

	if len(clash) == 0 {
		return nil
	}

	c := clash[0]

	return fmt.Errorf("%w: product %d (%s) would become %s, which product %d already carries — change that product's code first",
		ErrTeamRecomposeClash, c.ID, c.Code, c.OtherCode, c.OtherID)
}

// reprintTagID is `need_reprint_code`'s id — found by its app task, never its name (00010 seeds it).
func reprintTagID(db *gorm.DB) (uint64, error) {
	var ids []uint64

	err := db.
		Model(&product_service_models.ProductTag{}).
		Where("app_task = ?", AppTaskReprintCode).
		Pluck("id", &ids).
		Error
	if err != nil {
		return 0, err
	}

	if len(ids) == 0 {
		return 0, fmt.Errorf("the app's tag %q is missing — product_service's migration 00010 seeds it", AppTaskReprintCode)
	}

	return ids[0], nil
}
