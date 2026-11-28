package product_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// PRODUCT TAGS (backlog #147, #141 P1a) — what every product tag RPC shares, a copy of the order tags (selling
// order_tags.go, backlog #100) with the restock tags' app-owned lock. The rules (docs/business/product/context_decision.md):
//
//   - products-have-their-own-tag-list: the products' OWN list (`product_tags`), apart from the orders' and the restocks'
//     — one list for every team, a name unique within it; a tag is SYSTEM or CUSTOM; a custom tag made and used by any
//     user who may WRITE on the product (ProductUpdate's roles, in the team that owns it); system tags, rename and delete
//     for Root / the Administrator only; the Products lists filter by tag, ANY of the picked;
//   - the first app-owned system tag, `need_reprint_code` (app task "product.code.reprint", seeded by 00010), is LOCKED
//     for everyone, admins included — never put on, taken off, renamed or deleted by hand, as the restock's problem tags
//     are (a-restock-problem-is-a-system-tag). The team code change puts it on (#149), the reprint takes it off (#151);
//   - its 🔄 *who sees*: the owning team and every warehouse holding the product's stock — so the tags ride ProductList's
//     rows, ProductDetail, SearchAmong (the warehouse's list, among the ids inventory holds) and ProductTagsByIds; never
//     ProductByIds or ProductDiscover.
//
// The admins' acts are their own request messages, policy [ROOT, ADMINISTRATOR] (product_tag.proto says why), so no
// handler here asks who the caller is beyond the scope's team.

const (
	productTagSystem = "system"
	productTagCustom = "custom"

	// AppTaskReprintCode is the app's own task that owns `need_reprint_code` (00010 seeds it): put on by the team code
	// change, taken off by the warehouses' reprint. Found by this, never by the tag's name.
	AppTaskReprintCode = "product.code.reprint"
)

var (
	errProductTagMissing     = errors.New("product tag not found")
	errProductTagNameEmpty   = errors.New("a tag needs a name")
	errProductTagNameTaken   = errors.New("another product tag already carries this name")
	errProductTagSystemAdmin = errors.New("a system tag is put on and taken off only by an admin")
	errProductTagNotSystem   = errors.New("a custom tag goes on and comes off as any tag does — this is for system tags")
	errProductTagAppOwned    = errors.New("the app puts this tag on — nobody puts it on, takes it off, renames or deletes it by hand")
	// errTagFilterIsTheLists is ProductDiscover refusing the tag filter: other teams see no tags (its 🔄 *who sees*), so
	// they filter by none — a filter would tell them which tags a product carries.
	errTagFilterIsTheLists = errors.New("the tag filter narrows a team's own product list only — other teams see no tags")
)

// cleanProductTagName is a name as it is kept: trimmed, every run of white space folded to one space, the case as typed
// — "  promo   lebaran " is "promo lebaran". The database CHECKs this shape (00010).
func cleanProductTagName(name string) string {
	return strings.Join(strings.Fields(name), " ")
}

// productTagTypeToProto maps the stored word to the wire enum.
func productTagTypeToProto(kind string) productv1.ProductTagType {
	switch kind {
	case productTagSystem:
		return productv1.ProductTagType_PRODUCT_TAG_TYPE_SYSTEM
	case productTagCustom:
		return productv1.ProductTagType_PRODUCT_TAG_TYPE_CUSTOM
	default:
		return productv1.ProductTagType_PRODUCT_TAG_TYPE_UNSPECIFIED
	}
}

func productTagToProto(t *product_service_models.ProductTag) *productv1.ProductTag {
	return &productv1.ProductTag{
		Id:      t.ID,
		Name:    t.Name,
		Type:    productTagTypeToProto(t.Type),
		AppTask: t.AppTask,
	}
}

// productTagOrder is every screen's order — the system's first, then by name, any case; the id breaks a tie.
const productTagOrder = "(product_tags.type = 'system') DESC, lower(product_tags.name), product_tags.id"

// productTagErr maps a product tag RPC's refusals; a product that is not the team's is NotFound, as ProductUpdate
// answers.
func productTagErr(err error) error {
	switch {
	case errors.Is(err, errProductTagMissing):
		return connect.NewError(connect.CodeNotFound, errProductTagMissing)
	case errors.Is(err, gorm.ErrRecordNotFound):
		return notFound()
	case errors.Is(err, errProductTagNameEmpty), errors.Is(err, errProductTagNotSystem):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errProductTagNameTaken):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, errProductTagSystemAdmin):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, errProductTagAppOwned):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// isUniqueViolation is a unique index refusing a write — GORM's translated error, or Postgres' own code when it comes
// back untranslated.
func isUniqueViolation(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}

	return false
}

// tagActor is who puts a tag on or makes one — the signed-in person, 0 with none (the app's own tasks write 0).
func tagActor(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

// productTagsOf is each product's tags, in every screen's order — ONE statement for a page of products, on the key of
// `product_tag_links` (product_id, tag_id). A product with none is absent.
func productTagsOf(db *gorm.DB, productIDs []uint64) (map[uint64][]*productv1.ProductTag, error) {
	out := make(map[uint64][]*productv1.ProductTag, len(productIDs))
	if len(productIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		ProductID uint64
		TagID     uint64
		Name      string
		Type      string
		AppTask   string
	}

	err := db.
		Table("product_tag_links").
		Select("product_tag_links.product_id, product_tags.id AS tag_id, product_tags.name, product_tags.type, product_tags.app_task").
		Joins("JOIN product_tags ON product_tags.id = product_tag_links.tag_id").
		Where("product_tag_links.product_id = ANY(CAST(? AS bigint[]))", idArray(productIDs)).
		Order("product_tag_links.product_id, " + productTagOrder).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		out[row.ProductID] = append(out[row.ProductID], &productv1.ProductTag{
			Id:      row.TagID,
			Name:    row.Name,
			Type:    productTagTypeToProto(row.Type),
			AppTask: row.AppTask,
		})
	}

	return out, nil
}

// withRowTags fills `tags` on product rows — a list page's, in one statement.
func withRowTags(db *gorm.DB, rows []*productv1.ProductRowItem) error {
	if len(rows) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.GetId())
	}

	tags, err := productTagsOf(db, ids)
	if err != nil {
		return err
	}

	for _, r := range rows {
		r.Tags = tags[r.GetId()]
	}

	return nil
}

// withListTags fills `tags` on the rows of a ProductList answer's PRODUCT slice (the owning team's list) — the page's, in
// one statement. A list asked for the GENERAL slice alone reads no tags.
func withListTags(db *gorm.DB, items []*productv1.ProductListResponseItem) error {
	var rows []*productv1.ProductRowItem

	for _, item := range items {
		for _, row := range item.GetProduct().GetMapData() {
			rows = append(rows, row)
		}
	}

	return withRowTags(db, rows)
}

// tagFilterClause is the lists' Tag filter — products carrying ANY of the tags (the-team-code-and-product-tags-prototype-
// is-accepted) — as one EXISTS on the links' key, the tag ids bound as ONE array. Applied inside a list's own scope, so
// its count, its sort and its paging describe the narrowed list.
func tagFilterClause(query *gorm.DB, tagIDs []uint64) *gorm.DB {
	if len(tagIDs) == 0 {
		return query
	}

	return query.Where(
		"EXISTS (SELECT 1 FROM product_tag_links l WHERE l.product_id = products.id AND l.tag_id = ANY(CAST(? AS bigint[])))",
		idArray(tagIDs),
	)
}

// productOfTeam holds the product `productID` of the team `teamID` — archived or not (the order tags' "every status") —
// FOR KEY SHARE, so a delete of the product waits for the tag to land and takes it with it (ON DELETE CASCADE); else
// gorm.ErrRecordNotFound (NotFound: another team's product reads as one that does not exist, as ProductUpdate answers).
func productOfTeam(tx *gorm.DB, productID, teamID uint64) error {
	var id uint64

	err := tx.
		Model(&product_service_models.Product{}).
		Clauses(clause.Locking{Strength: "KEY SHARE"}).
		Select("id").
		Where("id = ? AND team_id = ?", productID, teamID).
		Take(&id).
		Error
	if err != nil {
		return err
	}

	return nil
}

// productTagHeld is the tag `tagID` read FOR KEY SHARE — the lock the tag keeps while it is put on, so a delete (which
// locks it FOR UPDATE first) waits for the put-on to commit and then takes it off too; never a link left pointing at a
// deleted tag. errProductTagMissing when there is none.
func productTagHeld(tx *gorm.DB, tagID uint64) (*product_service_models.ProductTag, error) {
	var tag product_service_models.ProductTag

	err := tx.
		Clauses(clause.Locking{Strength: "KEY SHARE"}).
		Where("id = ?", tagID).
		Take(&tag).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errProductTagMissing
	}

	if err != nil {
		return nil, err
	}

	return &tag, nil
}

// productTagHand is which kind of hand moves a tag: the writers' RPCs move a CUSTOM tag; the admins' RPCs a SYSTEM tag.
// Nobody's hand moves the app's own.
type productTagHand int

const (
	productTagHandTeam productTagHand = iota
	productTagHandAdmin
)

// mayMoveProductTag answers whether `hand` may put `tag` on or take it off.
func mayMoveProductTag(tag *product_service_models.ProductTag, hand productTagHand) error {
	if hand == productTagHandTeam {
		// A writer — and an admin through the writers' RPC — moves a custom tag only; a system tag, the app's included,
		// is the admins' RPC's to refuse or take.
		if tag.Type != productTagCustom {
			return errProductTagSystemAdmin
		}

		return nil
	}

	if tag.AppTask != "" {
		return errProductTagAppOwned
	}

	if tag.Type != productTagSystem {
		return errProductTagNotSystem
	}

	return nil
}

// setProductTag puts `tagID` on the product (on = true) or takes it off, in the team that owns it — archived or not. A
// tag already on, or not on, is no change. Answers the product's tags after, in every screen's order.
func (s *Service) setProductTag(
	ctx context.Context,
	teamID, productID, tagID uint64,
	hand productTagHand,
	on bool,
) ([]*productv1.ProductTag, error) {
	actor := tagActor(ctx)
	override := san_auth.IsOverride(ctx)

	var tags []*productv1.ProductTag

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ownErr := productOfTeam(tx, productID, teamID)
		if ownErr != nil {
			return ownErr
		}

		tag, heldErr := productTagHeld(tx, tagID)
		if heldErr != nil {
			return heldErr
		}

		moveErr := mayMoveProductTag(tag, hand)
		if moveErr != nil {
			return moveErr
		}

		var writeErr error

		if on {
			writeErr = tx.
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&product_service_models.ProductTagLink{
					ProductID:         productID,
					TagID:             tagID,
					AddedByUserID:     actor,
					AddedByIsOverride: override,
					AddedAt:           time.Now(),
				}).
				Error
		} else {
			writeErr = tx.
				Where("product_id = ? AND tag_id = ?", productID, tagID).
				Delete(&product_service_models.ProductTagLink{}).
				Error
		}

		if writeErr != nil {
			return writeErr
		}

		byProduct, readErr := productTagsOf(tx, []uint64{productID})
		if readErr != nil {
			return readErr
		}

		tags = byProduct[productID]

		return nil
	})
	if err != nil {
		return nil, err
	}

	return tags, nil
}

// productTagList is the products' list, `q` narrowing it to names containing it (any case, spaces folded), in every
// screen's order, paged — ProductTagList's answer, and with `counted` the admins' ProductTagManageList's: each tag's
// product count beside it, every team's, one aggregate over `product_tag_links` for the page.
func productTagList(
	db *gorm.DB,
	q string,
	page *commonv1.CommonPagination,
	counted bool,
) ([]*productv1.ProductTag, *commonv1.PageInfo, error) {
	query := db.Model(&product_service_models.ProductTag{})

	term := cleanProductTagName(q)
	if term != "" {
		query = query.Where(`lower(product_tags.name) LIKE ? ESCAPE '\'`, "%"+escapeLike(strings.ToLower(term))+"%")
	}

	var total int64

	err := query.
		Count(&total).
		Error
	if err != nil {
		return nil, nil, err
	}

	var rows []product_service_models.ProductTag

	err = query.
		Order(productTagOrder).
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

	out := make([]*productv1.ProductTag, 0, len(rows))
	ids := make([]uint64, 0, len(rows))

	for i := range rows {
		out = append(out, productTagToProto(&rows[i]))
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
		Table("product_tag_links").
		Select("tag_id, count(*) AS n").
		Where("tag_id = ANY(CAST(? AS bigint[]))", idArray(ids)).
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
		t.ProductCount = byTag[t.GetId()]
	}

	return out, info, nil
}

// createProductTag makes a product tag of `kind`, or answers the one that already carries the name (any case, spaces
// folded) — ONE NAME, ONE TAG within the products' list, the app's own included. Two makes of one new name at the same
// second meet on the unique index: one inserts, the other's ON CONFLICT waits for it and then reads it — one tag, never
// a twin, never an error. `created` is false when the answer is an existing tag. Never an app task: only a migration
// seeds an app's tag.
func (s *Service) createProductTag(ctx context.Context, name, kind string) (*productv1.ProductTag, bool, error) {
	clean := cleanProductTagName(name)
	if clean == "" {
		return nil, false, errProductTagNameEmpty
	}

	actor := tagActor(ctx)
	override := san_auth.IsOverride(ctx)
	db := s.db.WithContext(ctx)

	// A tag deleted between the conflict and the read leaves nothing to answer: try again, a few times.
	for range 3 {
		var made []product_service_models.ProductTag

		err := db.Raw(`
			INSERT INTO product_tags (name, type, created_by_user_id, created_by_is_override, created_at, updated_at)
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
			return productTagToProto(&made[0]), true, nil
		}

		var existing []product_service_models.ProductTag

		err = db.
			Where("lower(name) = lower(?)", clean).
			Limit(1).
			Find(&existing).
			Error
		if err != nil {
			return nil, false, err
		}

		if len(existing) == 1 {
			return productTagToProto(&existing[0]), false, nil
		}
	}

	return nil, false, errProductTagMissing
}

// lockedTagForAdmin reads the tag `tagID` FOR UPDATE for an admin's rename or delete — refusing the app's own (locked
// for everyone, admins included). errProductTagMissing when there is none.
func lockedTagForAdmin(tx *gorm.DB, tagID uint64) (*product_service_models.ProductTag, error) {
	var tag product_service_models.ProductTag

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", tagID).
		Take(&tag).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errProductTagMissing
	}

	if err != nil {
		return nil, err
	}

	if tag.AppTask != "" {
		return nil, errProductTagAppOwned
	}

	return &tag, nil
}
