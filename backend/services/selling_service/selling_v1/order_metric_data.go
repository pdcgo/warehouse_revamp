package selling_v1

import (
	"context"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// MetricData FILLS the keys a search returned with every asked order metric — or, grouped by SUMMARY with no keys,
// reads the headline: the same figures over the whole scope (the-headline-is-the-metric-grouped-by-summary).
//
//   - The filters scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters): every asked key
//     comes back for every asked metric, one with nothing in the scope all zero — never missing.
//   - One answer per asked metric, in the asked order (one-call-answers-every-asked-metric).
//   - A warehouse's money fields are UNSET, never 0 (a-warehouse-sees-no-seller-money).
//
// ONE statement for all the asked metrics, after the reader's team type: grouped by metric and key.
func (a *Analytic) MetricData(
	ctx context.Context,
	req *connect.Request[sellingv1.MetricDataRequest],
) (*connect.Response[sellingv1.MetricDataResponse], error) {
	msg := req.Msg

	metrics := make([]*orderMetric, 0, len(msg.GetMetricIds()))

	for _, id := range msg.GetMetricIds() {
		metric, err := orderMetricByID(id)
		if err != nil {
			return nil, err
		}

		metrics = append(metrics, metric)
	}

	filters, err := parseMetricFilters(msg.GetFilters(), metrics)
	if err != nil {
		return nil, err
	}

	reader, err := a.readerOf(ctx, msg.GetTeamId())
	if err != nil {
		return nil, err
	}

	var datas []*sellingv1.MetricData

	switch {
	case msg.GetGroupBy() == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY:
		datas, err = a.metricSummary(ctx, reader, filters, metrics, msg.GetKeys())
	default:
		datas, err = a.metricByKey(ctx, reader, filters, metrics, msg.GetGroupBy(), msg.GetKeys())
	}

	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.MetricDataResponse{MetricDatas: datas}), nil
}

// reportSumsRow is one grouped row of a summary: which metric, and its sums.
type reportSumsRow struct {
	Metric string
	selling_service_models.OrderMetricColumns
}

// reportDayRow and reportIDRow are one grouped row of a fill, keyed by a period or by an id.
type reportDayRow struct {
	Metric string
	Key    time.Time
	selling_service_models.OrderMetricColumns
}

type reportIDRow struct {
	Metric string
	Key    uint64
	selling_service_models.OrderMetricColumns
}

func (a *Analytic) metricSummary(
	ctx context.Context,
	reader metricReader,
	filters metricFilters,
	metrics []*orderMetric,
	keys *analytic_basev1.MetricKeys,
) ([]*sellingv1.MetricData, error) {
	if keys.GetK() != nil {
		return nil, invalidMetric("a summary takes no keys")
	}

	var rows []reportSumsRow

	err := reportRows(a.db.WithContext(ctx), reader, filters, metrics).
		Select("r.metric AS metric, " + reportSums).
		Group("r.metric").
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	sums := map[string]selling_service_models.OrderMetricColumns{}
	for _, row := range rows {
		sums[row.Metric] = row.OrderMetricColumns
	}

	datas := make([]*sellingv1.MetricData, 0, len(metrics))

	for _, metric := range metrics {
		data := &sellingv1.MetricData{}
		reflected := data.ProtoReflect()
		reflected.Set(oneofField(reflected, metric, "_summary"),
			protoreflect.ValueOfMessage(metricMessage(metric, sums[metric.report], reader.money)))

		datas = append(datas, data)
	}

	return datas, nil
}

func (a *Analytic) metricByKey(
	ctx context.Context,
	reader metricReader,
	filters metricFilters,
	metrics []*orderMetric,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
) ([]*sellingv1.MetricData, error) {
	key, err := keyOf(group, metrics)
	if err != nil {
		return nil, err
	}

	query := reportRows(a.db.WithContext(ctx), reader, filters, metrics).
		Select("r.metric AS metric, " + key.sql + " AS key, " + reportSums).
		Group("r.metric, " + key.sql)

	// asked is every asked key, as text and as the response map's key; filled is metric → key text → sums.
	type askedKey struct {
		text   string
		mapKey protoreflect.MapKey
	}

	var asked []askedKey

	filled := map[string]map[string]selling_service_models.OrderMetricColumns{}
	for _, metric := range metrics {
		filled[metric.report] = map[string]selling_service_models.OrderMetricColumns{}
	}

	suffix := "_by_id"

	if key.isDay {
		suffix = "_by_day"

		if keys.GetDays() == nil {
			return nil, invalidMetric("%s is keyed by days", group)
		}

		days := keys.GetDays().GetDays()

		for _, raw := range days {
			day, err := time.Parse(metricDateLayout, raw)
			if err != nil {
				return nil, invalidMetric("%q is not a day", raw)
			}

			// A period is keyed by its FIRST day — any other day of it names no row, and would come back a quiet zero.
			if !periodStart(group, day).Equal(day) {
				return nil, invalidMetric("%s is not the first day of its %s period", raw, group)
			}

			asked = append(asked, askedKey{text: raw, mapKey: protoreflect.ValueOfString(raw).MapKey()})
		}

		if len(days) > 0 {
			var rows []reportDayRow

			err = query.Where(key.sql+" IN ?", days).Scan(&rows).Error
			if err != nil {
				return nil, dbError(err)
			}

			for _, row := range rows {
				filled[row.Metric][row.Key.Format(metricDateLayout)] = row.OrderMetricColumns
			}
		}
	} else {
		if keys.GetIds() == nil {
			return nil, invalidMetric("%s is keyed by ids", group)
		}

		ids := keys.GetIds().GetIds()
		for _, id := range ids {
			asked = append(asked, askedKey{text: strconv.FormatUint(id, 10), mapKey: protoreflect.ValueOfUint64(id).MapKey()})
		}

		if len(ids) > 0 {
			var rows []reportIDRow

			err = query.Where(key.sql+" IN ?", ids).Scan(&rows).Error
			if err != nil {
				return nil, dbError(err)
			}

			for _, row := range rows {
				filled[row.Metric][strconv.FormatUint(row.Key, 10)] = row.OrderMetricColumns
			}
		}
	}

	datas := make([]*sellingv1.MetricData, 0, len(metrics))

	for _, metric := range metrics {
		data := &sellingv1.MetricData{}
		reflected := data.ProtoReflect()
		field := oneofField(reflected, metric, suffix)

		keyed := reflected.NewField(field).Message()
		items := keyed.Mutable(keyed.Descriptor().Fields().ByName("items")).Map()

		// Every asked key, zero where nothing happened — never missing (the-rows-are-the-keys-step-one-sends).
		for _, k := range asked {
			items.Set(k.mapKey, protoreflect.ValueOfMessage(metricMessage(metric, filled[metric.report][k.text], reader.money)))
		}

		reflected.Set(field, protoreflect.ValueOfMessage(keyed))
		datas = append(datas, data)
	}

	return datas, nil
}

// oneofField is MetricData's case for one metric — `<prefix>_by_id`, `_by_day` or `_summary`. Named in the proto, so a
// metric added there is answered here without a case per metric.
func oneofField(data protoreflect.Message, metric *orderMetric, suffix string) protoreflect.FieldDescriptor {
	field := data.Descriptor().Fields().ByName(protoreflect.Name(metric.oneof + suffix))
	if field == nil {
		panic("order metrics: MetricData has no case " + metric.oneof + suffix)
	}

	return field
}
