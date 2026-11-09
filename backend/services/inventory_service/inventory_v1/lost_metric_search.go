package inventory_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// MetricSearch RANKS the keys of one page of a Lost stock table — products, suppliers, sellers, warehouses or periods —
// by `lost_count` or `lost_amount` (docs/business/analytic/rpc_provide.md).
//
//   - Only keys with a loss in the scope (the-rows-are-the-keys-step-one-sends).
//   - ⚠ Supplier 0 — a batch naming no supplier — is LEFT OUT of the Supplier group: IDList's ids are > 0, so a row keyed
//     0 could never be filled. Its units still count in every other group and in the headline.
//   - Both fields are every reader's (a-warehouse-sees-its-lost-amount): a warehouse may sort by the amount.
//   - No total: it reads limit + 1 and says whether another page follows (a-page-says-whether-another-follows).
//
// ONE statement: the scope grouped by the key, ordered, a page plus one.
func (s *Service) MetricSearch(
	ctx context.Context,
	req *connect.Request[inventoryv1.MetricSearchRequest],
) (*connect.Response[inventoryv1.MetricSearchResponse], error) {
	msg := req.Msg

	err := checkLostMetric(msg.GetSort().GetMetricId())
	if err != nil {
		return nil, err
	}

	filters, err := parseLostFilters(msg.GetFilters())
	if err != nil {
		return nil, err
	}

	key, err := lostKeyOf(msg.GetGroupBy())
	if err != nil {
		return nil, err
	}

	field, _, err := san_metric.SortField((&inventoryv1.InventoryLostMetric{}).ProtoReflect().Descriptor(), msg.GetSort().GetField())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	direction := "DESC"
	if msg.GetSort().GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC {
		direction = "ASC"
	}

	db := s.db.WithContext(ctx)

	grouped := lostRows(db, lostReaderOf(msg.GetTeamId()), filters).
		Select(key.sql + " AS key, " + lostSums).
		Group(key.sql)
	if !key.isDay {
		grouped = grouped.Where(key.sql + " <> 0")
	}

	page := msg.GetPage()
	limit := int(page.GetLimit())

	query := db.
		Table("(?) AS g", grouped).
		Select("g.key").
		// The key, DESC, breaks every tie (the-key-breaks-every-tie).
		Order(fmt.Sprintf("g.%s %s, g.key DESC", lostColumn[string(field.Name())], direction)).
		Offset(int(page.GetOffset())).
		Limit(limit + 1)

	keys := &analytic_basev1.MetricKeys{}
	hasNext := false

	if key.isDay {
		var days []time.Time

		err = query.Pluck("g.key", &days).Error
		if err != nil {
			return nil, lostDBError(err)
		}

		if len(days) > limit {
			days, hasNext = days[:limit], true
		}

		list := make([]string, 0, len(days))
		for _, day := range days {
			list = append(list, day.Format(lostDateLayout))
		}

		keys.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: list}}
	} else {
		var ids []uint64

		err = query.Pluck("g.key", &ids).Error
		if err != nil {
			return nil, lostDBError(err)
		}

		if len(ids) > limit {
			ids, hasNext = ids[:limit], true
		}

		keys.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return connect.NewResponse(&inventoryv1.MetricSearchResponse{Keys: keys, HasNext: hasNext}), nil
}
