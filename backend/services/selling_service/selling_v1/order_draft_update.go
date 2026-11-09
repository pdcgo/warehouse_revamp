package selling_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// A line id that belongs to another draft. Named rather than folded into NotFound: the caller asked
// about a draft that does exist, and "your draft is gone" would send somebody looking for the wrong
// problem entirely.
var errDraftLineForeign = errors.New("a line in this edit does not belong to this draft")

// OrderDraftUpdate is the person's edit, made in our UI (#193).
//
// ⚠ IT ALWAYS WINS, and marks every field it writes as TOUCHED. That mark is the whole mechanism by
// which OrderDraftPush knows what it may not overwrite — this handler and that one are two halves of
// one rule, and neither makes sense read alone.
//
// Presence, not emptiness, decides what was edited. A field left unset is neither written nor
// marked: if "unset" and "set to empty" were indistinguishable, the first save anybody made would
// mark every field touched and freeze the whole draft against the app forever.
func (s *Service) OrderDraftUpdate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftUpdateRequest],
) (*connect.Response[sellingv1.OrderDraftUpdateResponse], error) {
	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	// SETTING the draft's shop is a write on that shop (a-write-needs-a-grant-or-a-manager) — the same gate Promote
	// meets, asked here so a draft never holds a shop it could not become an order on. Clearing it (0) writes on none.
	if shopID := req.Msg.GetShopId(); req.Msg.ShopId != nil && shopID != 0 {
		err = s.refuseShopWrite(ctx, req.Msg.GetTeamId(), shopID)
		if err != nil {
			return nil, err
		}
	}

	var draft selling_service_models.OrderDraft

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// FOR UPDATE, because a push arriving mid-edit reads the touched set to decide what it may
		// write. Without the lock it could read the set from before this edit and overwrite the very
		// field being marked.
		findErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ? AND author_user_id = ?",
				req.Msg.GetDraftId(), req.Msg.GetTeamId(), authorID).
			Take(&draft).
			Error
		if findErr != nil {
			return findErr
		}

		return applyDraftEdit(tx, req.Msg, &draft)
	})

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, errDraftMissing)
	}

	if errors.Is(err, errDraftLineForeign) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errDraftLineForeign)
	}

	if err != nil {
		return nil, dbError(err)
	}

	out := draftToProto(&draft)
	out.ItemCount = uint32(len(draft.Items))

	return connect.NewResponse(&sellingv1.OrderDraftUpdateResponse{Draft: out}), nil
}

// applyDraftEdit writes the present fields and marks each one touched, in the draft's transaction.
func applyDraftEdit(
	tx *gorm.DB,
	msg *sellingv1.OrderDraftUpdateRequest,
	draft *selling_service_models.OrderDraft,
) error {
	touched := decodeTouched(draft.TouchedFields)
	updates := map[string]any{}

	// The buyer and the address are the draft's one address row, read under the draft's lock and written back whole.
	err := loadDraftAddress(tx, draft)
	if err != nil {
		return err
	}

	if msg.ShopId != nil {
		updates["shop_id"] = msg.GetShopId()
		draft.ShopID = msg.GetShopId()
		touched[draftFieldShopID] = true
	}

	if msg.WarehouseId != nil {
		updates["warehouse_id"] = msg.GetWarehouseId()
		draft.WarehouseID = msg.GetWarehouseId()
		touched[draftFieldWarehouseID] = true
	}

	if msg.CustomerName != nil {
		draft.Address.CustomerName = msg.GetCustomerName()
		touched[draftFieldCustomerName] = true
	}

	if msg.CustomerPhone != nil {
		draft.Address.CustomerPhone = msg.GetCustomerPhone()
		touched[draftFieldCustomerPhone] = true
	}

	// Trimmed (the-buyers-username-is-optional). "" — or spaces alone — clears it, and still marks it touched: a
	// person who emptied a wrong username has claimed the field as surely as one who corrected it.
	if msg.BuyerUsername != nil {
		draft.BuyerUsername = strings.TrimSpace(msg.GetBuyerUsername())
		updates["buyer_username"] = draft.BuyerUsername
		touched[draftFieldBuyerUsername] = true
	}

	// The address is one field, six names. Correcting a kecamatan claims the whole address, so the
	// app cannot later rewrite the other parts around somebody's fix. Names only: any codes sent are discarded.
	if address := msg.GetAddress(); address != nil {
		setDraftAddress(draft.Address, address)
		touched[draftFieldAddress] = true
	}

	err = saveDraftAddress(tx, draft)
	if err != nil {
		return err
	}

	if msg.ShipmentChannelId != nil {
		updates["shipment_channel_id"] = msg.GetShipmentChannelId()
		draft.ShipmentChannelID = msg.GetShipmentChannelId()
		touched[draftFieldShipmentChannel] = true
	}

	// What the buyer paid (platform-total-is-required-at-finalize). 0 clears it — and still marks it touched, as a
	// cleared date does.
	if msg.PlatformTotal != nil {
		updates["platform_total"] = msg.GetPlatformTotal()
		draft.PlatformTotal = msg.GetPlatformTotal()
		touched[draftFieldPlatformTotal] = true
	}

	// The platform's dates, as a person read them off the storefront. 0 clears one — and still marks it touched: a
	// person who emptied a wrong date has claimed the field as surely as one who corrected it.
	if msg.PlatformCreatedAtUnix != nil {
		draft.PlatformCreatedAt = timeOrNil(msg.GetPlatformCreatedAtUnix())
		updates["platform_created_at"] = draft.PlatformCreatedAt
		touched[draftFieldPlatformCreatedAt] = true
	}

	if msg.PlatformShipmentDeadlineUnix != nil {
		draft.PlatformShipmentDeadline = timeOrNil(msg.GetPlatformShipmentDeadlineUnix())
		updates["platform_shipment_deadline"] = draft.PlatformShipmentDeadline
		touched[draftFieldPlatformShipmentDeadline] = true
	}

	if msg.GetItems() != nil {
		err = applyDraftLines(tx, msg.GetItems().GetLines(), draft)
		if err != nil {
			return err
		}

		touched[draftFieldItems] = true
	}

	draft.TouchedFields = encodeTouched(touched)
	updates["touched_fields"] = draft.TouchedFields

	err = tx.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", draft.ID).
		Updates(withUpdatedAt(updates)).
		Error
	if err != nil {
		return err
	}

	// Reload the lines if this edit did not rewrite them, so the response carries the draft as it now
	// stands rather than one with a suspiciously empty line list.
	if msg.GetItems() != nil {
		return nil
	}

	return tx.
		Where("draft_id = ?", draft.ID).
		Order("id").
		Find(&draft.Items).
		Error
}

// applyDraftLines makes the draft's lines match the request exactly: existing ids are edited, id 0
// adds a line, and anything omitted is DELETED.
//
// The scraped text is never taken from the request — an existing line keeps the `external_sku` /
// `external_name` already stored, because that text is the evidence of what the buyer ordered. A
// request that could rewrite it could quietly make the evidence agree with a wrong mapping, which is
// the one failure keeping both halves on the line was meant to catch.
func applyDraftLines(
	tx *gorm.DB,
	edits []*sellingv1.OrderDraftLineEdit,
	draft *selling_service_models.OrderDraft,
) error {
	var existing []selling_service_models.OrderDraftItem

	err := tx.
		Where("draft_id = ?", draft.ID).
		Order("id").
		Find(&existing).
		Error
	if err != nil {
		return err
	}

	byID := map[uint64]*selling_service_models.OrderDraftItem{}
	for i := range existing {
		byID[existing[i].ID] = &existing[i]
	}

	kept := map[uint64]bool{}
	draft.Items = nil

	for _, edit := range edits {
		if edit.GetId() == 0 {
			// A line the scrape never saw. Its external text stays empty, which truthfully says
			// nobody scraped it — a person typed it in.
			draft.Items = append(draft.Items, selling_service_models.OrderDraftItem{
				DraftID:   draft.ID,
				Quantity:  edit.GetQuantity(),
				UnitPrice: edit.GetUnitPrice(),
			})

			continue
		}

		line, ok := byID[edit.GetId()]
		if !ok {
			return errDraftLineForeign
		}

		line.Quantity = edit.GetQuantity()
		line.UnitPrice = edit.GetUnitPrice()
		kept[line.ID] = true

		draft.Items = append(draft.Items, *line)
	}

	// Deletions first, so a draft never briefly holds both the old and the new set.
	var removed []uint64

	for i := range existing {
		if !kept[existing[i].ID] {
			removed = append(removed, existing[i].ID)
		}
	}

	if len(removed) > 0 {
		err = tx.
			Where("draft_id = ? AND id IN ?", draft.ID, removed).
			Delete(&selling_service_models.OrderDraftItem{}).
			Error
		if err != nil {
			return err
		}
	}

	for i := range draft.Items {
		// Save writes an update for a line that has an id and an insert for one that does not, which
		// is exactly the split above — an edited line keeps its identity, a new one gets a fresh one.
		err = tx.Save(&draft.Items[i]).Error
		if err != nil {
			return err
		}
	}

	return nil
}
