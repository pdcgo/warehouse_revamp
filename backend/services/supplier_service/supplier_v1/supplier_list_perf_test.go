//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierList -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
)

// Both scopes (My Supplier = OWN, Discover = EVERY_TEAM), with and without q and channel_type, the CHANNELS
// slice on, at two page sizes — a query count that moves with the page is an N+1.
func TestPerf_SupplierList(t *testing.T) {
	b := perfSetup(t)

	own := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_OWN
	every := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM
	shopee := marketplacev1.Marketplace_MARKETPLACE_SHOPEE
	bukalapak := marketplacev1.Marketplace_MARKETPLACE_BUKALAPAK
	none := marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED
	byName := &supplierv1.SupplierListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &supplierv1.SupplierListFilterSort_Supplier{Supplier: supplierv1.SupplierRowSort_SUPPLIER_ROW_SORT_NAME},
	}

	cases := []struct {
		name  string
		scope supplierv1.SupplierListScope
		q     string
		typ   marketplacev1.Marketplace
		sort  *supplierv1.SupplierListFilterSort
		page  uint32
		sizes []uint32
	}{
		{"own", own, "", none, nil, 1, []uint32{20, 200}},
		{"own/q", own, perfQ, none, nil, 1, []uint32{20, 200}},
		{"own/type=shopee", own, "", shopee, nil, 1, []uint32{20, 200}},
		{"every", every, "", none, nil, 1, []uint32{20, 200}},
		{"every/q", every, perfQ, none, nil, 1, []uint32{20, 200}},
		{"every/q-rare", every, perfRareQ, none, nil, 1, []uint32{20}},
		{"every/type=shopee", every, "", shopee, nil, 1, []uint32{20, 200}},
		{"every/type=bukalapak", every, "", bukalapak, nil, 1, []uint32{20, 200}},
		{"every/q+type=shopee", every, perfQ, shopee, nil, 1, []uint32{20}},
		{"every/sort=name", every, "", none, byName, 1, []uint32{20}},
		{"every/deep-page=40", every, "", none, nil, 40, []uint32{200}},
	}

	for _, c := range cases {
		for _, size := range c.sizes {
			perfRun(t, b, fmt.Sprintf("SupplierList/%s/limit=%d", c.name, size), func(int) error {
				_, err := b.svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
					TeamId: b.team,
					Filter: &supplierv1.SupplierListFilter{Scope: c.scope, Q: c.q, ChannelType: c.typ},
					Sort:   c.sort,
					DataRequest: []supplierv1.SupplierListDataType{
						supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER,
						supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_CHANNELS,
					},
					Page: perfPage(c.page, size),
				}))

				return err
			})
		}
	}
}

// The proposed fix, PROBED — not applied. pg_trgm and two trigram indexes are created INSIDE this test's
// transaction (rolled back with it, never a migration), then:
//   - the UNCHANGED handler is measured again (does the index alone help an OR ... EXISTS predicate?), and
//   - the predicate rewritten as `id IN (suppliers that match UNION stores that match)` is EXPLAINed.
//
// go test -tags perfaudit -run TestPerf_SupplierList_TrigramProbe -v ./backend/services/supplier_service/supplier_v1/
func TestPerf_SupplierList_TrigramProbe(t *testing.T) {
	b := perfSetup(t)

	for _, ddl := range []string{
		"CREATE EXTENSION IF NOT EXISTS pg_trgm",
		"CREATE INDEX perf_suppliers_search_trgm ON suppliers USING gin (name gin_trgm_ops, address gin_trgm_ops, contact gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX perf_supplier_channels_name_trgm ON supplier_channels USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL",
		"ANALYZE suppliers",
		"ANALYZE supplier_channels",
	} {
		err := b.db.Exec(ddl).Error
		if err != nil {
			t.Fatalf("%s: %v", ddl, err)
		}
	}

	every := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM

	for _, q := range []string{perfQ, perfRareQ} {
		perfRun(t, b, "SupplierList/trgm-unchanged-handler/every/q="+q+"/limit=20", func(int) error {
			_, err := b.svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
				TeamId: b.team,
				Filter: &supplierv1.SupplierListFilter{Scope: every, Q: q},
				Page:   perfPage(1, 20),
			}))

			return err
		})

		match := fmt.Sprintf(`suppliers.deleted_at IS NULL AND suppliers.id IN (
			SELECT s.id FROM suppliers s WHERE s.deleted_at IS NULL AND (s.name ILIKE '%%%[1]s%%' OR s.address ILIKE '%%%[1]s%%' OR s.contact ILIKE '%%%[1]s%%')
			UNION
			SELECT c.supplier_id FROM supplier_channels c WHERE c.deleted_at IS NULL AND c.name ILIKE '%%%[1]s%%')`, q)

		san_perf.Explain(t, b.db, `SELECT count(*) FROM suppliers WHERE `+match)
		san_perf.Explain(t, b.db, `SELECT * FROM suppliers WHERE `+match+` ORDER BY id DESC LIMIT 20`)

		// The same rewrite, combined with channel_type, and in the OWN scope (team filter left outside the UNION).
		shopee := ` AND EXISTS (SELECT 1 FROM supplier_channels c WHERE c.supplier_id = suppliers.id AND c.deleted_at IS NULL AND c.channel_type = 'shopee')`
		san_perf.Explain(t, b.db, `SELECT count(*) FROM suppliers WHERE `+match+shopee)
		san_perf.Explain(t, b.db, fmt.Sprintf(`SELECT count(*) FROM suppliers WHERE suppliers.team_id = %d AND `, b.team)+match)
	}
}

// The channel_type count, PROBED with a (channel_type, supplier_id) index — created inside this test's
// transaction, never a migration. The handler is unchanged.
//
// go test -tags perfaudit -run TestPerf_SupplierList_ChannelTypeIndexProbe -v ./backend/services/supplier_service/supplier_v1/
func TestPerf_SupplierList_ChannelTypeIndexProbe(t *testing.T) {
	b := perfSetup(t)

	for _, ddl := range []string{
		"CREATE INDEX perf_supplier_channels_type_idx ON supplier_channels (channel_type, supplier_id) WHERE deleted_at IS NULL",
		"ANALYZE supplier_channels",
	} {
		err := b.db.Exec(ddl).Error
		if err != nil {
			t.Fatalf("%s: %v", ddl, err)
		}
	}

	every := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM

	for _, typ := range []marketplacev1.Marketplace{
		marketplacev1.Marketplace_MARKETPLACE_SHOPEE,
		marketplacev1.Marketplace_MARKETPLACE_BUKALAPAK,
	} {
		perfRun(t, b, "SupplierList/type-index/every/type="+typ.String()+"/limit=20", func(int) error {
			_, err := b.svc.SupplierList(context.Background(), connect.NewRequest(&supplierv1.SupplierListRequest{
				TeamId: b.team,
				Filter: &supplierv1.SupplierListFilter{Scope: every, ChannelType: typ},
				Page:   perfPage(1, 20),
			}))

			return err
		})
	}
}
