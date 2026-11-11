package selling_v1

import (
	"encoding/json"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The names that may appear in a draft's `touched_fields` (§6.5). They are the field names of the
// request, and they are what OrderDraftPush consults before writing anything.
//
// `items` is ONE name for the whole line set, not one per line. Per-line merging would need a
// per-line touched mark, and the rule that actually matters — a re-scrape never destroys a mapping —
// holds without it: once somebody has touched the lines, the app stops rewriting them at all.
const (
	draftFieldShopID          = "shop_id"
	draftFieldWarehouseID     = "warehouse_id"
	draftFieldCustomerName    = "customer_name"
	draftFieldCustomerPhone   = "customer_phone"
	draftFieldAddress         = "address"
	draftFieldShipmentChannel = "shipment_channel_id"
	draftFieldItems           = "items"
	// The platform's two dates, each its own field: correcting the order date says nothing about the deadline.
	draftFieldPlatformCreatedAt        = "platform_created_at_unix"
	draftFieldPlatformShipmentDeadline = "platform_shipment_deadline_unix"
	draftFieldBuyerUsername            = "buyer_username"
	draftFieldPlatformTotal            = "platform_total"
)

// decodeTouched reads the jsonb column into a set.
//
// A column that will not parse yields an EMPTY set, not an error. The consequence of guessing wrong
// here is asymmetric: an unreadable mark read as "touched" would freeze a draft nobody can ever
// refresh, while read as "untouched" the worst case is one push overwriting a field. Neither is
// good, and the recoverable one is preferred — but it should not happen at all, since only this
// service writes the column.
func decodeTouched(raw string) map[string]bool {
	touched := map[string]bool{}

	if raw == "" {
		return touched
	}

	var names []string

	err := json.Unmarshal([]byte(raw), &names)
	if err != nil {
		return touched
	}

	for _, name := range names {
		touched[name] = true
	}

	return touched
}

// encodeTouched writes the set back as a stable, sorted JSON array — sorted so an unchanged set
// produces an unchanged column, which keeps a diff of the row honest.
func encodeTouched(touched map[string]bool) string {
	names := make([]string, 0, len(touched))

	for name, on := range touched {
		if on {
			names = append(names, name)
		}
	}

	sortStrings(names)

	data, err := json.Marshal(names)
	if err != nil {
		return "[]"
	}

	return string(data)
}

// sortStrings is an insertion sort over a handful of field names — small enough that pulling in
// `sort` for it would be the heavier choice.
func sortStrings(names []string) {
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
}

// draftItemModels builds the line rows from a push — the platform's reference only. A draft stores no mapping
// (a-draft-stores-no-mapping): the CS maps each line in the order form, straight into the order's lines.
func draftItemModels(items []*sellingv1.OrderDraftItem) []selling_service_models.OrderDraftItem {
	models := make([]selling_service_models.OrderDraftItem, 0, len(items))

	for _, item := range items {
		models = append(models, selling_service_models.OrderDraftItem{
			ExternalSKU:  item.GetExternalSku(),
			ExternalName: item.GetExternalName(),
			Quantity:     item.GetQuantity(),
			UnitPrice:    item.GetUnitPrice(),
		})
	}

	return models
}

func draftToProto(d *selling_service_models.OrderDraft) *sellingv1.OrderDraft {
	touched := decodeTouched(d.TouchedFields)

	names := make([]string, 0, len(touched))
	for name := range touched {
		names = append(names, name)
	}

	sortStrings(names)

	// The buyer and the address from the draft's one address row, NAMES only — the codes stay empty
	// (an-address-is-plain-names). No row loaded reads as an empty buyer and address.
	address := d.Address
	if address == nil {
		address = &selling_service_models.OrderDraftAddress{}
	}

	return &sellingv1.OrderDraft{
		Id:           d.ID,
		TeamId:       d.TeamID,
		AuthorUserId: d.AuthorUserID,
		// Whether the last push was an override — the "by Root team" badge beside the author.
		IsOverride:    d.IsOverride,
		Source:        d.Source,
		ExternalId:    d.ExternalID,
		TouchedFields: names,
		ShopId:        d.ShopID,
		WarehouseId:   d.WarehouseID,
		CustomerName:  address.CustomerName,
		CustomerPhone: address.CustomerPhone,
		Address: &sellingv1.OrderAddress{
			ProvinsiName:  address.ProvinsiName,
			KabupatenName: address.KabupatenName,
			KecamatanName: address.KecamatanName,
			DesaName:      address.DesaName,
			KodePos:       address.PostalCode,
			AddressLine:   address.AddressLine,
		},
		ShipmentChannelId: d.ShipmentChannelID,
		Items:             draftItemsToProto(d.Items),
		CreatedAtUnix:     d.CreatedAt.Unix(),
		UpdatedAtUnix:     d.UpdatedAt.Unix(),
		// The platform's two dates; 0 = not known yet.
		PlatformCreatedAtUnix:        unixOrZero(d.PlatformCreatedAt),
		PlatformShipmentDeadlineUnix: unixOrZero(d.PlatformShipmentDeadline),
		// The buyer's marketplace username; "" = not known, which is allowed.
		BuyerUsername: d.BuyerUsername,
		// What the buyer paid; 0 = not known yet, which Promote refuses.
		PlatformTotal: d.PlatformTotal,
	}
}

func draftItemsToProto(items []selling_service_models.OrderDraftItem) []*sellingv1.OrderDraftItem {
	out := make([]*sellingv1.OrderDraftItem, 0, len(items))

	for i := range items {
		out = append(out, &sellingv1.OrderDraftItem{
			Id:           items[i].ID,
			ExternalSku:  items[i].ExternalSKU,
			ExternalName: items[i].ExternalName,
			Quantity:     items[i].Quantity,
			UnitPrice:    items[i].UnitPrice,
		})
	}

	return out
}
