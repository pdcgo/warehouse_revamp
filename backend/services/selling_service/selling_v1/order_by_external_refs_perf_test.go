//go:build perfaudit

// Performance audit for OrderByExternalRefs (the audit-rpc-performance skill) — at a small statement
// (20 refs) and at the contract's cap (2 000 refs).
//
//	go test -tags perfaudit -run TestPerf_OrderByExternalRefs -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

const (
	perfRefTeamBase  uint64 = 20_000 // clear of the unit tests' teams and of the shop seed's
	perfRefTeamCount        = 5
	perfRefOrderRows        = 50_000
)

var perfRefMarkets = []string{"shopee", "tiktok", "lazada", "tokopedia", "shopee"}

// perfRefColumns is the handler's own SELECT list, for the hand-written variants of its query.
const perfRefColumns = `SELECT "id","shop_id","status","created_by_user_id","order_external_ref_id" FROM "orders" `

// perfMarketRef is order i's ref in the shape its storefront writes it: Shopee's 14-character order
// SN, TikTok's 18 digits, Lazada's 15, Tokopedia's invoice number. Unique per i.
func perfMarketRef(market string, i int) string {
	month, day := 1+i%12, 1+i%28

	switch market {
	case "shopee":
		return fmt.Sprintf("25%02d%02d%08X", month, day, uint32(i)*2_654_435_761)
	case "tiktok":
		return fmt.Sprintf("57%016d", int64(i)*7_919+1_234_567)
	case "lazada":
		return fmt.Sprintf("4%014d", int64(i)*104_729+99)
	default:
		return fmt.Sprintf("INV/2025%02d%02d/MPL/%010d", month, day, i)
	}
}

// perfRefOrders is 50 000 orders over five teams — 10 000 each, across each team's five shops. 80%
// carry a marketplace ref, 20% are phone orders with none, and one in a hundred re-uses the ref of an
// earlier order of its team (a cancelled order typed in again), so a ref can find two orders.
func perfRefOrders(shopIDs [][]uint64) []selling_service_models.Order {
	statuses := []string{"placed", "confirmed", "picking", "packed", "shipped", "cancelled"}

	rows := make([]selling_service_models.Order, 0, perfRefOrderRows)

	for i := range perfRefOrderRows {
		team := i % perfRefTeamCount
		j := (i / perfRefTeamCount) % len(perfRefMarkets)

		ref := perfMarketRef(perfRefMarkets[j], i)

		switch {
		case i%10 == 3 || i%10 == 7:
			ref = ""
		case i%100 == 99:
			ref = rows[i-perfRefTeamCount].OrderExternalRefID
		}

		rows = append(rows, selling_service_models.Order{
			TeamID:             perfRefTeamBase + uint64(team),
			ShopID:             shopIDs[team][j],
			WarehouseID:        testWarehouse,
			Status:             statuses[i%len(statuses)],
			CustomerName:       "Budi",
			OrderExternalRefID: ref,
			CreatedByUserID:    uint64(700 + i%40),
			Subtotal:           int64(10_000 + i),
			Total:              int64(15_000 + i),
			CreatedAt:          time.Now().Add(-time.Duration(i%90) * 24 * time.Hour),
			UpdatedAt:          time.Now(),
		})
	}

	return rows
}

// perfStatementRefs is a statement's worth of refs for team 0: `found` of its refs spread across its
// history, then `unknown` refs no order carries. Unique, as the contract requires.
func perfStatementRefs(orders []selling_service_models.Order, found, unknown int) []string {
	var teamRefs []string

	seen := map[string]bool{}

	for i := range orders {
		ref := orders[i].OrderExternalRefID
		if orders[i].TeamID != perfRefTeamBase || ref == "" || seen[ref] {
			continue
		}

		seen[ref] = true
		teamRefs = append(teamRefs, ref)
	}

	refs := make([]string, 0, found+unknown)
	step := len(teamRefs) / found

	for k := range found {
		refs = append(refs, teamRefs[k*step])
	}

	for k := range unknown {
		refs = append(refs, fmt.Sprintf("NOT-IN-THE-SYSTEM-%04d", k))
	}

	return refs
}

func TestPerf_OrderByExternalRefs(t *testing.T) {
	tx := san_testdb.DB(t)
	db, probe := san_perf.Wrap(tx)

	// `orders.shop_id` is a real foreign key, so the shops have to exist before the orders can.
	shopIDs := make([][]uint64, perfRefTeamCount)

	for team := range perfRefTeamCount {
		for j, market := range perfRefMarkets {
			code := fmt.Sprintf("REF-%d-%d", team, j)
			shopIDs[team] = append(shopIDs[team], insertShop(t, db, perfRefTeamBase+uint64(team), code, code, market))
		}
	}

	orders := perfRefOrders(shopIDs)
	san_perf.SeedRows(t, db, orders)

	svc := newService(t, db)
	ctx := t.Context()

	for _, tc := range []struct {
		name           string
		found, unknown int
	}{
		{"20 refs", 18, 2},
		{"2 000 refs", 1_900, 100},
	} {
		req := &sellingv1.OrderByExternalRefsRequest{
			TeamId: perfRefTeamBase,
			Filter: &sellingv1.OrderByExternalRefsFilter{Refs: perfStatementRefs(orders, tc.found, tc.unknown)},
		}

		// Warm-up: schema reflection and pool setup are not this RPC's cost.
		_, err := svc.OrderByExternalRefs(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("OrderByExternalRefs warm-up (%s): %v", tc.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		var resp *connect.Response[sellingv1.OrderByExternalRefsResponse]

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				resp, err = svc.OrderByExternalRefs(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("OrderByExternalRefs (%s): %v", tc.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", tc.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		answered, orderRows := 0, 0

		for _, list := range resp.Msg.GetItems() {
			answered++

			for _, item := range list.GetItems() {
				orderRows += len(item.GetOrderRef().GetMapData())
			}
		}

		if answered != tc.found {
			t.Fatalf("%s: %d refs answered, want %d", tc.name, answered, tc.found)
		}

		jsonBody, err := protojson.Marshal(resp.Msg)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}

		t.Logf("%s: %d refs asked, %d answered, %d order rows, response %d bytes proto / %d bytes JSON",
			tc.name, len(req.GetFilter().GetRefs()), answered, orderRows, proto.Size(resp.Msg), len(jsonBody))
		t.Logf("%s: MEDIAN wall %v", tc.name, san_perf.Median(walls))
		probe.Report(t, "OrderByExternalRefs — "+tc.name)

		// orders is a growing table — EXPLAIN the one query at both sizes.
		query := probe.Queries()[0].SQL
		san_perf.Explain(t, db, query)

		perfRefsWhereTheTimeGoes(t, tx, newService(t, tx), req, query)
	}
}

// perfRefsWhereTheTimeGoes splits the call's wall time into what the probe cannot separate:
//
//   - the handler again on a session with NO probe — the probe's span also covers its own SQL
//     interpolation, so this is the number production would see on this machine;
//   - the same SQL as a LITERAL, every row back — Postgres's work and the rows crossing the wire, but no
//     large Bind (the text is parsed once and cached, so later runs send almost nothing);
//   - the same query through database/sql + pgx directly, 2 001 placeholders — GORM out of the picture;
//   - the same query with ONE text[] parameter (= ANY(?)) instead of 2 000 — the obvious alternative;
//   - SELECT length($1) with a parameter the size of this call's Bind, and with 16 000 bytes — the cost
//     of the Bind message alone, with nothing to plan or return.
func perfRefsWhereTheTimeGoes(
	t *testing.T,
	tx *gorm.DB,
	plain *selling_v1.Service,
	req *sellingv1.OrderByExternalRefsRequest,
	query string,
) {
	t.Helper()

	quiet := tx.Session(&gorm.Session{Logger: logger.Discard})

	medianOf := func(name string, fn func() error) time.Duration {
		ds := make([]time.Duration, 0, 5)

		for range 5 {
			at := time.Now()

			err := fn()
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}

			ds = append(ds, time.Since(at))
		}

		return san_perf.Median(ds)
	}

	// What the Bind carries: team_id, then each ref — a 4-byte length and its bytes.
	bind := 4 + 8

	for _, ref := range req.GetFilter().GetRefs() {
		bind += 4 + len(ref)
	}

	handler := medianOf("handler, no probe", func() error {
		_, err := plain.OrderByExternalRefs(t.Context(), connect.NewRequest(req))

		return err
	})

	literal := medianOf("the literal SQL, every row", func() error {
		var rows []selling_service_models.Order

		return quiet.Raw(query).Scan(&rows).Error
	})

	refs := req.GetFilter().GetRefs()

	sqlTx, ok := tx.Statement.ConnPool.(*sql.Tx)
	if !ok {
		t.Fatalf("the test transaction is a %T, not a *sql.Tx", tx.Statement.ConnPool)
	}

	placeholders := make([]string, len(refs))
	args := make([]any, 0, len(refs)+1)
	args = append(args, req.GetTeamId())

	for i, ref := range refs {
		placeholders[i] = fmt.Sprintf("$%d", i+2)
		args = append(args, ref)
	}

	direct := medianOf("database/sql + pgx directly", func() error {
		rows, err := sqlTx.QueryContext(t.Context(),
			perfRefColumns+"WHERE team_id = $1 AND order_external_ref_id <> '' AND order_external_ref_id IN ("+
				strings.Join(placeholders, ",")+")",
			args...)
		if err != nil {
			return err
		}

		defer rows.Close()

		for rows.Next() {
		}

		return rows.Err()
	})

	asArray := pgtype.Array[string]{
		Elements: refs,
		Dims:     []pgtype.ArrayDimension{{Length: int32(len(refs)), LowerBound: 1}},
		Valid:    true,
	}

	anyArray := medianOf("one text[] parameter", func() error {
		var rows []selling_service_models.Order

		return quiet.
			Raw(perfRefColumns+"WHERE team_id = ? AND order_external_ref_id <> '' AND order_external_ref_id = ANY(?)",
				req.GetTeamId(), asArray).
			Scan(&rows).
			Error
	})

	bindOf := func(size int) time.Duration {
		payload := strings.Repeat("x", size)

		return medianOf("SELECT length($1)", func() error {
			var n int

			return quiet.Raw("SELECT length(?::text)", payload).Scan(&n).Error
		})
	}

	t.Logf("%d refs (a %d-byte Bind), medians: handler with no probe %v · the literal SQL, every row %v · "+
		"database/sql + pgx directly %v · one text[] parameter %v · "+
		"SELECT length($1) with a %d-byte parameter %v · with 16 000 bytes %v",
		len(refs), bind, handler, literal, direct, anyArray, bind, bindOf(bind), bindOf(16_000))
}
