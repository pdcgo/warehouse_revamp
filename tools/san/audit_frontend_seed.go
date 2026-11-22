package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"connectrpc.com/connect"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1/categoryv1connect"
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1/financial_accountv1connect"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1/productv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1/shipmentv1connect"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1/warehousev1connect"
)

// THE AUDIT'S SEED — the ground the audited screens read, made THROUGH THE AUDIT'S OWN API with the generated Connect
// clients: every row is validated and written by the real handler (HARD RULE 3b — a command calls the handler, never an
// UPDATE), and the events those writes publish (a restock's courier charge → a liability entry) are delivered by the
// real push. It runs once into the template, which is kept until this file or a migration changes (its fingerprint).
//
// Sized for screens 1–10 of the scoping (frontend_speed_scoping.md §2, §5): a rack holding 45 product lines with its
// history past one page, an open restock of 8 lines, 30 courier charges on one warehouse–seller pair, a shop with three
// users. The ids each screen's address needs are the seed's own answers, kept beside the fingerprint — never typed in.

// Seed sizes.
const (
	auditProducts       = 60
	auditSuppliers      = 15
	auditRacks          = 10
	auditRackALines     = 45 // products 1–45 sit on rack A — three pages of rack-detail's 20
	auditOpenRestocks   = 10
	auditOpenLines      = 8 // the open restock the edit form opens
	auditRackAMoves     = 5
	auditRackASamples   = 5
	auditUnitsPerLine   = 10
	auditCourierCharge  = 15000
	auditEventSettleCap = 90 * time.Second
)

// auditSeedIDs is what the seed made, as its answers named it.
type auditSeedIDs struct {
	WarehouseTeam uint64            `json:"warehouse_team"`
	SellingTeam   uint64            `json:"selling_team"`
	Users         map[string]string `json:"users"` // the audit's role → username
	UserIDs       map[string]uint64 `json:"user_ids"`
	Category      uint64            `json:"category"`
	Suppliers     []uint64          `json:"suppliers"`
	Accounts      []uint64          `json:"accounts"`
	Products      []uint64          `json:"products"`
	ProductCodes  []string          `json:"product_codes"`
	Racks         map[string]uint64 `json:"racks"` // rack code → id
	Accepted      []uint64          `json:"accepted_restocks"`
	Open          []uint64          `json:"open_restocks"`
	Courier       uint64            `json:"courier"`      // the shipment channel the open restocks name
	OpenRestock   uint64            `json:"open_restock"` // the 8-line one
	Shops         []uint64          `json:"shops"`
	ShopUsers     []string          `json:"shop_users"` // shop 1's users, first added first
	// Daily is the ground the main lists and the other daily screens read (P4, audit_frontend_seed_daily.go).
	Daily *auditDailyIDs `json:"daily,omitempty"`
}

// auditRoles are the people the screens are opened as: username and the team they work in (filled by the seed).
var auditRoleUsers = []struct {
	Key, Username, Name string
	Warehouse           bool
	Role                role_basev1.Role
}{
	{"wh_owner", "auditwhowner", "Audit Pemilik Gudang", true, role_basev1.Role_ROLE_WAREHOUSE_OWNER},
	{"wh_staff", "auditwhstaff", "Audit Staf Gudang", true, role_basev1.Role_ROLE_WAREHOUSE_STAFF},
	{"seller", "auditseller", "Audit Pemilik Toko", false, role_basev1.Role_ROLE_SELLING_OWNER},
	{"cs1", "auditcs1", "Audit CS Satu", false, role_basev1.Role_ROLE_SELLING_CS},
	{"cs2", "auditcs2", "Audit CS Dua", false, role_basev1.Role_ROLE_SELLING_CS},
}

// bearerInterceptor sends a signed-in person's token on every call.
func bearerInterceptor(token string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if token != "" {
				req.Header().Set("Authorization", "Bearer "+token)
			}

			return next(ctx, req)
		}
	}
}

// auditLogin signs a person in through AuthService/Login and returns the token the app would store.
func auditLogin(ctx context.Context, api, username, password string) (string, error) {
	client := userv1connect.NewAuthServiceClient(http.DefaultClient, api)

	res, err := client.Login(ctx, connect.NewRequest(&userv1.LoginRequest{Username: username, Password: password}))
	if err != nil {
		return "", fmt.Errorf("signing in as %s: %w", username, err)
	}

	return res.Msg.GetToken(), nil
}

// auditSeeder holds the clients the seed calls, all as root.
type auditSeeder struct {
	api        string
	httpClient connect.HTTPClient
	opts       connect.ClientOption
	team       teamv1connect.TeamServiceClient
	user       userv1connect.UserServiceClient
	fee        warehousev1connect.WarehouseFeeServiceClient
	info       warehousev1connect.WarehouseInfoServiceClient
	category   categoryv1connect.CategoryServiceClient
	supplier   supplierv1connect.SupplierServiceClient
	account    financial_accountv1connect.FinancialAccountServiceClient
	product    productv1connect.ProductServiceClient
	rack       inventoryv1connect.RackServiceClient
	restock    inventoryv1connect.RestockRequestServiceClient
	shop       sellingv1connect.ShopServiceClient
	returns    sellingv1connect.TeamReturnConfigurationServiceClient
	channel    shipmentv1connect.ShipmentChannelServiceClient
	liability  liabilityv1connect.LiabilityServiceClient
	calls      int
}

func newAuditSeeder(api, token string) *auditSeeder {
	opts := connect.WithInterceptors(bearerInterceptor(token))
	h := http.DefaultClient

	return &auditSeeder{
		api:        api,
		httpClient: h,
		opts:       opts,
		team:       teamv1connect.NewTeamServiceClient(h, api, opts),
		user:       userv1connect.NewUserServiceClient(h, api, opts),
		fee:        warehousev1connect.NewWarehouseFeeServiceClient(h, api, opts),
		info:       warehousev1connect.NewWarehouseInfoServiceClient(h, api, opts),
		category:   categoryv1connect.NewCategoryServiceClient(h, api, opts),
		supplier:   supplierv1connect.NewSupplierServiceClient(h, api, opts),
		account:    financial_accountv1connect.NewFinancialAccountServiceClient(h, api, opts),
		product:    productv1connect.NewProductServiceClient(h, api, opts),
		rack:       inventoryv1connect.NewRackServiceClient(h, api, opts),
		restock:    inventoryv1connect.NewRestockRequestServiceClient(h, api, opts),
		shop:       sellingv1connect.NewShopServiceClient(h, api, opts),
		returns:    sellingv1connect.NewTeamReturnConfigurationServiceClient(h, api, opts),
		channel:    shipmentv1connect.NewShipmentChannelServiceClient(h, api, opts),
		liability:  liabilityv1connect.NewLiabilityServiceClient(h, api, opts),
	}
}

// seedAudit makes the audit's ground through the API at api (root signed in with auditRootPassword), then waits for
// the courier-charge events to land. It returns the ids and the row counts made.
func seedAudit(ctx context.Context, api string, out io.Writer) (*auditSeedIDs, map[string]int, error) {
	token, err := auditLogin(ctx, api, "root", auditRootPassword)
	if err != nil {
		return nil, nil, err
	}

	s := newAuditSeeder(api, token)
	ids := &auditSeedIDs{Users: map[string]string{}, UserIDs: map[string]uint64{}, Racks: map[string]uint64{}}

	err = s.teams(ctx, ids)
	if err != nil {
		return nil, nil, err
	}

	err = s.catalogue(ctx, ids)
	if err != nil {
		return nil, nil, err
	}

	err = s.racksAndRestocks(ctx, ids)
	if err != nil {
		return nil, nil, err
	}

	err = s.shops(ctx, ids)
	if err != nil {
		return nil, nil, err
	}

	err = s.seedDaily(ctx, ids)
	if err != nil {
		return nil, nil, err
	}

	// The ledger holds each accepted restock's courier charge and each seeded order's warehouse fee.
	entries, err := s.waitForCharges(ctx, ids, len(ids.Accepted)+len(ids.Daily.Orders))
	if err != nil {
		return nil, nil, err
	}

	counts := map[string]int{
		"teams":              2,
		"users":              len(ids.Users),
		"suppliers":          len(ids.Suppliers),
		"accounts":           len(ids.Accounts),
		"products":           len(ids.Products),
		"racks":              len(ids.Racks),
		"rack_a_lines":       auditRackALines,
		"restocks_accepted":  len(ids.Accepted),
		"restocks_open":      len(ids.Open),
		"rack_a_moves":       auditRackAMoves,
		"rack_a_samples":     auditRackASamples,
		"shops":              len(ids.Shops),
		"shop_users":         len(ids.ShopUsers),
		"liability_entries":  entries,
		"api_calls":          s.calls,
		"regions":            5,
		"categories_seeded":  1,
		"open_restock_lines": auditOpenLines,
		"orders":             len(ids.Daily.Orders),
		"order_drafts":       ids.Daily.Drafts,
		"expenses":           ids.Daily.Expenses,
		"found_requests":     len(ids.Daily.Found),
		"opname_sessions":    1,
	}

	fmt.Fprintf(out, "  seed: %d API calls — %d products, %d racks (rack A %d lines), %d restocks accepted + %d open, "+
		"%d liability entries, %d shops, %d orders, %d drafts, %d expenses, %d found, 1 count\n", s.calls,
		len(ids.Products), len(ids.Racks), auditRackALines, len(ids.Accepted), len(ids.Open), entries, len(ids.Shops),
		len(ids.Daily.Orders), ids.Daily.Drafts, ids.Daily.Expenses, len(ids.Daily.Found))

	return ids, counts, nil
}

// teams: one warehouse (with its info and fee) and one selling team, both owned by root, and the five audit users.
func (s *auditSeeder) teams(ctx context.Context, ids *auditSeedIDs) error {
	wh, err := s.team.TeamCreate(ctx, connect.NewRequest(&teamv1.TeamCreateRequest{
		Type: teamv1.TeamType_TEAM_TYPE_WAREHOUSE, Name: "Audit Gudang", TeamCode: "AUDWH", OwnerUserId: 1,
	}))
	if err != nil {
		return fmt.Errorf("TeamCreate (warehouse): %w", err)
	}

	sell, err := s.team.TeamCreate(ctx, connect.NewRequest(&teamv1.TeamCreateRequest{
		Type: teamv1.TeamType_TEAM_TYPE_SELLING, Name: "Audit Toko", TeamCode: "AUDSELL", OwnerUserId: 1,
	}))
	if err != nil {
		return fmt.Errorf("TeamCreate (selling): %w", err)
	}

	s.calls += 2
	ids.WarehouseTeam = wh.Msg.GetTeam().GetId()
	ids.SellingTeam = sell.Msg.GetTeam().GetId()

	for _, u := range auditRoleUsers {
		team := ids.SellingTeam
		if u.Warehouse {
			team = ids.WarehouseTeam
		}

		res, err := s.user.CreateUser(ctx, connect.NewRequest(&userv1.CreateUserRequest{
			TeamId: team, Username: u.Username, Password: auditUserPassword, Name: u.Name, Role: u.Role,
		}))
		if err != nil {
			return fmt.Errorf("CreateUser %s: %w", u.Username, err)
		}

		s.calls++
		ids.Users[u.Key] = u.Username
		ids.UserIDs[u.Key] = res.Msg.GetUser().GetId()
	}

	maxFee := 20000.0

	_, err = s.fee.WarehouseFeeSet(ctx, connect.NewRequest(&warehousev1.WarehouseFeeSetRequest{
		TeamId: ids.WarehouseTeam, FeePercent: 2.5, MinFee: 2000, MaxFee: &maxFee,
	}))
	if err != nil {
		return fmt.Errorf("WarehouseFeeSet: %w", err)
	}

	var hours []*warehousev1.DayHours

	for d := warehousev1.Weekday_WEEKDAY_MONDAY; d <= warehousev1.Weekday_WEEKDAY_SATURDAY; d++ {
		hours = append(hours, &warehousev1.DayHours{Weekday: d, Open: true, OpenTime: "08:00", CloseTime: "17:00"})
	}

	_, err = s.info.WarehouseInfoUpdate(ctx, connect.NewRequest(&warehousev1.WarehouseInfoUpdateRequest{
		TeamId: ids.WarehouseTeam, OperatingHours: hours, ReceivingHours: hours, Location: "Jl. Audit Raya 1, Jakarta",
	}))
	if err != nil {
		return fmt.Errorf("WarehouseInfoUpdate: %w", err)
	}

	s.calls += 2

	return nil
}

// catalogue: a category, the seller's suppliers, two operational paying accounts, and the seller's products.
func (s *auditSeeder) catalogue(ctx context.Context, ids *auditSeedIDs) error {
	cat, err := s.category.CategoryCreate(ctx, connect.NewRequest(&categoryv1.CategoryCreateRequest{Name: "Audit Kategori"}))
	if err != nil {
		return fmt.Errorf("CategoryCreate: %w", err)
	}

	s.calls++
	ids.Category = cat.Msg.GetCategory().GetId()

	for i := 1; i <= auditSuppliers; i++ {
		res, err := s.supplier.SupplierCreate(ctx, connect.NewRequest(&supplierv1.SupplierCreateRequest{
			TeamId: ids.SellingTeam, Name: fmt.Sprintf("Audit Supplier %02d", i),
		}))
		if err != nil {
			return fmt.Errorf("SupplierCreate %d: %w", i, err)
		}

		s.calls++
		ids.Suppliers = append(ids.Suppliers, res.Msg.GetSupplier().GetId())
	}

	opening := time.Now().In(jakartaLocation()).Format("2006-01-02")

	for i := 1; i <= 2; i++ {
		res, err := s.account.FinancialAccountCreate(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountCreateRequest{
			TeamId:        ids.SellingTeam,
			Type:          financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT,
			Provider:      financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA,
			Name:          fmt.Sprintf("Audit Kas %d", i),
			HolderName:    "Audit",
			AccountNumber: fmt.Sprintf("AUD-%03d", i),
			OpeningOn:     opening,
		}))
		if err != nil {
			return fmt.Errorf("FinancialAccountCreate %d: %w", i, err)
		}

		id := res.Msg.GetAccount().GetId()

		_, err = s.account.FinancialAccountOperationalSet(ctx, connect.NewRequest(
			&financial_accountv1.FinancialAccountOperationalSetRequest{TeamId: ids.SellingTeam, AccountId: id, Operational: true}))
		if err != nil {
			return fmt.Errorf("FinancialAccountOperationalSet %d: %w", i, err)
		}

		s.calls += 2
		ids.Accounts = append(ids.Accounts, id)
	}

	for i := 1; i <= auditProducts; i++ {
		res, err := s.product.ProductCreate(ctx, connect.NewRequest(&productv1.ProductCreateRequest{
			TeamId: ids.SellingTeam, ProductCodePart: fmt.Sprintf("AUD%02d", i), Name: fmt.Sprintf("Audit Produk %02d", i),
			CategoryId: ids.Category,
		}))
		if err != nil {
			return fmt.Errorf("ProductCreate %d: %w", i, err)
		}

		s.calls++
		ids.Products = append(ids.Products, res.Msg.GetProduct().GetId())
		ids.ProductCodes = append(ids.ProductCodes, res.Msg.GetProduct().GetProductCode())
	}

	return nil
}

// restockItems are the lines of a restock of products [from, to) (0-based), each from a supplier in turn.
func (s *auditSeeder) restockItems(ids *auditSeedIDs, from, to int) []*inventoryv1.RestockRequestItem {
	var items []*inventoryv1.RestockRequestItem

	for p := from; p < to; p++ {
		items = append(items, &inventoryv1.RestockRequestItem{
			ProductId:   ids.Products[p],
			ProductCode: ids.ProductCodes[p],
			Name:        fmt.Sprintf("Audit Produk %02d", p+1),
			Count:       auditUnitsPerLine,
			Total:       float64(auditUnitsPerLine * 10000),
			SupplierId:  ids.Suppliers[p%len(ids.Suppliers)],
		})
	}

	return items
}

// acceptOnto raises a restock of products [from, to) and accepts every unit onto rack, a courier charge paid at the
// warehouse's door (it becomes a liability entry: the seller owes the warehouse).
func (s *auditSeeder) acceptOnto(ctx context.Context, ids *auditSeedIDs, from, to int, rack uint64) error {
	created, err := s.restock.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: ids.SellingTeam, WarehouseId: ids.WarehouseTeam, FinanceAccountId: ids.Accounts[0],
		Items: s.restockItems(ids, from, to), Note: "audit seed",
	}))
	if err != nil {
		return fmt.Errorf("RestockRequestCreate (products %d–%d): %w", from+1, to, err)
	}

	req := created.Msg.GetRequest()

	var lines []*inventoryv1.RestockRequestReceivedLine

	for _, item := range req.GetItems() {
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId:        item.GetId(),
			ReceivedCount: item.GetCount(),
			Placements:    []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: item.GetCount()}},
		})
	}

	_, err = s.restock.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ids.WarehouseTeam, RequestId: req.GetId(), Lines: lines,
		WarehouseAdditionalCost: auditCourierCharge, WarehouseAdditionalCostNote: "kurir di pintu gudang",
	}))
	if err != nil {
		return fmt.Errorf("RestockRequestAccept %d: %w", req.GetId(), err)
	}

	s.calls += 2
	ids.Accepted = append(ids.Accepted, req.GetId())

	return nil
}

// racksAndRestocks: ten racks; products 1–45 accepted onto rack A three to a restock, 46–60 one to a restock onto
// racks B–J; ten restocks left open (the first with 8 lines) — each with a courier and a resi, so the edit form can
// save; then a few moves and samples off rack A.
func (s *auditSeeder) racksAndRestocks(ctx context.Context, ids *auditSeedIDs) error {
	channels, err := s.channel.ShipmentChannelList(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelListRequest{
		DataRequest: []shipmentv1.ShipmentChannelListDataType{shipmentv1.ShipmentChannelListDataType_SHIPMENT_CHANNEL_LIST_DATA_TYPE_GENERAL},
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if err != nil {
		return fmt.Errorf("ShipmentChannelList: %w", err)
	}

	if len(channels.Msg.GetIds()) == 0 {
		return fmt.Errorf("ShipmentChannelList: no courier — shipment_service's migrations seed them")
	}

	s.calls++
	ids.Courier = channels.Msg.GetIds()[0]

	var order []uint64

	for i := 0; i < auditRacks; i++ {
		code := string(rune('A' + i))

		res, err := s.rack.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
			TeamId: ids.WarehouseTeam, Code: code, Name: "Rak " + code,
		}))
		if err != nil {
			return fmt.Errorf("RackCreate %s: %w", code, err)
		}

		s.calls++
		ids.Racks[code] = res.Msg.GetRack().GetId()
		order = append(order, res.Msg.GetRack().GetId())
	}

	for p := 0; p < auditRackALines; p += 3 {
		err := s.acceptOnto(ctx, ids, p, min(p+3, auditRackALines), order[0])
		if err != nil {
			return err
		}
	}

	for p := auditRackALines; p < auditProducts; p++ {
		err := s.acceptOnto(ctx, ids, p, p+1, order[1+(p-auditRackALines)%(auditRacks-1)])
		if err != nil {
			return err
		}
	}

	for i := 0; i < auditOpenRestocks; i++ {
		from, to := 0, auditOpenLines
		if i > 0 {
			from, to = 10+2*i, 12+2*i
		}

		res, err := s.restock.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: ids.SellingTeam, WarehouseId: ids.WarehouseTeam, FinanceAccountId: ids.Accounts[i%2],
			Items: s.restockItems(ids, from, to), Note: fmt.Sprintf("audit open %d", i+1),
			ShipmentId: ids.Courier, Receipt: fmt.Sprintf("AUDRESI%02d", i+1),
		}))
		if err != nil {
			return fmt.Errorf("RestockRequestCreate (open %d): %w", i+1, err)
		}

		s.calls++
		ids.Open = append(ids.Open, res.Msg.GetRequest().GetId())
	}

	ids.OpenRestock = ids.Open[0]

	for i := 0; i < auditRackAMoves; i++ {
		_, err := s.rack.RackMove(ctx, connect.NewRequest(&inventoryv1.RackMoveRequest{
			TeamId: ids.WarehouseTeam, FromRackId: order[0], Description: "audit move",
			Lines: []*inventoryv1.RackMoveLine{{ProductId: ids.Products[40+i], Quantity: 1, ToRackId: order[1]}},
		}))
		if err != nil {
			return fmt.Errorf("RackMove %d: %w", i+1, err)
		}

		s.calls++
	}

	for i := 0; i < auditRackASamples; i++ {
		_, err := s.rack.RackSample(ctx, connect.NewRequest(&inventoryv1.RackSampleRequest{
			TeamId: ids.WarehouseTeam, RackId: order[0], Recipient: "Bu Audit", Description: "audit sample",
			Lines: []*inventoryv1.RackSampleLine{{ProductId: ids.Products[30+i], Quantity: 1}},
		}))
		if err != nil {
			return fmt.Errorf("RackSample %d: %w", i+1, err)
		}

		s.calls++
	}

	return nil
}

// shops: two shops of the selling team; shop 1 carries the seller and both CS.
func (s *auditSeeder) shops(ctx context.Context, ids *auditSeedIDs) error {
	for i := 1; i <= 2; i++ {
		res, err := s.shop.ShopCreate(ctx, connect.NewRequest(&sellingv1.ShopCreateRequest{
			TeamId: ids.SellingTeam, Name: fmt.Sprintf("Audit Shop %d", i), ShopCode: fmt.Sprintf("AUDSHOP%d", i),
			Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE,
		}))
		if err != nil {
			return fmt.Errorf("ShopCreate %d: %w", i, err)
		}

		s.calls++
		ids.Shops = append(ids.Shops, res.Msg.GetShop().GetId())
	}

	for _, key := range []string{"seller", "cs1", "cs2"} {
		_, err := s.shop.ShopUserAdd(ctx, connect.NewRequest(&sellingv1.ShopUserAddRequest{
			TeamId: ids.SellingTeam, ShopId: ids.Shops[0], UserId: ids.UserIDs[key],
		}))
		if err != nil {
			return fmt.Errorf("ShopUserAdd %s: %w", key, err)
		}

		s.calls++
		ids.ShopUsers = append(ids.ShopUsers, ids.Users[key])
	}

	// The order form's last precondition (P2, OrderCreate): a selling team places no order without a return warehouse
	// (create-refuses-a-team-with-no-return-warehouse) — the audit's warehouse.
	_, err := s.returns.TeamReturnConfigurationSet(ctx, connect.NewRequest(&sellingv1.TeamReturnConfigurationSetRequest{
		TeamId: ids.SellingTeam, WarehouseId: ids.WarehouseTeam,
	}))
	if err != nil {
		return fmt.Errorf("TeamReturnConfigurationSet: %w", err)
	}

	s.calls++

	return nil
}

// waitForCharges waits until the warehouse's ledger with the seller holds want entries — each accepted restock's
// courier charge, posted by liability_service when the emulator pushes *Restock Accepted* — or the cap.
func (s *auditSeeder) waitForCharges(ctx context.Context, ids *auditSeedIDs, want int) (int, error) {
	deadline := time.Now().Add(auditEventSettleCap)
	got := 0

	for {
		res, err := s.liability.LiabilityLogList(ctx, connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
			TeamId:      ids.WarehouseTeam,
			Filter:      &liabilityv1.LiabilityLogListFilter{CounterpartyId: ids.SellingTeam},
			DataRequest: []liabilityv1.LiabilityLogListDataType{liabilityv1.LiabilityLogListDataType_LIABILITY_LOG_LIST_DATA_TYPE_LOG},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 1},
		}))
		if err == nil {
			got = int(res.Msg.GetPageInfo().GetTotalItems())
			if got >= want {
				return got, nil
			}
		}

		if time.Now().After(deadline) {
			return got, fmt.Errorf("the courier-charge events did not settle: %d of %d liability entries after %s — is the "+
				"Pub/Sub emulator pushing to the audit API (project %s)?", got, want, auditEventSettleCap, auditProject)
		}

		select {
		case <-ctx.Done():
			return got, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// jakartaLocation is Asia/Jakarta, or a fixed +07:00 when the zone database is missing.
func jakartaLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}

	return loc
}
