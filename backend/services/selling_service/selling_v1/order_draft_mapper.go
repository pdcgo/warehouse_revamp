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
	draftFieldShopID        = "shop_id"
	draftFieldWarehouseID   = "warehouse_id"
	draftFieldCustomerName  = "customer_name"
	draftFieldCustomerPhone = "customer_phone"
	draftFieldAddress       = "address"
	draftFieldShippingCode  = "shipping_code"
	draftFieldShippingCost  = "shipping_cost"
	draftFieldItems         = "items"
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

// draftItemModels builds the line rows from a push.
//
// product_id is deliberately NOT read: the app does not know our catalogue ids, and a client
// matching titles against our catalogue on its own would guess wrong silently (§6.4). Mapping is a
// human act, performed through OrderDraftUpdate. Same instinct as OrderItem's unit_cost, which
// orderItemModels ignores for the same reason — a client must not write the numbers that decide
// what the record means.
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

	return &sellingv1.OrderDraft{
		Id:            d.ID,
		TeamId:        d.TeamID,
		AuthorUserId:  d.AuthorUserID,
		Source:        d.Source,
		ExternalId:    d.ExternalID,
		TouchedFields: names,
		ShopId:        d.ShopID,
		WarehouseId:   d.WarehouseID,
		CustomerName:  d.CustomerName,
		CustomerPhone: d.CustomerPhone,
		Address: &sellingv1.OrderAddress{
			ProvinsiCode:  d.ProvinsiCode,
			ProvinsiName:  d.ProvinsiName,
			KabupatenCode: d.KabupatenCode,
			KabupatenName: d.KabupatenName,
			KecamatanCode: d.KecamatanCode,
			KecamatanName: d.KecamatanName,
			DesaCode:      d.DesaCode,
			DesaName:      d.DesaName,
			KodePos:       d.KodePos,
			AddressLine:   d.AddressLine,
		},
		ShippingCode:  d.ShippingCode,
		ShippingCost:  d.ShippingCost,
		Items:         draftItemsToProto(d.Items),
		CreatedAtUnix: d.CreatedAt.Unix(),
		UpdatedAtUnix: d.UpdatedAt.Unix(),
	}
}

func draftItemsToProto(items []selling_service_models.OrderDraftItem) []*sellingv1.OrderDraftItem {
	out := make([]*sellingv1.OrderDraftItem, 0, len(items))

	for i := range items {
		out = append(out, &sellingv1.OrderDraftItem{
			Id:           items[i].ID,
			ExternalSku:  items[i].ExternalSKU,
			ExternalName: items[i].ExternalName,
			ProductId:    items[i].ProductID,
			Quantity:     items[i].Quantity,
			UnitPrice:    items[i].UnitPrice,
		})
	}

	return out
}
