package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// A draft must know whose it is. Unlike an expense's `created_by`, this is not decoration: the list
// narrows to the author, so a draft written with author 0 would appear in nobody's list — pushed
// successfully and then invisible. Refusing is the honest answer.
var errDraftNoAuthor = errors.New("a draft must have an author — no identity on the request")

// OrderDraftPush is the third-party app's intake (#191). CREATE-OR-UPDATE on
// (team_id, source, external_id), writing UNTOUCHED FIELDS ONLY.
//
// The two halves, and why they are one RPC:
//
//   - Idempotent on the external ref. An external caller on a flaky network WILL retry, and without
//     the dedupe key one bad connection quietly fills somebody's list with near-identical drafts.
//   - Yields to a human. Fields a person has edited through OrderDraftUpdate are left exactly as they
//     are, so a background re-scrape can never destroy ten minutes of mapping work.
//
// The app and the person authenticate as the same user, so identity cannot tell them apart — the RPC
// name is the whole distinction. This one yields; OrderDraftUpdate wins.
//
// ⚠ It publishes NOTHING. Placement fires OrderCreatedEvent (#153) and revenue consumes it (#75); a
// draft that published would put an unfinished scrape into the month's margin.
func (s *Service) OrderDraftPush(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftPushRequest],
) (*connect.Response[sellingv1.OrderDraftPushResponse], error) {
	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	draft, created, err := s.pushDraft(ctx, req.Msg, authorID)
	if err != nil {
		// Two pushes of the same external ref arriving together: both find nothing and both insert,
		// and one loses on the unique index. Losing that race means the draft EXISTS now, which is
		// precisely what the caller asked for — so run again and take the update path rather than
		// handing a retryable RPC an error it would only retry into the same answer.
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			draft, created, err = s.pushDraft(ctx, req.Msg, authorID)
		}

		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	return connect.NewResponse(&sellingv1.OrderDraftPushResponse{
		Draft:   draftToProto(draft),
		Created: created,
	}), nil
}

// pushDraft is the create-or-update itself, in one transaction. Split out so the duplicate-key race
// above can simply run it again.
func (s *Service) pushDraft(
	ctx context.Context,
	msg *sellingv1.OrderDraftPushRequest,
	authorID uint64,
) (*selling_service_models.OrderDraft, bool, error) {
	var (
		draft   selling_service_models.OrderDraft
		created bool
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// FOR UPDATE, because the merge is read-then-write: two pushes of the same draft would
		// otherwise both read the touched set, both decide a field is free, and the later one would
		// win over an edit that landed between them.
		findErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("team_id = ? AND source = ? AND external_id = ?",
				msg.GetTeamId(), msg.GetSource(), msg.GetExternalId()).
			Take(&draft).
			Error

		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			created = true

			return createDraft(tx, msg, authorID, &draft)
		}

		if findErr != nil {
			return findErr
		}

		return mergeDraft(tx, msg, authorID, &draft)
	})
	if err != nil {
		return nil, false, err
	}

	return &draft, created, nil
}

// createDraft writes a draft that did not exist. Nothing is touched yet, so every field the app sent
// is taken as-is.
func createDraft(
	tx *gorm.DB,
	msg *sellingv1.OrderDraftPushRequest,
	authorID uint64,
	draft *selling_service_models.OrderDraft,
) error {
	address := msg.GetAddress()

	*draft = selling_service_models.OrderDraft{
		TeamID:        msg.GetTeamId(),
		AuthorUserID:  authorID,
		Source:        msg.GetSource(),
		ExternalID:    msg.GetExternalId(),
		TouchedFields: "[]",
		ShopID:        msg.GetShopId(),
		WarehouseID:   msg.GetWarehouseId(),
		CustomerName:  msg.GetCustomerName(),
		CustomerPhone: msg.GetCustomerPhone(),
		ProvinsiCode:  address.GetProvinsiCode(),
		ProvinsiName:  address.GetProvinsiName(),
		KabupatenCode: address.GetKabupatenCode(),
		KabupatenName: address.GetKabupatenName(),
		KecamatanCode: address.GetKecamatanCode(),
		KecamatanName: address.GetKecamatanName(),
		DesaCode:      address.GetDesaCode(),
		DesaName:      address.GetDesaName(),
		KodePos:       address.GetKodePos(),
		AddressLine:   address.GetAddressLine(),
		ShippingCode:  msg.GetShippingCode(),
		ShippingCost:  msg.GetShippingCost(),
		Items:         draftItemModels(msg.GetItems()),
	}

	return tx.Create(draft).Error
}

// mergeDraft applies a re-push to a draft that already exists — the blanks-only rule (§6.5).
//
// Field by field: a name in `touched_fields` is skipped entirely, everything else takes what the app
// sent. Note this is NOT "fill only what is empty" — an untouched field the app has changed its mind
// about is genuinely updated, because the app is the authority on everything nobody here has claimed.
func mergeDraft(
	tx *gorm.DB,
	msg *sellingv1.OrderDraftPushRequest,
	authorID uint64,
	draft *selling_service_models.OrderDraft,
) error {
	touched := decodeTouched(draft.TouchedFields)

	// The author follows the push (§6.3). A draft is personal and a colleague cannot pick one up, so
	// re-pushing under the right person's login is the ONLY way to hand a draft over — making this
	// the escape hatch that "personal" leans on, rather than an accident.
	updates := map[string]any{"author_user_id": authorID}
	draft.AuthorUserID = authorID

	if !touched[draftFieldShopID] {
		updates["shop_id"] = msg.GetShopId()
		draft.ShopID = msg.GetShopId()
	}

	if !touched[draftFieldWarehouseID] {
		updates["warehouse_id"] = msg.GetWarehouseId()
		draft.WarehouseID = msg.GetWarehouseId()
	}

	if !touched[draftFieldCustomerName] {
		updates["customer_name"] = msg.GetCustomerName()
		draft.CustomerName = msg.GetCustomerName()
	}

	if !touched[draftFieldCustomerPhone] {
		updates["customer_phone"] = msg.GetCustomerPhone()
		draft.CustomerPhone = msg.GetCustomerPhone()
	}

	// The address is ONE field for this purpose, not ten. Somebody who corrects a kecamatan has
	// corrected the address — letting a re-scrape rewrite the other nine columns around their fix
	// would leave a hybrid address that was never true anywhere.
	if !touched[draftFieldAddress] {
		address := msg.GetAddress()

		updates["provinsi_code"] = address.GetProvinsiCode()
		updates["provinsi_name"] = address.GetProvinsiName()
		updates["kabupaten_code"] = address.GetKabupatenCode()
		updates["kabupaten_name"] = address.GetKabupatenName()
		updates["kecamatan_code"] = address.GetKecamatanCode()
		updates["kecamatan_name"] = address.GetKecamatanName()
		updates["desa_code"] = address.GetDesaCode()
		updates["desa_name"] = address.GetDesaName()
		updates["kode_pos"] = address.GetKodePos()
		updates["address_line"] = address.GetAddressLine()

		draft.ProvinsiCode = address.GetProvinsiCode()
		draft.ProvinsiName = address.GetProvinsiName()
		draft.KabupatenCode = address.GetKabupatenCode()
		draft.KabupatenName = address.GetKabupatenName()
		draft.KecamatanCode = address.GetKecamatanCode()
		draft.KecamatanName = address.GetKecamatanName()
		draft.DesaCode = address.GetDesaCode()
		draft.DesaName = address.GetDesaName()
		draft.KodePos = address.GetKodePos()
		draft.AddressLine = address.GetAddressLine()
	}

	if !touched[draftFieldShippingCode] {
		updates["shipping_code"] = msg.GetShippingCode()
		draft.ShippingCode = msg.GetShippingCode()
	}

	if !touched[draftFieldShippingCost] {
		updates["shipping_cost"] = msg.GetShippingCost()
		draft.ShippingCost = msg.GetShippingCost()
	}

	err := tx.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", draft.ID).
		Updates(withUpdatedAt(updates)).
		Error
	if err != nil {
		return err
	}

	// The lines are replaced wholesale, or not at all. Untouched means no human mapping exists to
	// lose, so the app's latest scrape simply replaces what its previous one said — including lines
	// it no longer sees, which is how a removed line disappears rather than lingering.
	if touched[draftFieldItems] {
		return tx.
			Where("draft_id = ?", draft.ID).
			Order("id").
			Find(&draft.Items).
			Error
	}

	err = tx.
		Where("draft_id = ?", draft.ID).
		Delete(&selling_service_models.OrderDraftItem{}).
		Error
	if err != nil {
		return err
	}

	draft.Items = draftItemModels(msg.GetItems())
	if len(draft.Items) == 0 {
		return nil
	}

	for i := range draft.Items {
		draft.Items[i].DraftID = draft.ID
	}

	return tx.Create(&draft.Items).Error
}
