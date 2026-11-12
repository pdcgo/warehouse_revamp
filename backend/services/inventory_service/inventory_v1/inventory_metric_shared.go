package inventory_v1

import (
	"cmp"
	"context"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
)

// THE FOUR INVENTORY METRICS beside Lost stock — Restock, Transfer, Returned stock, Ready stock
// (docs/business/analytic/rpc_provide_decision.md — the-four-inventory-metrics-filter-like-lost-stock,
// the-inventory-metrics-prototype-is-accepted, a-transfer-counts-each-side-on-its-own-day,
// a-warehouse-sees-ready-value-but-a-shelf-only-units, ready-stock-is-folded-in-the-stock-changes-own-step).
//
// Read from the reports every stock change writes in its own transaction (inventory_ledgers.StockTransaction):
// `inventory_stock_daily_changes` (each day's net change per key and change type) and `inventory_door_daily_reports`
// (a restock's or a return's broken / missing). Lost stock's filters and groups; the reader is Lost stock's
// (`warehouse_id = T OR team_id = T`, root every team's) — plus, for a WAREHOUSE, Restock's, Transfer's and Returned
// stock's value fields left unset (a-warehouse-sees-no-seller-money), never Ready stock's
// (a-warehouse-sees-ready-value-but-a-shelf-only-units).
//
// Movements (Restock, Returned stock, Transfer's sent and received) are the window's sum. Positions (Ready stock's two
// fields, Transfer's in transit) are read at an EDGE: a period's last day cut by the window and never after today, the
// headline and an id row the window's last day (a-position-is-its-own-stat-type). Every read is a handful of statements
// whatever the page; MetricSearch ranks every key of the scope in Go — the keys of one seller's or one warehouse's
// stock, which the perf audit measures at volume.

// stockMetric is one of the four, read off its proto message — its id, filters and groups stated once, in the proto.
type stockMetric struct {
	prototype proto.Message
	desc      protoreflect.MessageDescriptor
	option    *analytic_basev1.MetricOption
	// MetricData's oneof prefix: <prefix>_by_id, <prefix>_by_day, <prefix>_summary.
	oneof string
	// The value fields a warehouse reader is not given (a-warehouse-sees-no-seller-money).
	hidden map[protoreflect.Name]bool
	// The fields read at an edge, never summed over time.
	positions map[protoreflect.Name]bool
}

func newStockMetric(prototype proto.Message, oneof string, hidden, positions []protoreflect.Name) *stockMetric {
	desc := prototype.ProtoReflect().Descriptor()

	m := &stockMetric{
		prototype: prototype,
		desc:      desc,
		option:    san_metric.OptionOf(desc),
		oneof:     oneof,
		hidden:    map[protoreflect.Name]bool{},
		positions: map[protoreflect.Name]bool{},
	}

	for _, name := range hidden {
		m.hidden[name] = true
	}

	for _, name := range positions {
		m.positions[name] = true
	}

	return m
}

var (
	restockMetric = newStockMetric(&inventoryv1.InventoryRestockMetric{}, "restock",
		[]protoreflect.Name{"accepted_value"}, nil)
	transferMetric = newStockMetric(&inventoryv1.InventoryTransferMetric{}, "transfer",
		[]protoreflect.Name{"sent_value", "received_value", "in_transit_value"},
		[]protoreflect.Name{"in_transit_count", "in_transit_value"})
	returnMetric = newStockMetric(&inventoryv1.InventoryReturnMetric{}, "return",
		[]protoreflect.Name{"back_value"}, nil)
	readyMetric = newStockMetric(&inventoryv1.InventoryReadyMetric{}, "ready",
		nil, []protoreflect.Name{"on_hand_count", "on_hand_value"})
)

// stockMetricByID is the metric of an id, nil for one of none of the four.
func stockMetricByID(id string) *stockMetric {
	for _, m := range []*stockMetric{restockMetric, transferMetric, returnMetric, readyMetric} {
		if m.option.GetMetricId() == id {
			return m
		}
	}

	return nil
}

// stockReader is WHO reads: Lost stock's reader (a-warehouse-sees-its-lost-amount — `warehouse_id = T OR team_id = T`,
// the root team every team's, every member of the team — every-member-reads-every-metric-of-their-team) and whether
// it is a WAREHOUSE, read off the caller's role in the scoped team (a warehouse role exists only in a warehouse team).
type stockReader struct {
	all       bool
	teamID    uint64
	warehouse bool
}

func stockReaderOf(ctx context.Context, teamID uint64) stockReader {
	return stockReader{
		all:       teamID == san_auth.RootTeamID,
		teamID:    teamID,
		warehouse: isWarehouseRole(san_auth.GetCallerRole(ctx)),
	}
}

// shows is whether the reader is given the field.
func (m *stockMetric) shows(reader stockReader, field protoreflect.Name) bool {
	return !(reader.warehouse && m.hidden[field])
}

// figures is one key's numbers, by field — counts too, as float64 (exact far beyond any stock).
type figures map[protoreflect.Name]float64

func (f figures) add(other figures) {
	for k, v := range other {
		f[k] += v
	}
}

// nonZero is whether any figure is more than dust (a value within 4 places is 0 — san_money's rule).
func (f figures) nonZero() bool {
	for _, v := range f {
		if math.Abs(v) >= 0.00005 {
			return true
		}
	}

	return false
}

// message is one key's figures as the metric's own message; a field the reader may not see stays UNSET.
func (m *stockMetric) message(f figures, reader stockReader) protoreflect.Message {
	msg := m.prototype.ProtoReflect().New()
	fields := m.desc.Fields()

	for i := range fields.Len() {
		fd := fields.Get(i)
		if !m.shows(reader, fd.Name()) {
			continue
		}

		v := f[fd.Name()]

		switch fd.Kind() {
		case protoreflect.Int64Kind:
			msg.Set(fd, protoreflect.ValueOfInt64(int64(math.Round(v))))
		case protoreflect.DoubleKind:
			msg.Set(fd, protoreflect.ValueOfFloat64(v))
		}
	}

	return msg
}

// summaryData is the headline as MetricData's <prefix>_summary.
func (m *stockMetric) summaryData(f figures, reader stockReader) *inventoryv1.MetricData {
	data := &inventoryv1.MetricData{}
	r := data.ProtoReflect()
	fd := r.Descriptor().Fields().ByName(protoreflect.Name(m.oneof + "_summary"))
	r.Set(fd, protoreflect.ValueOfMessage(m.message(f, reader)))

	return data
}

// keyedData is the asked keys as MetricData's <prefix>_by_id or <prefix>_by_day — every asked key, zero where nothing.
func (m *stockMetric) keyedData(byDay bool, keys []string, rows map[string]figures, reader stockReader) *inventoryv1.MetricData {
	suffix := "_by_id"
	if byDay {
		suffix = "_by_day"
	}

	data := &inventoryv1.MetricData{}
	r := data.ProtoReflect()
	fd := r.Descriptor().Fields().ByName(protoreflect.Name(m.oneof + suffix))
	container := r.NewField(fd).Message()
	items := container.Mutable(container.Descriptor().Fields().ByName("items")).Map()

	for _, key := range keys {
		f := rows[key]
		if f == nil {
			f = figures{}
		}

		var mapKey protoreflect.MapKey

		if byDay {
			mapKey = protoreflect.ValueOfString(key).MapKey()
		} else {
			id, _ := strconv.ParseUint(key, 10, 64)
			mapKey = protoreflect.ValueOfUint64(id).MapKey()
		}

		items.Set(mapKey, protoreflect.ValueOfMessage(m.message(f, reader)))
	}

	r.Set(fd, protoreflect.ValueOfMessage(container))

	return data
}

// keyColumns names a row's four dimensions in one source table.
type keyColumns struct {
	warehouse, team, product, supplier string
}

// reportColumns is the two report tables' (and batches') own columns under an alias.
func reportColumns(alias string) keyColumns {
	return keyColumns{
		warehouse: alias + ".warehouse_id",
		team:      alias + ".team_id",
		product:   alias + ".product_id",
		supplier:  alias + ".supplier_id",
	}
}

// scopeSQL is the reader and every filter but the date range over one source, as one SQL condition with its args.
func scopeSQL(c keyColumns, reader stockReader, filters lostFilters) (string, []any) {
	conds := []string{"TRUE"}
	var args []any

	if !reader.all {
		// The warehouse it happened in, or the seller that owns it (a-warehouse-sees-its-lost-amount's reader).
		conds = append(conds, fmt.Sprintf("(%s = ? OR %s = ?)", c.warehouse, c.team))
		args = append(args, reader.teamID, reader.teamID)
	}

	for _, f := range []struct {
		col string
		id  uint64
	}{
		{c.team, filters.teamID},
		{c.warehouse, filters.warehouseID},
		{c.product, filters.productID},
		{c.supplier, filters.supplierID},
	} {
		if f.id != 0 {
			conds = append(conds, f.col+" = ?")
			args = append(args, f.id)
		}
	}

	return strings.Join(conds, " AND "), args
}

// dayLiteral is a day as an SQL literal. ⚠ A LITERAL, not a parameter, for the reason lostRows gives (a prepared
// statement may be planned once for any window); safe — formatted here from a parsed time, only digits and dashes.
func dayLiteral(day time.Time) string {
	return "DATE '" + day.Format(lostDateLayout) + "'"
}

// windowSQL is a day column inside the request's window, as literals.
func windowSQL(col string, filters lostFilters) string {
	return fmt.Sprintf("%s BETWEEN %s AND %s", col, dayLiteral(filters.start), dayLiteral(filters.end))
}

// readToday is the Jakarta day of the read (its clock: time.Now(), or a test's inventory_ledgers.WithNow), at UTC
// midnight like every parsed day.
func readToday(ctx context.Context) time.Time {
	now := inventory_ledgers.NowOf(ctx).In(jakarta)

	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

// periodEnd is the last day of the period starting on `start`.
func periodEnd(group analytic_basev1.GroupType, start time.Time) time.Time {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		return start.AddDate(0, 0, 6)
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return start.AddDate(0, 1, -1)
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return start.AddDate(1, 0, -1)
	default:
		return start
	}
}

// earliest is the earliest of days.
func earliest(days ...time.Time) time.Time {
	return slices.MinFunc(days, func(a, b time.Time) int { return a.Compare(b) })
}

// windowEdge is where the headline and an id row read a position: the window's last day, never after today.
func windowEdge(filters lostFilters, today time.Time) time.Time {
	return earliest(filters.end, today)
}

// periodEdge is where a period's row reads a position: its last day, cut by the window, never after today.
func periodEdge(group analytic_basev1.GroupType, start time.Time, filters lostFilters, today time.Time) time.Time {
	return earliest(periodEnd(group, start), filters.end, today)
}

// windowPeriods is every period of the group from the window's first to its last day, not past today — the rows a
// position's time search ranks.
func windowPeriods(group analytic_basev1.GroupType, filters lostFilters, today time.Time) []time.Time {
	last := earliest(filters.end, today)

	var out []time.Time

	for p := lostPeriodStart(group, filters.start); !p.After(last); p = periodEnd(group, p).AddDate(0, 0, 1) {
		out = append(out, p)
	}

	return out
}

// edgeValues is `(key, edge)` rows as an SQL VALUES list of literals.
func edgeValues(edges map[string]time.Time) string {
	keys := make([]string, 0, len(edges))
	for k := range edges {
		keys = append(keys, k)
	}

	slices.Sort(keys)

	rows := make([]string, 0, len(keys))
	for _, k := range keys {
		day, _ := time.Parse(lostDateLayout, k)
		rows = append(rows, fmt.Sprintf("(%s, %s)", dayLiteral(day), dayLiteral(edges[k])))
	}

	return "VALUES " + strings.Join(rows, ", ")
}

// keyText is a key column as text — a day as YYYY-MM-DD, an id in decimal — so every read keys its rows one way.
func keyText(key lostKey) string {
	if key.isDay {
		return "to_char(" + key.sql + ", 'YYYY-MM-DD')"
	}

	return key.sql + "::text"
}

// scanFigures runs a statement whose first column is the key as text (or nothing, keyed ""), the rest the fields in
// `names`' order, every one a float8.
func scanFigures(db *gorm.DB, keyed bool, names []protoreflect.Name, sql string, args ...any) (map[string]figures, error) {
	rows, err := db.Raw(sql, args...).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]figures{}

	for rows.Next() {
		var key string

		values := make([]float64, len(names))
		dest := make([]any, 0, len(names)+1)

		if keyed {
			dest = append(dest, &key)
		}

		for i := range values {
			dest = append(dest, &values[i])
		}

		err = rows.Scan(dest...)
		if err != nil {
			return nil, err
		}

		f := out[key]
		if f == nil {
			f = figures{}
			out[key] = f
		}

		for i, name := range names {
			f[name] += values[i]
		}
	}

	return out, rows.Err()
}

// askedKeys reads MetricData's keys for a keyed group — days (each a period's first day) or ids — as the text keys
// every read uses.
func askedKeys(group analytic_basev1.GroupType, key lostKey, keys *analytic_basev1.MetricKeys) ([]string, []time.Time, error) {
	if key.isDay {
		if keys.GetDays() == nil {
			return nil, nil, invalidLost("%s is keyed by days", group)
		}

		raw := keys.GetDays().GetDays()
		out := make([]string, 0, len(raw))
		days := make([]time.Time, 0, len(raw))

		for _, d := range raw {
			day, err := time.Parse(lostDateLayout, d)
			if err != nil {
				return nil, nil, invalidLost("%q is not a day", d)
			}

			// A period is keyed by its FIRST day — any other day names no row, and would come back a quiet zero.
			if !lostPeriodStart(group, day).Equal(day) {
				return nil, nil, invalidLost("%s is not the first day of its %s period", d, group)
			}

			out = append(out, d)
			days = append(days, day)
		}

		return out, days, nil
	}

	if keys.GetIds() == nil {
		return nil, nil, invalidLost("%s is keyed by ids", group)
	}

	out := make([]string, 0, len(keys.GetIds().GetIds()))
	for _, id := range keys.GetIds().GetIds() {
		out = append(out, strconv.FormatUint(id, 10))
	}

	return out, nil, nil
}

// rankKeys orders every key with a figure by one field — the key, DESC, breaking every tie (the-key-breaks-every-tie) —
// and answers one page and whether another follows (a-page-says-whether-another-follows). An id group leaves key 0 out
// (a batch naming no supplier): IDList's ids are > 0, so it could never be filled — its units still count in every
// other group and in the headline.
func rankKeys(
	rows map[string]figures,
	isDay bool,
	field protoreflect.Name,
	asc bool,
	page *analytic_basev1.PaginationFilter,
) (*analytic_basev1.MetricKeys, bool) {
	keys := make([]string, 0, len(rows))

	for k, f := range rows {
		if !f.nonZero() || (!isDay && k == "0") {
			continue
		}

		keys = append(keys, k)
	}

	compareKey := func(a, b string) int {
		if isDay {
			return strings.Compare(a, b)
		}

		ai, _ := strconv.ParseUint(a, 10, 64)
		bi, _ := strconv.ParseUint(b, 10, 64)

		return cmp.Compare(ai, bi)
	}

	slices.SortFunc(keys, func(a, b string) int {
		byField := cmp.Compare(rows[a][field], rows[b][field])
		if !asc {
			byField = -byField
		}

		return cmp.Or(byField, -compareKey(a, b))
	})

	offset := min(int(page.GetOffset()), len(keys))
	limit := int(page.GetLimit())
	end := min(offset+limit, len(keys))
	hasNext := len(keys) > end

	out := &analytic_basev1.MetricKeys{}

	if isDay {
		out.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: keys[offset:end]}}
	} else {
		ids := make([]uint64, 0, end-offset)
		for _, k := range keys[offset:end] {
			id, _ := strconv.ParseUint(k, 10, 64)
			ids = append(ids, id)
		}

		out.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return out, hasNext
}

// stockQuery is one read of a metric: who reads, the filters, and the group with its key — SUMMARY (key unset, the
// headline keyed "") or a keyed group, for the asked keys (`keys`, and for a time group their first `days`) or, with
// none, every key of the scope (a search).
type stockQuery struct {
	reader  stockReader
	filters lostFilters
	group   analytic_basev1.GroupType
	key     lostKey
	keys    []string
	days    []time.Time
	today   time.Time
}

func (q stockQuery) summary() bool {
	return q.group == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY
}

// keyFilter narrows a grouped read to the asked keys — `<key> IN ?` with the keys typed as the column is.
func (q stockQuery) keyFilter() (string, []any) {
	if q.summary() || q.keys == nil {
		return "", nil
	}

	if q.key.isDay {
		return " WHERE " + q.key.sql + " IN ?", []any{q.keys}
	}

	ids := make([]uint64, 0, len(q.keys))
	for _, k := range q.keys {
		id, _ := strconv.ParseUint(k, 10, 64)
		ids = append(ids, id)
	}

	return " WHERE " + q.key.sql + " IN ?", []any{ids}
}

// edges is where each row of a time group reads a position — every asked period, or every period of the window — keyed
// by the period's first day.
func (q stockQuery) edges() map[string]time.Time {
	periods := q.days
	if q.keys == nil {
		periods = windowPeriods(q.group, q.filters, q.today)
	}

	out := make(map[string]time.Time, len(periods))
	for _, p := range periods {
		out[p.Format(lostDateLayout)] = periodEdge(q.group, p, q.filters, q.today)
	}

	return out
}

// stockMetricRead is what one metric answers for a query. Each metric file implements it.
type stockMetricRead func(db *gorm.DB, q stockQuery) (map[string]figures, error)

func (m *stockMetric) read() stockMetricRead {
	switch m {
	case restockMetric:
		return readRestock
	case returnMetric:
		return readReturn
	case transferMetric:
		return readTransfer
	default:
		return readReady
	}
}

// stockMetricSearch is MetricSearch for one of the four.
func (s *Service) stockMetricSearch(
	ctx context.Context,
	m *stockMetric,
	msg *inventoryv1.MetricSearchRequest,
) (*inventoryv1.MetricSearchResponse, error) {
	filters, err := parseInventoryFilters(m.option, msg.GetFilters())
	if err != nil {
		return nil, err
	}

	key, err := inventoryKeyOf(m.option, msg.GetGroupBy())
	if err != nil {
		return nil, err
	}

	field, _, err := san_metric.SortField(m.desc, msg.GetSort().GetField())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	reader := stockReaderOf(ctx, msg.GetTeamId())

	if !m.shows(reader, field.Name()) {
		return nil, invalidLost("a warehouse reads %s without the goods' value — %s cannot be sorted by",
			m.option.GetMetricId(), field.Name())
	}

	rows, err := m.read()(s.db.WithContext(ctx), stockQuery{
		reader: reader, filters: filters, group: msg.GetGroupBy(), key: key, today: readToday(ctx),
	})
	if err != nil {
		return nil, lostDBError(err)
	}

	keys, hasNext := rankKeys(rows, key.isDay, field.Name(),
		msg.GetSort().GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC, msg.GetPage())

	return &inventoryv1.MetricSearchResponse{Keys: keys, HasNext: hasNext}, nil
}

// stockMetricData is MetricData for one of the four: the asked keys, or the headline under SUMMARY.
func (s *Service) stockMetricData(
	ctx context.Context,
	m *stockMetric,
	msg *inventoryv1.MetricDataRequest,
) (*inventoryv1.MetricData, error) {
	filters, err := parseInventoryFilters(m.option, msg.GetFilters())
	if err != nil {
		return nil, err
	}

	reader := stockReaderOf(ctx, msg.GetTeamId())
	db := s.db.WithContext(ctx)
	group := msg.GetGroupBy()

	if group == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY {
		if msg.GetKeys().GetK() != nil {
			return nil, invalidLost("a summary takes no keys")
		}

		rows, readErr := m.read()(db, stockQuery{reader: reader, filters: filters, group: group, today: readToday(ctx)})
		if readErr != nil {
			return nil, lostDBError(readErr)
		}

		f := rows[""]
		if f == nil {
			f = figures{}
		}

		return m.summaryData(f, reader), nil
	}

	key, err := inventoryKeyOf(m.option, group)
	if err != nil {
		return nil, err
	}

	keys, days, err := askedKeys(group, key, msg.GetKeys())
	if err != nil {
		return nil, err
	}

	rows := map[string]figures{}

	if len(keys) > 0 {
		rows, err = m.read()(db, stockQuery{
			reader: reader, filters: filters, group: group, key: key, keys: keys, days: days, today: readToday(ctx),
		})
		if err != nil {
			return nil, lostDBError(err)
		}
	}

	return m.keyedData(key.isDay, keys, rows, reader), nil
}
