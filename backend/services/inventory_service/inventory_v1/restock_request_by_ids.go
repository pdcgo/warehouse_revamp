package inventory_v1

import (
	"context"
	"slices"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestByIds reads SEVERAL restocks at once for Cetak Label (owner: *"restock detail harusnya ada yang dipanggil
// ids"*, the-labels-mark-their-one-by-one-read) — every restock on a print in one call, where the page asked
// RestockRequestDetail and RestockRequestLabels per restock: 5 restocks were up to 10 calls, 50 up to 100.
//
// The guideline's ByIds shape (guidelines/service-guideline.md): the ids, the slices asked for, an answer keyed by id.
// Each slice keeps the scope of the one-restock read it stands for, so nothing reads wider than it did:
//
//	RESTOCK_REQUEST  RestockRequestDetail's scope — a restock the team RAISED or one going TO it — read as the LIST reads
//	                 a row: its lines (all an arrived restock's labels need), no trail, no problems, plus the list's
//	                 by-line override flags (restockStepOverrides).
//	LABELS           RestockRequestLabels' scope — going TO the warehouse, ACCEPTED — the same labels it answers
//	                 (restockLabelSets). A restock not accepted has none and carries no LABELS item: the page knows
//	                 from the restock's status, and one restock that cannot print never fails the read for the others.
//
// An id outside the scope, or unknown, is ABSENT — as Detail's NotFound, the id itself does not confirm it exists. At
// most 50 ids (proto), the most a print holds (at-most-fifty-restocks-a-print). A fixed number of statements whatever the
// count: the restocks with their lines (two), their overrides (one), and the labels (two).
func (s *Service) RestockRequestByIds(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestByIdsRequest],
) (*connect.Response[inventoryv1.RestockRequestByIdsResponse], error) {
	teamID := req.Msg.GetTeamId()
	ids := req.Msg.GetFilter().GetIds()

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []inventoryv1.RestockRequestByIdsDataType{
			inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_RESTOCK_REQUEST,
		}
	}

	wantRestock := slices.Contains(types, inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_RESTOCK_REQUEST)
	wantLabels := slices.Contains(types, inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_LABELS)

	out := make(map[uint64]*inventoryv1.RestockRequestByIdsResponseList, len(ids))
	add := func(id uint64, item *inventoryv1.RestockRequestByIdsResponseItem) {
		list := out[id]
		if list == nil {
			list = &inventoryv1.RestockRequestByIdsResponseList{}
			out[id] = list
		}

		list.Items = append(list.Items, item)
	}

	db := s.db.WithContext(ctx)

	if wantRestock {
		restocks, err := restocksByIds(db, teamID, ids)
		if err != nil {
			return nil, restockErr(err)
		}

		for _, r := range restocks {
			add(r.GetId(), &inventoryv1.RestockRequestByIdsResponseItem{
				D: &inventoryv1.RestockRequestByIdsResponseItem_RestockRequest{RestockRequest: r},
			})
		}
	}

	if wantLabels {
		var accepted []inventory_service_models.Restock

		err := db.
			Where("id IN ?", ids).
			Where("warehouse_id = ?", teamID).
			Where("status = ?", restockStatusAccepted).
			Order("id ASC").
			Find(&accepted).
			Error
		if err != nil {
			return nil, restockErr(err)
		}

		sets, err := s.restockLabelSets(ctx, db, teamID, accepted)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		for i := range accepted {
			add(accepted[i].ID, &inventoryv1.RestockRequestByIdsResponseItem{
				D: &inventoryv1.RestockRequestByIdsResponseItem_Labels{Labels: sets[accepted[i].ID]},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.RestockRequestByIdsResponse{
		Items: out,
	}), nil
}

// restocksByIds is the RESTOCK_REQUEST slice: the restocks among `ids` the team raised or that go to it — Detail's scope
// — each as the list builds a row (its lines, the by-line override flags), in id order.
func restocksByIds(db *gorm.DB, teamID uint64, ids []uint64) ([]*inventoryv1.RestockRequest, error) {
	var rrs []inventory_service_models.Restock

	err := db.
		Where("id IN ?", ids).
		Where("(team_id = ? OR warehouse_id = ?)", teamID, teamID).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Order("id ASC").
		Find(&rrs).
		Error
	if err != nil {
		return nil, err
	}

	overrides, err := restockStepOverrides(db, rrs)
	if err != nil {
		return nil, err
	}

	out := make([]*inventoryv1.RestockRequest, 0, len(rrs))
	for i := range rrs {
		r := restockRequestToProto(&rrs[i])
		step := overrides[rrs[i].ID]
		r.CreatedByIsOverride = step.Created
		r.ArrivedByIsOverride = step.Arrived
		r.AcceptedByIsOverride = step.Accepted
		out = append(out, r)
	}

	return out, nil
}
