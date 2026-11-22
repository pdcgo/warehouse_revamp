package selling_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ORDER TAGS (backlog #100) — what every order tag RPC shares. The rules (docs/business/order/context_decision.md):
//
//   - orders-have-their-own-tag-list: the orders' OWN list (`order_tags`), apart from the restocks' in inventory — one
//     list for every team, a name unique within it; a restock tag is never offered here, and its name is free here;
//   - its 🔄 "A": the restock tags' rules on that list — a tag is SYSTEM or CUSTOM; a custom tag made and used by anyone
//     who may write on the order; the order's tags seen and tagged by its selling team AND the warehouse that ships it,
//     in every status, not by a monitor; system tags, rename and delete for Root / the Administrator only;
//   - its 🔄 "A" on app tags: no app-owned order tags — nothing here is locked for an admin.
//
// The admins' acts are their own request messages, policy [ROOT, ADMINISTRATOR] (order_tag.proto says why), so no
// handler here asks who the caller is beyond the scope's side.

const (
	orderTagSystem = "system"
	orderTagCustom = "custom"
)

var (
	errOrderTagMissing     = errors.New("order tag not found")
	errOrderTagNameEmpty   = errors.New("a tag needs a name")
	errOrderTagNameTaken   = errors.New("another order tag already carries this name")
	errOrderTagSystemAdmin = errors.New("a system tag is put on and taken off only by an admin")
	errOrderTagNotSystem   = errors.New("a custom tag goes on and comes off as any tag does — this is for system tags")
)

// cleanOrderTagName is a name as it is kept: trimmed, every run of white space folded to one space, the case as typed —
// "  lebaran   2026 " is "lebaran 2026". The database CHECKs this shape (00055).
func cleanOrderTagName(name string) string {
	return strings.Join(strings.Fields(name), " ")
}

// orderTagTypeToProto maps the stored word to the wire enum.
func orderTagTypeToProto(kind string) sellingv1.OrderTagType {
	switch kind {
	case orderTagSystem:
		return sellingv1.OrderTagType_ORDER_TAG_TYPE_SYSTEM
	case orderTagCustom:
		return sellingv1.OrderTagType_ORDER_TAG_TYPE_CUSTOM
	default:
		return sellingv1.OrderTagType_ORDER_TAG_TYPE_UNSPECIFIED
	}
}

func orderTagToProto(t *selling_service_models.OrderTag) *sellingv1.OrderTag {
	return &sellingv1.OrderTag{
		Id:   t.ID,
		Name: t.Name,
		Type: orderTagTypeToProto(t.Type),
	}
}

// orderTagOrder is every screen's order — the system's first, then by name, any case; the id breaks a tie.
const orderTagOrder = "(order_tags.type = 'system') DESC, lower(order_tags.name), order_tags.id"

// orderTagErr maps an order tag RPC's refusals; an order that is not the caller's is NotFound (mapOrderErr).
func orderTagErr(err error) error {
	switch {
	case errors.Is(err, errOrderTagMissing):
		return connect.NewError(connect.CodeNotFound, errOrderTagMissing)
	case errors.Is(err, errOrderTagNameEmpty), errors.Is(err, errOrderTagNotSystem):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errOrderTagNameTaken):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, errOrderTagSystemAdmin):
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		return mapOrderErr(err)
	}
}

// orderTagsOf is each order's tags, in every screen's order — ONE statement for a page of orders, on the key of
// `order_tag_links` (order_id, tag_id). An order with none is absent.
func orderTagsOf(db *gorm.DB, orderIDs []uint64) (map[uint64][]*sellingv1.OrderTag, error) {
	out := make(map[uint64][]*sellingv1.OrderTag, len(orderIDs))
	if len(orderIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		OrderID uint64
		TagID   uint64
		Name    string
		Type    string
	}

	err := db.
		Table("order_tag_links").
		Select("order_tag_links.order_id, order_tags.id AS tag_id, order_tags.name, order_tags.type").
		Joins("JOIN order_tags ON order_tags.id = order_tag_links.tag_id").
		Where("order_tag_links.order_id IN ?", orderIDs).
		Order("order_tag_links.order_id, " + orderTagOrder).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		out[row.OrderID] = append(out[row.OrderID], &sellingv1.OrderTag{
			Id:   row.TagID,
			Name: row.Name,
			Type: orderTagTypeToProto(row.Type),
		})
	}

	return out, nil
}

// withOrderTags fills `tags` on each order of a read's answer, in one statement.
func withOrderTags(db *gorm.DB, orders ...*sellingv1.Order) error {
	ids := make([]uint64, 0, len(orders))
	for _, o := range orders {
		ids = append(ids, o.GetId())
	}

	tags, err := orderTagsOf(db, ids)
	if err != nil {
		return err
	}

	for _, o := range orders {
		o.Tags = tags[o.GetId()]
	}

	return nil
}

// withListTags fills `tags` on the orders of OrderList's ORDER slice — the page's, in one statement.
func withListTags(db *gorm.DB, items []*sellingv1.OrderListResponseItem) error {
	var orders []*sellingv1.Order

	for _, item := range items {
		for _, o := range item.GetOrder().GetMapData() {
			orders = append(orders, o)
		}
	}

	if len(orders) == 0 {
		return nil
	}

	return withOrderTags(db, orders...)
}

// orderOnSide is the order `orderID` when the caller's team is one of its two sides — the selling team that placed it
// or the warehouse that ships it — else gorm.ErrRecordNotFound (NotFound: another team's order reads as one that does
// not exist, as OrderNoteCreate answers). The root team is neither side of any order. No lock: putting a tag on writes
// no column of the order, and the two columns read never change once the order is placed.
func orderOnSide(tx *gorm.DB, orderID, teamID uint64) error {
	var id uint64

	err := tx.
		Model(&selling_service_models.Order{}).
		Select("id").
		Where("id = ? AND (team_id = ? OR warehouse_id = ?)", orderID, teamID, teamID).
		Take(&id).
		Error
	if err != nil {
		return err
	}

	return nil
}

// orderTagHeld is the tag `tagID` read FOR KEY SHARE — the lock the tag keeps while it is put on, so a delete (which
// locks it FOR UPDATE first) waits for the put-on to commit and then takes it off too; never a link left pointing at a
// deleted tag. errOrderTagMissing when there is none.
func orderTagHeld(tx *gorm.DB, tagID uint64) (*selling_service_models.OrderTag, error) {
	var tag selling_service_models.OrderTag

	err := tx.
		Clauses(clause.Locking{Strength: "KEY SHARE"}).
		Where("id = ?", tagID).
		Take(&tag).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errOrderTagMissing
	}

	if err != nil {
		return nil, err
	}

	return &tag, nil
}

// orderTagHand is which kind of hand moves a tag: the team RPCs move a CUSTOM tag; the admins' RPCs a SYSTEM tag.
type orderTagHand int

const (
	orderTagHandTeam orderTagHand = iota
	orderTagHandAdmin
)

// mayMoveOrderTag answers whether `hand` may put `tag` on or take it off.
func mayMoveOrderTag(tag *selling_service_models.OrderTag, hand orderTagHand) error {
	if hand == orderTagHandTeam {
		// A team's user — and an admin through the team's RPC — moves a custom tag only; a system tag is the admins'
		// RPC's to take.
		if tag.Type != orderTagCustom {
			return errOrderTagSystemAdmin
		}

		return nil
	}

	if tag.Type != orderTagSystem {
		return errOrderTagNotSystem
	}

	return nil
}

// setOrderTag puts `tagID` on the order (on = true) or takes it off, for the caller's side — every status
// (orders-have-their-own-tag-list, its 🔄 "A"). A tag already on, or not on, is no change. Answers the order's tags
// after, in every screen's order.
func (s *Service) setOrderTag(
	ctx context.Context,
	teamID, orderID, tagID uint64,
	hand orderTagHand,
	on bool,
) ([]*sellingv1.OrderTag, error) {
	actor := eventActor(ctx)
	override := eventOverride(ctx)

	var tags []*sellingv1.OrderTag

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		sideErr := orderOnSide(tx, orderID, teamID)
		if sideErr != nil {
			return sideErr
		}

		tag, heldErr := orderTagHeld(tx, tagID)
		if heldErr != nil {
			return heldErr
		}

		moveErr := mayMoveOrderTag(tag, hand)
		if moveErr != nil {
			return moveErr
		}

		var writeErr error

		if on {
			writeErr = tx.
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&selling_service_models.OrderTagLink{
					OrderID:           orderID,
					TagID:             tagID,
					AddedByUserID:     actor,
					AddedByIsOverride: override,
					AddedAt:           time.Now(),
				}).
				Error
		} else {
			writeErr = tx.
				Where("order_id = ? AND tag_id = ?", orderID, tagID).
				Delete(&selling_service_models.OrderTagLink{}).
				Error
		}

		if writeErr != nil {
			return writeErr
		}

		byOrder, readErr := orderTagsOf(tx, []uint64{orderID})
		if readErr != nil {
			return readErr
		}

		tags = byOrder[orderID]

		return nil
	})
	if err != nil {
		return nil, err
	}

	return tags, nil
}

// orderTagList is the orders' list, `q` narrowing it to names containing it (any case, spaces folded), in every
// screen's order, paged — OrderTagList's answer, and with `counted` the admins' OrderTagManageList's: each tag's order
// count beside it, every team's, one aggregate over `order_tag_links` for the page.
func orderTagList(
	db *gorm.DB,
	q string,
	page *commonv1.CommonPagination,
	counted bool,
) ([]*sellingv1.OrderTag, *commonv1.PageInfo, error) {
	query := db.Model(&selling_service_models.OrderTag{})

	term := cleanOrderTagName(q)
	if term != "" {
		query = query.Where(`lower(order_tags.name) LIKE ? ESCAPE '\'`, "%"+likeEscaper.Replace(strings.ToLower(term))+"%")
	}

	var total int64

	err := query.
		Count(&total).
		Error
	if err != nil {
		return nil, nil, err
	}

	var rows []selling_service_models.OrderTag

	err = query.
		Order(orderTagOrder).
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, nil, err
	}

	info := &commonv1.PageInfo{
		CurrentPage: page.GetPage(),
		TotalPage:   totalPages(total, page.GetLimit()),
		TotalItems:  uint64(total),
	}

	out := make([]*sellingv1.OrderTag, 0, len(rows))
	ids := make([]uint64, 0, len(rows))

	for i := range rows {
		out = append(out, orderTagToProto(&rows[i]))
		ids = append(ids, rows[i].ID)
	}

	if !counted || len(ids) == 0 {
		return out, info, nil
	}

	var counts []struct {
		TagID uint64
		N     uint64
	}

	err = db.
		Table("order_tag_links").
		Select("tag_id, count(*) AS n").
		Where("tag_id IN ?", ids).
		Group("tag_id").
		Scan(&counts).
		Error
	if err != nil {
		return nil, nil, err
	}

	byTag := make(map[uint64]uint64, len(counts))
	for _, c := range counts {
		byTag[c.TagID] = c.N
	}

	for _, t := range out {
		t.OrderCount = byTag[t.GetId()]
	}

	return out, info, nil
}

// createOrderTag makes an order tag of `kind`, or answers the one that already carries the name (any case, spaces
// folded) — ONE NAME, ONE TAG within the orders' list. Two makes of one new name at the same second meet on the unique
// index: one inserts, the other's ON CONFLICT waits for it and then reads it — one tag, never a twin, never an error.
// `created` is false when the answer is an existing tag.
func (s *Service) createOrderTag(ctx context.Context, name, kind string) (*sellingv1.OrderTag, bool, error) {
	clean := cleanOrderTagName(name)
	if clean == "" {
		return nil, false, errOrderTagNameEmpty
	}

	actor := eventActor(ctx)
	override := eventOverride(ctx)
	db := s.db.WithContext(ctx)

	// A tag deleted between the conflict and the read leaves nothing to answer: try again, a few times.
	for range 3 {
		var made []selling_service_models.OrderTag

		err := db.Raw(`
			INSERT INTO order_tags (name, type, created_by_user_id, created_by_is_override, created_at, updated_at)
			VALUES (?, ?, ?, ?, NOW(), NOW())
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
			return orderTagToProto(&made[0]), true, nil
		}

		var existing []selling_service_models.OrderTag

		err = db.
			Where("lower(name) = lower(?)", clean).
			Limit(1).
			Find(&existing).
			Error
		if err != nil {
			return nil, false, err
		}

		if len(existing) == 1 {
			return orderTagToProto(&existing[0]), false, nil
		}
	}

	return nil, false, errOrderTagMissing
}
