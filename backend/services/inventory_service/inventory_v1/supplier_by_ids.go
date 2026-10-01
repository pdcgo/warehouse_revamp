package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierByIds resolves ids the caller ALREADY HOLDS into suppliers, whoever owns them.
//
// ⚠ IT DELIBERATELY DOES NOT FILTER BY TEAM, and it is the only supplier read that does not. Every
// other one here carries `team_id = ?` in its WHERE, which is what stops a team touching another's
// supplier by id. Here `team_id` on the request authorizes the CALLER only (use_scope) — the same
// split ProductByIds makes, and each returned Supplier still carries its owning team_id.
//
// The reason is physical: a restock names its supplier by id, and the WAREHOUSE accepting that
// delivery is holding the supplier's carton. Showing it "Supplier #2" withholds nothing it cannot
// already read off the box, and costs the crew the check they are standing there to make. This
// REVERSES the #133/#125 call that stripped the supplier from the warehouse's view — see the proto.
//
// It does not paginate and does not need to: the caller supplies the set, so the response can never
// exceed what was asked for. The contract's max_items is what stops this becoming a bulk export.
//
// A missing id is ABSENT from the response, not an error — a restock naming a since-deleted supplier
// is a reasonable question, and failing the whole lookup would blank a delivery over one dead id.
// Soft-deleted suppliers ARE returned: a restock outlives its vendor record, and a delivery from a
// retired supplier should name it rather than show a blank. `Supplier.deleted` is on the wire, so a
// caller that cares can tell.
func (s *Service) SupplierByIds(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierByIdsRequest],
) (*connect.Response[inventoryv1.SupplierByIdsResponse], error) {
	var suppliers []inventory_service_models.Supplier

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetFilter().GetIds()).
		Find(&suppliers).
		Error
	if err != nil {
		return nil, supplierDBError(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierByIdsResponse{
		Items: supplierByIdsMap(suppliers, req.Msg.GetDataRequest()),
	}), nil
}

// supplierByIdsMap keys one response list PER SUPPLIER, unlike the list mapper's one map across the
// whole page: a by-ids caller looks each id up on its own, so an id it asked for and did not get back
// is answered by the key simply being absent.
func supplierByIdsMap(
	suppliers []inventory_service_models.Supplier,
	types []inventoryv1.SupplierByIdsDataType,
) map[uint64]*inventoryv1.SupplierByIdsResponseList {
	if len(types) == 0 {
		types = []inventoryv1.SupplierByIdsDataType{
			inventoryv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_SUPPLIER,
		}
	}

	out := make(map[uint64]*inventoryv1.SupplierByIdsResponseList, len(suppliers))

	for i := range suppliers {
		supplier := &suppliers[i]

		slices := make([]*inventoryv1.SupplierByIdsResponseItem, 0, len(types))

		for _, t := range types {
			switch t {
			case inventoryv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &inventoryv1.SupplierByIdsResponseItem{
					D: &inventoryv1.SupplierByIdsResponseItem_General{
						General: &commonv1.GeneralMapItem{
							MapData: map[uint64]*commonv1.GeneralItem{
								supplier.ID: {Id: supplier.ID, Name: supplier.Name},
							},
						},
					},
				})
			case inventoryv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_SUPPLIER:
				slices = append(slices, &inventoryv1.SupplierByIdsResponseItem{
					D: &inventoryv1.SupplierByIdsResponseItem_Supplier{
						Supplier: &inventoryv1.SupplierRowMapItem{
							MapData: map[uint64]*inventoryv1.Supplier{
								supplier.ID: supplierToProto(supplier),
							},
						},
					},
				})
			}
		}

		out[supplier.ID] = &inventoryv1.SupplierByIdsResponseList{Items: slices}
	}

	return out
}
