package product_v1

import (
	"context"
	"sort"
	"strings"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// THE REPRINT OF CHANGED CODES — product_service's half (backlog #151, #141 P3; products-have-their-own-tag-list, its 🔄
// *what clears*: the app takes `need_reprint_code` off once the new labels are printed, and with stock in several
// warehouses the tag stays until EACH of them has printed). The rows are #149's `product_reprint_waits` — one per
// (product, warehouse) whose shelves carry stickers with a code that is no longer the product's. Inventory asks these
// in-process through its ProductReader (cmd/app_development/product_reader.go); none of them has a wire surface of its
// own:
//
//	ReprintWaitsOf          a page of the products waiting for ONE warehouse — the reprint list
//	ReprintWaitingCount     how many — the warehouse Products list's *Cetak ulang kode (N)*
//	RecordReprint           the recorded print: that warehouse's waits cleared, the tag off after the last one
//	AddArrivalReprintWaits  a transfer accepted while tagged: the receiving warehouse waits too (scope141 ⚠6)
//
// THE LOCK: the two writes take, for every team owning one of their products, the team's product-code lock
// (lockTeamProductCodes — the team code change holds it for its whole transaction, ProductCreate and a correction take
// it too), so a record, an arrival and a code change of the same team's products run one after another:
//
//   - two warehouses recording the last two waits of one product at once take the tag off ONCE — without it each sees the
//     other's wait still there (its delete is not committed) and neither takes the tag off;
//   - a record never clears a wait for a code that is no longer live — the code it compares is read under the lock, and a
//     change in between has either committed (the code differs: not cleared) or waits for the record (and re-sets the
//     waits after it);
//   - an arrival adding a wait and a record taking the tag off never leave a wait with no tag.
//
// Several teams' locks are taken in ONE order — by the lock key — so two writers spanning the same teams never wait on
// each other in a circle. A holder of the lock never waits for inventory's rows (the change reads the shelves with a
// plain read), so an accept holding its transfer and placement rows while it waits here cannot close a cycle.

// ReprintWait is one product waiting for a warehouse's reprint: its LIVE code (the one the new label prints), its name,
// and its former code — the newest `code_changed` line's old code, empty when none.
type ReprintWait struct {
	ProductID   uint64
	ProductCode string
	Name        string
	FormerCode  string
}

// ReprintPrinted is one product of a recorded print, with the code its labels carried.
type ReprintPrinted struct {
	ProductID   uint64
	ProductCode string
}

// ReprintRecorded is what a recorded print did: the products this warehouse no longer waits for (Cleared), those printed
// with a code that is no longer live and so NOT cleared (CodeChanged), and those that lost `need_reprint_code` because no
// warehouse waits for them any more (Untagged). Each sorted by id.
type ReprintRecorded struct {
	Cleared     []uint64
	CodeChanged []uint64
	Untagged    []uint64
}

// ReprintWaitsOf is one page of the products waiting for `warehouseID`'s reprint, by live code then id, and how many wait
// in all. ONE statement for the page, its total and each row's former code (a per-row lookup in the OUTER select, so a
// deep page stays flat); a page past the end counts alone.
func (s *Service) ReprintWaitsOf(ctx context.Context, warehouseID uint64, offset, limit int) ([]ReprintWait, int64, error) {
	db := s.db.WithContext(ctx)

	var rows []struct {
		ProductID   uint64
		ProductCode string
		Name        string
		FormerCode  string
		Total       int64
	}

	err := db.
		Raw(`SELECT pg.product_id, pg.product_code, pg.name, COALESCE(f.old_code, '') AS former_code, pg.total
			FROM (
				SELECT w.product_id, p.product_code, p.name, COUNT(*) OVER () AS total
				FROM product_reprint_waits w
				JOIN products p ON p.id = w.product_id
				WHERE w.warehouse_id = ?
				ORDER BY p.product_code, p.id
				OFFSET ? LIMIT ?
			) pg
			LEFT JOIN LATERAL (
				SELECT l.old_code FROM product_logs l
				WHERE l.product_id = pg.product_id AND l.kind = ?
				ORDER BY l.id DESC
				LIMIT 1
			) f ON true
			ORDER BY pg.product_code, pg.product_id`,
			warehouseID, offset, limit, product_service_models.ProductLogCodeChanged).
		Scan(&rows).
		Error
	if err != nil {
		return nil, 0, err
	}

	if len(rows) == 0 {
		var total int64

		total, err = s.ReprintWaitingCount(ctx, warehouseID)
		if err != nil {
			return nil, 0, err
		}

		return nil, total, nil
	}

	out := make([]ReprintWait, 0, len(rows))
	for _, row := range rows {
		out = append(out, ReprintWait{
			ProductID:   row.ProductID,
			ProductCode: row.ProductCode,
			Name:        row.Name,
			FormerCode:  row.FormerCode,
		})
	}

	return out, rows[0].Total, nil
}

// ReprintWaitingCount is how many products wait for `warehouseID`'s reprint — an index-only count of its waits.
func (s *Service) ReprintWaitingCount(ctx context.Context, warehouseID uint64) (int64, error) {
	var total int64

	err := s.db.
		WithContext(ctx).
		Model(&product_service_models.ProductReprintWait{}).
		Where("warehouse_id = ?", warehouseID).
		Count(&total).
		Error

	return total, err
}

// RecordReprint is `warehouseID`'s recorded print, on the CALLER'S transaction `tx` (inventory's ProductReprintRecord,
// the liability_poster shape): under the teams' product-code locks it reads each printed product's live code, deletes
// this warehouse's wait for every product printed with its LIVE code, and takes `need_reprint_code` off those of them no
// warehouse waits for any more — the app's act (the tag's links carry no person). A product printed with a code that is
// no longer its own is not cleared (CodeChanged); an unknown product is ignored. Idempotent: printed again, nothing is
// left to delete. Four statements whatever the count, plus the locks.
func (s *Service) RecordReprint(ctx context.Context, tx *gorm.DB, warehouseID uint64, printed []ReprintPrinted) (ReprintRecorded, error) {
	var out ReprintRecorded

	asked := map[uint64][]string{}
	ids := make([]uint64, 0, len(printed))

	for _, p := range printed {
		if p.ProductID == 0 {
			continue
		}

		if _, seen := asked[p.ProductID]; !seen {
			ids = append(ids, p.ProductID)
		}

		asked[p.ProductID] = append(asked[p.ProductID], p.ProductCode)
	}

	if warehouseID == 0 || len(ids) == 0 {
		return out, nil
	}

	db := tx.WithContext(ctx)

	err := lockTeamsOfProducts(db, ids)
	if err != nil {
		return out, err
	}

	// The live codes, read UNDER the locks: a team code change cannot move them until this transaction ends.
	var live []struct {
		ID          uint64
		ProductCode string
	}

	err = db.
		Model(&product_service_models.Product{}).
		Select("id, product_code").
		Where("id = ANY(CAST(? AS bigint[]))", idArray(ids)).
		Scan(&live).
		Error
	if err != nil {
		return out, err
	}

	stillLive := make([]uint64, 0, len(live))

	for _, row := range live {
		if printedAs(asked[row.ID], row.ProductCode) {
			stillLive = append(stillLive, row.ID)
		} else {
			out.CodeChanged = append(out.CodeChanged, row.ID)
		}
	}

	if len(stillLive) > 0 {
		err = db.
			Raw(`DELETE FROM product_reprint_waits
				WHERE warehouse_id = ? AND product_id = ANY(CAST(? AS bigint[]))
				RETURNING product_id`, warehouseID, idArray(stillLive)).
			Scan(&out.Cleared).
			Error
		if err != nil {
			return out, err
		}

		reprintTag, tagErr := reprintTagID(db)
		if tagErr != nil {
			return out, tagErr
		}

		// The tag comes off a product once NO warehouse waits for it — read after this warehouse's delete, in the same
		// transaction, and under the locks every other writer of the waits takes.
		err = db.
			Raw(`DELETE FROM product_tag_links l
				WHERE l.tag_id = ? AND l.product_id = ANY(CAST(? AS bigint[]))
				  AND NOT EXISTS (SELECT 1 FROM product_reprint_waits w WHERE w.product_id = l.product_id)
				RETURNING l.product_id`, reprintTag, idArray(stillLive)).
			Scan(&out.Untagged).
			Error
		if err != nil {
			return out, err
		}
	}

	sortIDs(out.Cleared)
	sortIDs(out.CodeChanged)
	sortIDs(out.Untagged)

	return out, nil
}

// AddArrivalReprintWaits is a transfer accepted into `warehouseID` while some of its products are still tagged
// (scope141 ⚠6: the units arriving wear the old stickers), on the accept's own transaction `tx`: each received product
// that any warehouse still waits for — the tag on — and this one does not yet, now waits for this warehouse's reprint too.
// ONE insert over the product's existing waits, ON CONFLICT DO NOTHING, under the teams' product-code locks; a product
// nobody waits for is left alone (its stickers are new, or it was never recomposed). Answers how many waits it added.
func (s *Service) AddArrivalReprintWaits(ctx context.Context, tx *gorm.DB, warehouseID uint64, productIDs []uint64) (int64, error) {
	ids := distinctIDs(productIDs)
	if warehouseID == 0 || len(ids) == 0 {
		return 0, nil
	}

	db := tx.WithContext(ctx)

	err := lockTeamsOfProducts(db, ids)
	if err != nil {
		return 0, err
	}

	res := db.
		Exec(`INSERT INTO product_reprint_waits (product_id, warehouse_id, since)
			SELECT DISTINCT w.product_id, CAST(? AS bigint), NOW()
			FROM product_reprint_waits w
			WHERE w.product_id = ANY(CAST(? AS bigint[]))
			ON CONFLICT DO NOTHING`, warehouseID, idArray(ids))
	if res.Error != nil {
		return 0, res.Error
	}

	return res.RowsAffected, nil
}

// lockTeamsOfProducts takes the product-code lock (lockTeamProductCodes' key, productCodeLockKey) of every team owning
// one of the products, in ONE order — by the lock's own key, in one statement — so two writers spanning several teams
// never wait on each other in a circle. A product's team never changes, so reading it before the lock is safe.
func lockTeamsOfProducts(db *gorm.DB, productIDs []uint64) error {
	var teams []uint64

	err := db.
		Model(&product_service_models.Product{}).
		Distinct("team_id").
		Where("id = ANY(CAST(? AS bigint[]))", idArray(productIDs)).
		Pluck("team_id", &teams).
		Error
	if err != nil {
		return err
	}

	if len(teams) == 0 {
		return nil
	}

	keys := make([]string, 0, len(teams))
	for _, team := range teams {
		keys = append(keys, productCodeLockKey(team))
	}

	// The fence (OFFSET 0) keeps the sort below the lock calls, so they run in key order.
	return db.
		Exec(`SELECT pg_advisory_xact_lock(k) FROM (
				SELECT DISTINCT hashtextextended(key, 0) AS k FROM unnest(CAST(? AS text[])) AS key
				ORDER BY k OFFSET 0
			) locks`, textArray(keys)).
		Error
}

// printedAs is whether any of the codes printed for a product is its live code.
func printedAs(printed []string, live string) bool {
	for _, code := range printed {
		if code == live {
			return true
		}
	}

	return false
}

func distinctIDs(ids []uint64) []uint64 {
	seen := make(map[uint64]bool, len(ids))
	out := make([]uint64, 0, len(ids))

	for _, id := range ids {
		if id == 0 || seen[id] {
			continue
		}

		seen[id] = true
		out = append(out, id)
	}

	return out
}

func sortIDs(ids []uint64) {
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
}

// textArray is a Postgres text[] literal of the strings, each quoted (a lock key holds `:` and `-`).
func textArray(values []string) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, `"`+strings.ReplaceAll(strings.ReplaceAll(v, `\`, `\\`), `"`, `\"`)+`"`)
	}

	return "{" + strings.Join(parts, ",") + "}"
}
