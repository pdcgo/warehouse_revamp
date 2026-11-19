package inventory_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RESTOCK TAGS (backlog #87) — what every tag RPC shares. The rules (docs/business/inventory/restock_decision.md):
//
//   - a-restock-tag-is-system-or-custom: a tag is SYSTEM (the system's) or CUSTOM (anyone's who may tag);
//   - custom-tags-are-shared-system-tags-are-the-admins-and-the-apps: ONE app-wide list, a name unique across it, any
//     team's custom tag usable by every team; a system tag made / put on / taken off only by Root / the Administrator and
//     the app's own tasks; RENAME and DELETE are the admins' alone (its 🔄 line);
//   - a-restock-problem-is-a-system-tag: the app's *Barang kurang* / *Barang rusak*, put on by Terima — locked for
//     everyone, admins included (when a problem tag comes off waits on the problem's solution, not decided);
//   - the-restock-tags-prototype-is-accepted (+ the owner's 🔄 on Q2): a tag goes on and comes off in EVERY status.
//
// The admins' acts are their own request messages, policy [ROOT, ADMINISTRATOR] (restock_tag.proto says why), so no
// handler here asks who the caller is beyond the scope's side.

const (
	tagTypeSystem = "system"
	tagTypeCustom = "custom"

	// The app's own tasks that own a system tag — the problem tags Terima puts on (00055 seeds both).
	appTaskProblemMissing = "restock.problem.missing"
	appTaskProblemBroken  = "restock.problem.broken"
)

var (
	errTagMissing     = errors.New("tag not found")
	errTagNameEmpty   = errors.New("a tag needs a name")
	errTagNameTaken   = errors.New("another tag already carries this name")
	errTagSystemAdmin = errors.New("a system tag is put on and taken off only by an admin")
	errTagNotSystem   = errors.New("a custom tag goes on and comes off as any tag does — this is for system tags")
	errTagAppOwned    = errors.New("the app puts this tag on — nobody puts it on, takes it off, renames or deletes it by hand")
)

// cleanTagName is a name as it is kept: trimmed, every run of white space folded to one space, the case as typed —
// "  lebaran   2026 " is "lebaran 2026". The database CHECKs this shape (00055).
func cleanTagName(name string) string {
	return strings.Join(strings.Fields(name), " ")
}

// tagTypeToProto maps the stored word to the wire enum.
func tagTypeToProto(kind string) inventoryv1.RestockTagType {
	switch kind {
	case tagTypeSystem:
		return inventoryv1.RestockTagType_RESTOCK_TAG_TYPE_SYSTEM
	case tagTypeCustom:
		return inventoryv1.RestockTagType_RESTOCK_TAG_TYPE_CUSTOM
	default:
		return inventoryv1.RestockTagType_RESTOCK_TAG_TYPE_UNSPECIFIED
	}
}

func tagToProto(t *inventory_service_models.Tag) *inventoryv1.RestockTag {
	return &inventoryv1.RestockTag{
		Id:      t.ID,
		Name:    t.Name,
		Type:    tagTypeToProto(t.Type),
		AppTask: t.AppTask,
	}
}

// tagOrder is every screen's order — the system's first, then by name, any case; the id breaks a tie.
const tagOrder = "(tags.type = 'system') DESC, lower(tags.name), tags.id"

// tagErr maps a tag RPC's refusals; a restock's own fall through to restockErr.
func tagErr(err error) error {
	switch {
	case errors.Is(err, errTagMissing):
		return connect.NewError(connect.CodeNotFound, errTagMissing)
	case errors.Is(err, errTagNameEmpty), errors.Is(err, errTagNotSystem):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errTagNameTaken):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, errTagSystemAdmin):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, errTagAppOwned):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return restockErr(err)
	}
}

// restockTagsOf is each restock's tags, in every screen's order — ONE statement for a page of restocks, on the
// `restock_tags` key (restock_id, tag_id). A restock with none is absent.
func restockTagsOf(db *gorm.DB, restockIDs []uint64) (map[uint64][]*inventoryv1.RestockTag, error) {
	out := make(map[uint64][]*inventoryv1.RestockTag, len(restockIDs))
	if len(restockIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		RestockID uint64
		inventory_service_models.Tag
	}

	err := db.
		Table("restock_tags").
		Select("restock_tags.restock_id, tags.id, tags.name, tags.type, tags.app_task").
		Joins("JOIN tags ON tags.id = restock_tags.tag_id").
		Where("restock_tags.restock_id IN ?", restockIDs).
		Order("restock_tags.restock_id, " + tagOrder).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for i := range rows {
		out[rows[i].RestockID] = append(out[rows[i].RestockID], tagToProto(&rows[i].Tag))
	}

	return out, nil
}

// withRestockTags fills `tags` on each restock of a read's answer, in one statement.
func withRestockTags(db *gorm.DB, restocks ...*inventoryv1.RestockRequest) error {
	ids := make([]uint64, 0, len(restocks))
	for _, r := range restocks {
		ids = append(ids, r.GetId())
	}

	tags, err := restockTagsOf(db, ids)
	if err != nil {
		return err
	}

	for _, r := range restocks {
		r.Tags = tags[r.GetId()]
	}

	return nil
}

// restockOnSide is the restock `requestID` when the caller's team is one of its two sides — the selling team that
// raised it or the warehouse it goes to — else gorm.ErrRecordNotFound (NotFound: another team's restock must read as one
// that does not exist). No lock: putting a tag on writes no column of the restock, and the key of `restock_tags` already
// waits on a restock row another write holds.
func restockOnSide(tx *gorm.DB, requestID, teamID uint64) error {
	var id uint64

	err := tx.
		Model(&inventory_service_models.Restock{}).
		Select("id").
		Where("id = ? AND (team_id = ? OR warehouse_id = ?)", requestID, teamID, teamID).
		Take(&id).
		Error
	if err != nil {
		return err
	}

	return nil
}

// tagHeld is the tag `tagID` read FOR KEY SHARE — the lock the tag keeps while it is put on, so a delete (which locks it
// FOR UPDATE first) waits for the put-on to commit and then takes it off too; never a row left pointing at a deleted
// tag. errTagMissing when there is none.
func tagHeld(tx *gorm.DB, tagID uint64) (*inventory_service_models.Tag, error) {
	var tag inventory_service_models.Tag

	err := tx.
		Clauses(clause.Locking{Strength: "KEY SHARE"}).
		Where("id = ?", tagID).
		Take(&tag).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errTagMissing
	}

	if err != nil {
		return nil, err
	}

	return &tag, nil
}

// tagSide is which kind of hand may move a tag: the team RPCs move a CUSTOM tag; the admins' RPCs a SYSTEM tag that is
// not the app's. The app's own tags move by the app alone.
type tagSide int

const (
	tagSideTeam tagSide = iota
	tagSideAdmin
)

// mayMoveTag answers whether `side` may put `tag` on or take it off by hand.
func mayMoveTag(tag *inventory_service_models.Tag, side tagSide) error {
	if side == tagSideTeam {
		// A team's user — and an admin through the team's RPC — moves a custom tag only; a system tag, the app's
		// included, is the admins' RPC's to refuse or take.
		if tag.Type != tagTypeCustom {
			return errTagSystemAdmin
		}

		return nil
	}

	if tag.AppTask != "" {
		return errTagAppOwned
	}

	if tag.Type != tagTypeSystem {
		return errTagNotSystem
	}

	return nil
}

// setRestockTag puts `tagID` on the restock (on = true) or takes it off, for the caller's side — every status (the
// owner's 🔄 under the-restock-tags-prototype-is-accepted). A tag already on, or not on, is no change. Answers the
// restock's tags after, in every screen's order.
func (s *Service) setRestockTag(
	ctx context.Context,
	teamID, requestID, tagID uint64,
	side tagSide,
	on bool,
) ([]*inventoryv1.RestockTag, error) {
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	var tags []*inventoryv1.RestockTag

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		sideErr := restockOnSide(tx, requestID, teamID)
		if sideErr != nil {
			return sideErr
		}

		tag, heldErr := tagHeld(tx, tagID)
		if heldErr != nil {
			return heldErr
		}

		moveErr := mayMoveTag(tag, side)
		if moveErr != nil {
			return moveErr
		}

		var writeErr error

		if on {
			writeErr = tx.
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&inventory_service_models.RestockTag{
					RestockID:         requestID,
					TagID:             tagID,
					AddedByUserID:     actor,
					AddedByIsOverride: override,
					AddedAt:           time.Now(),
				}).
				Error
		} else {
			writeErr = tx.
				Where("restock_id = ? AND tag_id = ?", requestID, tagID).
				Delete(&inventory_service_models.RestockTag{}).
				Error
		}

		if writeErr != nil {
			return writeErr
		}

		byRestock, readErr := restockTagsOf(tx, []uint64{requestID})
		if readErr != nil {
			return readErr
		}

		tags = byRestock[requestID]

		return nil
	})
	if err != nil {
		return nil, err
	}

	return tags, nil
}

// putAppTags puts the app's own tags named by `tasks` on the restock, in the caller's transaction — Terima's problem
// tags (a-restock-problem-is-a-system-tag). Who: the app (0). A tag already on is no change. ONE statement.
func putAppTags(tx *gorm.DB, restockID uint64, at time.Time, tasks ...string) error {
	if len(tasks) == 0 {
		return nil
	}

	return tx.Exec(`
		INSERT INTO restock_tags (restock_id, tag_id, added_by_user_id, added_by_is_override, added_at)
		SELECT ?, tags.id, 0, false, ?
		FROM tags
		WHERE tags.app_task IN ?
		ON CONFLICT (restock_id, tag_id) DO NOTHING`,
		restockID, at, tasks,
	).Error
}

// tagList is the app-wide list, `q` narrowing it to names containing it (any case, spaces folded), in every screen's
// order, paged — RestockTagList's answer, and with `counted` the admins' RestockTagManageList's: each tag's restock
// count beside it, every team's, one aggregate over `restock_tags` for the page.
func tagList(db *gorm.DB, q string, page pager, counted bool) ([]*inventoryv1.RestockTag, int64, error) {
	query := db.Model(&inventory_service_models.Tag{})

	term := cleanTagName(q)
	if term != "" {
		query = query.Where(`lower(tags.name) LIKE ? ESCAPE '\'`, "%"+escapeLike(strings.ToLower(term))+"%")
	}

	var total int64

	err := query.
		Count(&total).
		Error
	if err != nil {
		return nil, 0, err
	}

	var rows []inventory_service_models.Tag

	err = query.
		Order(tagOrder).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, 0, err
	}

	out := make([]*inventoryv1.RestockTag, 0, len(rows))
	ids := make([]uint64, 0, len(rows))

	for i := range rows {
		out = append(out, tagToProto(&rows[i]))
		ids = append(ids, rows[i].ID)
	}

	if !counted || len(ids) == 0 {
		return out, total, nil
	}

	var counts []struct {
		TagID uint64
		N     uint64
	}

	err = db.
		Table("restock_tags").
		Select("tag_id, count(*) AS n").
		Where("tag_id IN ?", ids).
		Group("tag_id").
		Scan(&counts).
		Error
	if err != nil {
		return nil, 0, err
	}

	byTag := make(map[uint64]uint64, len(counts))
	for _, c := range counts {
		byTag[c.TagID] = c.N
	}

	for _, t := range out {
		t.RestockCount = byTag[t.GetId()]
	}

	return out, total, nil
}

// createTag makes a tag of `kind`, or answers the tag that already carries the name (any case, spaces folded) — ONE
// NAME, ONE TAG (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps). Two makes of one new name at the same
// second meet on the unique index: one inserts, the other's ON CONFLICT waits for it and then reads it — one tag, never
// a twin, never an error. `created` is false when the answer is an existing tag.
func (s *Service) createTag(ctx context.Context, name, kind string) (*inventoryv1.RestockTag, bool, error) {
	clean := cleanTagName(name)
	if clean == "" {
		return nil, false, errTagNameEmpty
	}

	actor := actorFrom(ctx)
	override := overrideFrom(ctx)
	db := s.db.WithContext(ctx)

	// A tag deleted between the conflict and the read leaves nothing to answer: try again, a few times.
	for range 3 {
		var made []inventory_service_models.Tag

		err := db.Raw(`
			INSERT INTO tags (name, type, app_task, created_by_user_id, created_by_is_override, created_at, updated_at)
			VALUES (?, ?, '', ?, ?, NOW(), NOW())
			ON CONFLICT ((lower(name))) DO NOTHING
			RETURNING *`,
			clean, kind, actor, override,
		).
			Scan(&made).
			Error
		if err != nil {
			return nil, false, err
		}

		if len(made) == 1 {
			return tagToProto(&made[0]), true, nil
		}

		var existing []inventory_service_models.Tag

		err = db.
			Where("lower(name) = lower(?)", clean).
			Limit(1).
			Find(&existing).
			Error
		if err != nil {
			return nil, false, err
		}

		if len(existing) == 1 {
			return tagToProto(&existing[0]), false, nil
		}
	}

	return nil, false, errTagMissing
}
