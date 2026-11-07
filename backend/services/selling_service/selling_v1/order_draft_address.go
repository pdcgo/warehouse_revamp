package selling_v1

import (
	"errors"

	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// A draft's ONE address row (one-address-per-order-and-per-draft): `order_draft_addresses`, written in the draft's own
// transaction and read beside it. NAMES ONLY (an-address-is-plain-names): the four region codes an OrderAddress may
// carry are discarded here, on push and on edit alike.

// setDraftAddress writes an OrderAddress's names onto the row — the region tiers, the postcode and the street line.
// The buyer's name and phone are their own fields (and touched marks), set by the caller.
func setDraftAddress(row *selling_service_models.OrderDraftAddress, address *sellingv1.OrderAddress) {
	row.ProvinsiName = address.GetProvinsiName()
	row.KabupatenName = address.GetKabupatenName()
	row.KecamatanName = address.GetKecamatanName()
	row.DesaName = address.GetDesaName()
	row.PostalCode = address.GetKodePos()
	row.AddressLine = address.GetAddressLine()
}

// loadDraftAddress reads the draft's row into draft.Address. A draft with none (a developer's row seeded without one)
// gets an empty, unsaved row, so a write through saveDraftAddress creates it rather than failing — the draft keeps one.
func loadDraftAddress(tx *gorm.DB, draft *selling_service_models.OrderDraft) error {
	var row selling_service_models.OrderDraftAddress

	err := tx.
		Where("order_draft_id = ?", draft.ID).
		Take(&row).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		draft.Address = &selling_service_models.OrderDraftAddress{OrderDraftID: draft.ID}

		return nil
	}

	if err != nil {
		return err
	}

	draft.Address = &row

	return nil
}

// saveDraftAddress writes draft.Address — an insert for a new row, an update of the one row otherwise.
func saveDraftAddress(tx *gorm.DB, draft *selling_service_models.OrderDraft) error {
	draft.Address.OrderDraftID = draft.ID

	return tx.Save(draft.Address).Error
}

// attachDraftAddresses fills each draft's Address in ONE query for the set (order_draft_addresses_draft_unique serves
// `order_draft_id IN`), so a page of drafts costs one more indexed read, never one per row. A draft with no row keeps a
// nil Address, which the mapper reads as an empty buyer and address.
func attachDraftAddresses(tx *gorm.DB, drafts []selling_service_models.OrderDraft) error {
	if len(drafts) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(drafts))
	for i := range drafts {
		ids = append(ids, drafts[i].ID)
	}

	var rows []selling_service_models.OrderDraftAddress

	err := tx.
		Where("order_draft_id IN ?", ids).
		Find(&rows).
		Error
	if err != nil {
		return err
	}

	byDraft := make(map[uint64]*selling_service_models.OrderDraftAddress, len(rows))
	for i := range rows {
		byDraft[rows[i].OrderDraftID] = &rows[i]
	}

	for i := range drafts {
		drafts[i].Address = byDraft[drafts[i].ID]
	}

	return nil
}
