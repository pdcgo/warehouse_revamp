package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierList pages live suppliers — the caller's team's (OWN, My Supplier) or every team's (EVERY_TEAM,
// Discover Supplier — discover-searches-every-teams-suppliers). `q` reads the supplier's name, address and
// contact AND its live stores' names; `channel_type` keeps suppliers with at least one live store of that
// type; `owner_team_id` keeps the suppliers one team keeps (discover-filters-by-the-team-that-keeps-it). The CHANNELS
// slice brings each supplier's live stores along, for Discover's badges.
func (s *Service) SupplierList(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierListRequest],
) (*connect.Response[supplierv1.SupplierListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&supplier_service_models.Supplier{}).
		Where("suppliers.deleted_at IS NULL")

	if filter.GetScope() != supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM {
		query = query.Where("suppliers.team_id = ?", msg.GetTeamId())
	}

	// Under OWN this can only narrow to nothing or to the same set — the two conditions are simply ANDed.
	if ownerTeamID := filter.GetOwnerTeamId(); ownerTeamID != 0 {
		query = query.Where("suppliers.team_id = ?", ownerTeamID)
	}

	if pattern := likePattern(filter.GetQ()); pattern != "" {
		query = query.Where(
			"suppliers.name ILIKE ? OR suppliers.address ILIKE ? OR suppliers.contact ILIKE ? OR EXISTS ("+
				"SELECT 1 FROM supplier_channels c "+
				"WHERE c.supplier_id = suppliers.id AND c.deleted_at IS NULL AND c.name ILIKE ?)",
			pattern, pattern, pattern, pattern,
		)
	}

	if channelType := filter.GetChannelType(); channelType != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where(
			"EXISTS (SELECT 1 FROM supplier_channels c "+
				"WHERE c.supplier_id = suppliers.id AND c.deleted_at IS NULL AND c.channel_type = ?)",
			san_marketplace.ToText(channelType),
		)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, internal(err)
	}

	var suppliers []supplier_service_models.Supplier

	err = query.
		Order(supplierOrderClause(msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&suppliers).
		Error
	if err != nil {
		return nil, internal(err)
	}

	types := msg.GetDataRequest()
	if len(types) == 0 {
		types = []supplierv1.SupplierListDataType{supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER}
	}

	ids := make([]uint64, 0, len(suppliers))
	for i := range suppliers {
		ids = append(ids, suppliers[i].ID)
	}

	var channels map[uint64][]supplier_service_models.SupplierChannel

	if wantsChannels(types) && len(ids) > 0 {
		channels, err = s.liveChannelsOf(ctx, ids)
		if err != nil {
			return nil, internal(err)
		}
	}

	return connect.NewResponse(&supplierv1.SupplierListResponse{
		Items:    supplierListItems(suppliers, channels, types),
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

func wantsChannels(types []supplierv1.SupplierListDataType) bool {
	for _, t := range types {
		if t == supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_CHANNELS {
			return true
		}
	}

	return false
}

// liveChannelsOf reads one page's live stores in ONE query, oldest first — never a query per supplier.
func (s *Service) liveChannelsOf(
	ctx context.Context,
	supplierIDs []uint64,
) (map[uint64][]supplier_service_models.SupplierChannel, error) {
	var rows []supplier_service_models.SupplierChannel

	err := s.db.
		WithContext(ctx).
		Where("supplier_id IN ? AND deleted_at IS NULL", supplierIDs).
		Order("supplier_id, id").
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make(map[uint64][]supplier_service_models.SupplierChannel, len(supplierIDs))
	for i := range rows {
		out[rows[i].SupplierID] = append(out[rows[i].SupplierID], rows[i])
	}

	return out, nil
}
