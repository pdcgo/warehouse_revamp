package main

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// THE AUDITED SCREENS — frontend_speed_scoping.md §5's first ten, in #120–#123's order (router.tsx's routes). Each is
// opened as ONE role, the one whose daily work it is; its address is built from the seed's own ids. `ready` is what
// "usable" waits for (default: the page root's data-testid); `save` is the screen's one representative write, done
// through the UI on the last warm load; `probes` are read-only interactions (opening a picker) whose requests are
// counted the same way.

// auditStep is one browser step of an interaction, by data-testid — or, where the app gives the element no test id
// of its own (a calendar's today cell, the input inside a picker's test id'd box), by a CSS selector over the app's
// own attributes. The app is never edited for the audit: a form that needs a test id to be found is reported.
type auditStep struct {
	Op       string `json:"op"` // click | fill | wait | press | upload (a 1×1 PNG into a file input)
	TestID   string `json:"testid,omitempty"`
	Selector string `json:"selector,omitempty"` // used instead of TestID when set
	Value    string `json:"value,omitempty"`    // fill's text, press's key, upload's file name
}

// auditInteraction is a scripted interaction whose requests are counted.
type auditInteraction struct {
	Name string `json:"name"`
	// Setup are steps run first and never counted — what the counted steps need on screen (the warehouse a picker
	// opens against).
	Setup []auditStep `json:"setup,omitempty"`
	Steps []auditStep `json:"steps"`
	// RPC is the write its last step sends ("Service/Method"); what fires after its answer is the after-save count.
	// Empty for a read-only probe — then everything from the first step on is counted.
	RPC string `json:"rpc,omitempty"`
	// Refreshes are the reads the screen is expected to ask again after the write: one missing reads "stale?", the same
	// read twice or more than listed + 2 reads "storm". Empty: recorded, not judged.
	Refreshes []string `json:"refreshes,omitempty"`
}

// auditTypingField is one field the typing pass types into (P2, #125): its name in the md and the verdict, its test
// id, the keys pressed one by one, and the steps that bring it on screen first (a line's quantity needs the product
// picked). Each is typed auditTypingPasses times, every pass on a fresh load.
type auditTypingField struct {
	Name   string      `json:"name"`
	TestID string      `json:"testid"`
	Keys   []string    `json:"keys"`
	Setup  []auditStep `json:"setup,omitempty"`
}

// auditTypingPasses is how many times each field is typed: a typing count is judged only when it holds in every pass
// (the every-run rule, audit_frontend_verdict.go) — a debounced read answering inside one keystroke's frames in one
// pass and the next keystroke's in another moves a median.
const auditTypingPasses = 2

// auditTypingWaitMS is the quiet after the last keystroke in which its TRAILING commits are counted — a debounced
// search or quote (ProductPickerShell's 300 ms, useStockTakeQuote's settle) and the answer it brings.
const auditTypingWaitMS = 500

// auditTextKeys are typed into a text field: ten letters, one keystroke each, after what it already holds.
var auditTextKeys = strings.Split("auditketik", "")

// auditQtyKeys edit a quantity ten times and keep it a whole number the seeded stock covers (10 a product): each
// digit replaces the last — Backspace, then the digit — so the box is empty between the two, as a person's is.
var auditQtyKeys = []string{"Backspace", "2", "Backspace", "3", "Backspace", "4", "Backspace", "5", "Backspace", "6"}

// auditScreenDef is one audited screen.
type auditScreenDef struct {
	Name   string
	Page   string // the page directory under frontend/src/pages
	Route  string // the address, with {placeholders} from the seed
	Role   string // auditRoleUsers key, or "root"
	Ready  string // the usable selector ("" — [data-testid="<Name>-page"])
	Rows   string // the backlog rows that read it (#120 …)
	Save   *auditInteraction
	Probes []auditInteraction
	// Typing are the form's main text fields, typed into by the typing pass (P2) — none on a screen that is not a form.
	Typing []auditTypingField
	// Note is said once in the screen's md (what the screen's code does that the measures stand on).
	Note string
	// Phase is the audit's phase that added the screen ("" — P1), named in its first History row.
	Phase string
	// UnstableLinks are waits (from → to, "Service/Method") the dependency pass was seen to measure in some runs and
	// not in others: a chain moving one level through one is reported unstable, never judged (the unstable-chain
	// rule, audit_frontend_verdict.go). Add one only after reading the flip in two runs' results.json `after` lists.
	UnstableLinks [][2]string
}

func stepClick(id string) auditStep { return auditStep{Op: "click", TestID: id} }
func stepWait(id string) auditStep  { return auditStep{Op: "wait", TestID: id} }
func stepEscape() auditStep         { return auditStep{Op: "press", Value: "Escape"} }

// stepClickAt clicks the first element a CSS selector finds.
func stepClickAt(selector string) auditStep { return auditStep{Op: "click", Selector: selector} }

func stepFill(id, value string) auditStep {
	return auditStep{Op: "fill", TestID: id, Value: value}
}

// stepUpload puts a 1×1 PNG named name into the file input a CSS selector finds.
func stepUpload(selector, name string) auditStep {
	return auditStep{Op: "upload", Selector: selector, Value: name}
}

// auditWarehouseCode is the warehouse team's code — audit_frontend_seed.go's teams() creates it as "AUDWH"; the team
// picker names its options by code (team-select-option-<code>).
const auditWarehouseCode = "AUDWH"

// The order form's steps (pages/order-create): the warehouse the form measures every figure against, and one product
// picked from its stock — the ground the product picker and a line's quantity stand on. The picker lists the newest
// products first, ten to a page, so the product picked is the seed's newest (on a rack of its own, 10 units).
var (
	orderPickWarehouse = []auditStep{
		stepClickAt(`[data-testid="order-warehouse"] input`), stepClick("team-select-option-{warehouse_code}"),
	}
	orderPickProduct = []auditStep{
		stepClick("order-create-add-line"), stepWait("product-picker-option-{newest_product}"),
		stepClick("product-picker-option-{newest_product}"), stepClick("product-picker-confirm"), stepWait("order-line-qty-0"),
	}
)

// orderCreateSave fills the smallest order the form places — a customer, the warehouse, a shop, a courier, one
// product, today's date, a sell price, the storefront's ref, a resi and a receipt file — and presses Create. Nothing
// is seeded for it beyond the screens' own seed: the courier is the first the shipment service's migrations list, the
// receipt goes up through the audit API's local storage, and a fresh clone holds no order with the ref.
func orderCreateSave() *auditInteraction {
	steps := []auditStep{stepFill("order-create-customer-name", "Audit Pembeli")}
	steps = append(steps, orderPickWarehouse...)
	steps = append(steps,
		stepClick("shop-select"), stepClick("shop-select-option-{shop}"),
		stepClickAt(`[data-testid="shipment-channel-select"] input`), stepClickAt(`[data-testid^="shipment-channel-option-"]`),
	)
	steps = append(steps, orderPickProduct...)
	steps = append(steps,
		stepClick("order-create-order-date"),
		stepClickAt(`[data-testid="order-create-order-date-content"] [data-part="table-cell-trigger"][data-today]`),
		stepEscape(),
		stepFill("order-marketplace-total", "500000"),
		stepFill("order-external-ref-id", "AUDIT-ORDER-1"),
		stepFill("order-receipt-code", "AUDRESI-ORDER-1"),
		stepUpload(`[data-testid="order-receipt-upload"] input[type="file"]`, "audit-resi.png"),
		stepWait("order-receipt-attached"),
		stepClick("order-create-save"),
	)

	return &auditInteraction{
		Name:  "OrderCreate (customer, warehouse, shop, courier, a product, today, a price, the ref, a receipt) — opens the order",
		Steps: steps,
		RPC:   "OrderService/OrderCreate",
	}
}

// auditScreens is the screen table: P1's ten, then P4's daily screens (audit_frontend_screens_daily.go).
var auditScreens = append(append([]auditScreenDef(nil), auditFirstScreens...), auditDailyScreens...)

// auditFirstScreens are P1's screens 1–10.
var auditFirstScreens = []auditScreenDef{
	{
		Name: "rack-detail", Page: "rack-detail", Route: "/inventories/racks/{rack_a}", Role: "wh_owner", Rows: "#120",
		Save: &auditInteraction{
			Name: "RackMove 1 unit A→B",
			Steps: []auditStep{
				stepClick("rack-action-move"), stepWait("move-line-{rack_a_product}"), stepFill("move-qty-{rack_a_product}-0", "1"),
				stepClick("move-default-to"), stepClick("rack-select-option-{rack_b}"), stepClick("move-submit"),
			},
			RPC:       "RackService/RackMove",
			Refreshes: []string{"RackService/RackDetail", "RackService/RackStock", "RackService/RackHistory"},
		},
		Note: "RackDetail, RackHistory and the shelf's RackStock → ProductByIds → TeamByIds read through query hooks " +
			"(features/racks/queries.ts, #120); a write refreshes them by invalidating `racks`, each read once.",
	},
	{
		Name: "restock-edit", Page: "restock-form", Route: "/inventories/restock/{open_restock}/edit", Role: "seller",
		Ready: `[data-testid="restock-edit-page"]`, Rows: "#121 #122",
		Save: &auditInteraction{
			Name:  "RestockRequestUpdate (the note) — saves and opens the restock",
			Steps: []auditStep{stepFill("restock-note", "audit catatan"), stepWait("restock-form-ready"), stepClick("submit-restock")},
			RPC:   "RestockRequestService/RestockRequestUpdate",
		},
		Probes: []auditInteraction{
			{Name: "open ProductPicker", Steps: []auditStep{stepClick("restock-pick-products"), stepWait("product-picker-list"), stepEscape()}},
		},
		Typing: []auditTypingField{
			{Name: "line quantity", TestID: "restock-qty-0", Keys: auditQtyKeys},
			{Name: "note", TestID: "restock-note", Keys: auditTextKeys},
		},
		Note: "The restock is already a query (useRestockRequest); its covers are a useEffect ProductByIds " +
			"(pages/restock-form/index.tsx) — #122. The pickers run their own effects — #121.",
	},
	{
		Name: "restock-new", Page: "restock-form", Route: "/inventories/restock/new", Role: "seller",
		Ready: `[data-testid="restock-create-page"]`, Rows: "#121",
		Probes: []auditInteraction{
			{Name: "open ProductPicker", Steps: []auditStep{stepClick("restock-pick-products"), stepWait("product-picker-list"), stepEscape()}},
			{Name: "open the supplier picker", Steps: []auditStep{stepClick("restock-all-supplier-picker-trigger"),
				stepWait("restock-all-supplier-picker-suppliers"), stepEscape()}},
		},
		Note: "No write measured: the form's first save is a create (it would change the screen it measures). " +
			"SupplierSelect and ProductPicker fetch in their own useEffects — #121.",
	},
	{
		Name: "product-edit", Page: "product-edit", Route: "/products/{product}/edit", Role: "seller", Rows: "#121 #122",
		Save: &auditInteraction{
			Name:  "ProductUpdate (unchanged)",
			Steps: []auditStep{stepClick("product-edit-save")},
			RPC:   "ProductService/ProductUpdate",
		},
		Probes: []auditInteraction{
			{Name: "open CategorySelect", Steps: []auditStep{stepClick("category-select"), stepWait("category-search"), stepEscape()}},
		},
		Typing: []auditTypingField{
			{Name: "name", TestID: "product-edit-name", Keys: auditTextKeys},
		},
		Note: "ProductDetail is a useEffect read (pages/product-edit/index.tsx) — #122; CategorySelect fetches in its own " +
			"effect — #121.",
	},
	{
		Name: "liability-detail", Page: "liability-detail", Route: "/liability/{selling_team}", Role: "wh_owner",
		Rows: "#122",
		Save: &auditInteraction{
			Name:  "request payment (LiabilityPaymentRequestSend)",
			Steps: []auditStep{stepClick("liability-detail-request-payment"), stepClick("confirm-action")},
			RPC:   "LiabilityPaymentService/LiabilityPaymentRequestSend",
		},
		Note: "Opened by the WAREHOUSE owner on its ledger with the seller (30 courier charges): \"request payment\" is " +
			"the creditor's button — the seller, the debtor, has only \"make payment\". Its team lookup is already a " +
			"useQuery with a raw key (index.tsx) — #122 moves only the key.",
	},
	{
		Name: "profile", Page: "profile", Route: "/profile", Role: "seller", Rows: "#122",
		Save: &auditInteraction{
			Name:  "UpdateProfile (unchanged)",
			Steps: []auditStep{stepClick("save-profile")},
			RPC:   "UserService/UpdateProfile",
		},
		Note: "ProfileDetail is a useEffect read (pages/profile/index.tsx) — #122. The save answers the new row, so no " +
			"read is expected after it.",
	},
	{
		Name: "warehouse-edit", Page: "warehouse-edit", Route: "/teams/{warehouse_team}/edit", Role: "root", Rows: "#122",
		Save: &auditInteraction{
			Name:  "save unchanged (TeamUpdate → WarehouseInfoUpdate) — opens the team",
			Steps: []auditStep{stepClick("warehouse-edit-save")},
			RPC:   "WarehouseInfoService/WarehouseInfoUpdate",
		},
		Note: "TeamDetail + WarehouseInfoDetail are one useEffect read (pages/warehouse-edit/index.tsx) — #122.",
	},
	{
		Name: "shop-detail", Page: "shop-detail", Route: "/shops/{shop}", Role: "seller", Rows: "#122",
		Save: &auditInteraction{
			Name:  "ShopUserSetPrimary",
			Steps: []auditStep{stepClick("make-primary-{cs1}"), stepClick("confirm-action")},
			RPC:   "ShopService/ShopUserSetPrimary",
		},
		Note: "ShopUsersSection's ShopUserList + UserByIDs are a useEffect read (components/ShopUsersSection.tsx) — #122.",
	},
	{
		Name: "order-create", Page: "order-create", Route: "/orders/new", Role: "seller", Rows: "#121 #122 #123",
		// WarehouseClosedNote's WarehouseReceivingStatus read after the warehouse TeamList: measured in four 2026-11-21
		// runs, absent in a fifth (the P1 baseline's, depth 1) — docs/tools/san.md, audit frontend.
		UnstableLinks: [][2]string{{"TeamService/TeamList", "WarehouseInfoService/WarehouseReceivingStatus"}},
		Save:          orderCreateSave(),
		Probes: []auditInteraction{
			{Name: "open ProductPicker (the warehouse picked first)", Setup: orderPickWarehouse,
				Steps: []auditStep{stepClick("order-create-add-line"), stepWait("product-picker-list"), stepEscape()}},
		},
		Typing: []auditTypingField{
			{Name: "buyer name", TestID: "order-create-customer-name", Keys: auditTextKeys},
			{Name: "address", TestID: "address-line", Keys: auditTextKeys},
			{Name: "quantity", TestID: "order-line-qty-0", Keys: auditQtyKeys,
				Setup: append(append([]auditStep(nil), orderPickWarehouse...), orderPickProduct...)},
		},
		Note: "The form's state is one useReducer (pages/order-create/formState.ts, #123); a keystroke still re-renders the " +
			"whole page. Its save " +
			"(P2) is the whole OrderCreate a person types — the warehouse, a shop, a courier, one product, today, a " +
			"price, the ref, a receipt file — and opens the order it made, so the requests after it are the order " +
			"page's load. The product picker opens only once a warehouse is picked: its probe picks one first, uncounted.",
	},
	{
		Name: "team-detail", Page: "team-detail", Route: "/teams/{warehouse_team}", Role: "root", Rows: "(#122's missed reads)",
		Note: "ShopsSection's ShopList and WarehouseInfoSection's WarehouseInfoDetail are useEffect reads the first " +
			"grep missed (scoping §5) — #122.",
	},
}

// auditScreenByName finds a screen of the table.
func auditScreenByName(name string) (auditScreenDef, bool) {
	for _, s := range auditScreens {
		if s.Name == name {
			return s, true
		}
	}

	return auditScreenDef{}, false
}

// auditScreenNames lists the table's names.
func auditScreenNames() []string {
	names := make([]string, 0, len(auditScreens))
	for _, s := range auditScreens {
		names = append(names, s.Name)
	}

	return names
}

// pickAuditScreens is the --screen selection in table order (none named: every screen). An unknown name refuses.
func pickAuditScreens(names []string) ([]auditScreenDef, error) {
	if len(names) == 0 {
		return auditScreens, nil
	}

	want := map[string]bool{}

	for _, n := range names {
		for _, part := range strings.Split(n, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}

			_, ok := auditScreenByName(part)
			if !ok {
				return nil, fmt.Errorf("--screen %q: not an audited screen (%s)", part, strings.Join(auditScreenNames(), ", "))
			}

			want[part] = true
		}
	}

	var out []auditScreenDef

	for _, s := range auditScreens {
		if want[s.Name] {
			out = append(out, s)
		}
	}

	return out, nil
}

// auditPlaceholders are the values a route or a step's test id is built from.
func auditPlaceholders(ids *auditSeedIDs) map[string]string {
	u := func(v uint64) string { return strconv.FormatUint(v, 10) }

	m := map[string]string{
		"warehouse_team": u(ids.WarehouseTeam),
		"warehouse_code": auditWarehouseCode,
		"selling_team":   u(ids.SellingTeam),
		"open_restock":   u(ids.OpenRestock),
		"rack_a":         u(ids.Racks["A"]),
		"rack_b":         u(ids.Racks["B"]),
		"cs1":            ids.Users["cs1"],
	}

	if len(ids.Products) > 0 {
		m["product"] = u(ids.Products[0])
		m["rack_a_product"] = u(ids.Products[0])
		m["newest_product"] = u(ids.Products[len(ids.Products)-1])
	}

	if len(ids.Shops) > 0 {
		m["shop"] = u(ids.Shops[0])
	}

	// P4's daily screens (audit_frontend_screens_daily.go): the seed's own ids, never typed in.
	if len(ids.Accepted) > 0 {
		m["accepted_restock"] = u(ids.Accepted[0])
	}

	if len(ids.Open) > 1 {
		m["open_restock_2"] = u(ids.Open[1])
	}

	if len(ids.Suppliers) > 0 {
		m["supplier"] = u(ids.Suppliers[0])
	}

	if len(ids.Accounts) > 0 {
		m["account"] = u(ids.Accounts[0])
	}

	if ids.UserIDs["cs1"] > 0 {
		m["cs1_id"] = u(ids.UserIDs["cs1"])
	}

	d := ids.Daily
	if d != nil {
		if len(d.Orders) > 1 {
			m["order"] = u(d.Orders[0])
			m["warehouse_order"] = u(d.Orders[1])
		}

		m["batch"] = u(d.Batch)
		m["opname_session"] = u(d.OpnameSession)
	}

	return m
}

// fillPlaceholders replaces every {name} of s.
func fillPlaceholders(s string, values map[string]string) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}

	sort.Strings(keys)

	pairs := make([]string, 0, 2*len(keys))
	for _, k := range keys {
		pairs = append(pairs, "{"+k+"}", values[k])
	}

	return strings.NewReplacer(pairs...).Replace(s)
}

// auditRoleTeam is the team a role works in (what the app keeps in sessionStorage as the current team).
func auditRoleTeam(role string, ids *auditSeedIDs) uint64 {
	switch role {
	case "root":
		return 1
	case "wh_owner", "wh_staff":
		return ids.WarehouseTeam
	default:
		return ids.SellingTeam
	}
}

// ── the plan the driver reads ─────────────────────────────────────────────────────────────────────

// auditPlanScreen is one screen as frontend/scripts/speed-audit/run.mjs opens it.
type auditPlanScreen struct {
	Name         string             `json:"name"`
	URL          string             `json:"url"`
	Role         string             `json:"role"`
	Token        string             `json:"token"`
	Team         string             `json:"team"`
	Ready        string             `json:"ready"`
	Save         *auditInteraction  `json:"save,omitempty"`
	Probes       []auditInteraction `json:"probes,omitempty"`
	Typing       []auditTypingField `json:"typing,omitempty"`
	TypingPasses int                `json:"typing_passes"`
	TypingWaitMS int                `json:"typing_wait_ms"`
	UsableCapMS  int                `json:"usable_cap_ms"`
	QuietMS      int                `json:"quiet_ms"`
	SaveQuietMS  int                `json:"save_quiet_ms"`
	SaveCapMS    int                `json:"save_cap_ms"`
	ChainGapMS   int                `json:"chain_gap_ms"`
	WarmLoads    int                `json:"warm_loads"`
	DepDelayMS   int                `json:"dep_delay_ms"`
	DepPasses    int                `json:"dep_passes"`
	Shell        []auditShellRead   `json:"shell"`
}

// auditPlan is plan.json.
type auditPlan struct {
	UI         string            `json:"ui"`
	API        string            `json:"api"`
	CountsOnly bool              `json:"counts_only"`
	Screens    []auditPlanScreen `json:"screens"`
}

// resolveSteps fills the placeholders of steps (a copy).
func resolveSteps(steps []auditStep, values map[string]string) []auditStep {
	if steps == nil {
		return nil
	}

	out := make([]auditStep, len(steps))

	for i, st := range steps {
		st.TestID = fillPlaceholders(st.TestID, values)
		st.Selector = fillPlaceholders(st.Selector, values)
		st.Value = fillPlaceholders(st.Value, values)
		out[i] = st
	}

	return out
}

// resolveInteraction fills an interaction's placeholders.
func resolveInteraction(in auditInteraction, values map[string]string) auditInteraction {
	out := in
	out.Setup = resolveSteps(in.Setup, values)
	out.Steps = resolveSteps(in.Steps, values)

	if out.Steps == nil {
		out.Steps = []auditStep{}
	}

	return out
}

// resolveTyping fills a typing field's placeholders.
func resolveTyping(in auditTypingField, values map[string]string) auditTypingField {
	out := in
	out.TestID = fillPlaceholders(in.TestID, values)
	out.Setup = resolveSteps(in.Setup, values)

	return out
}

// buildAuditPlan makes the driver's plan: each screen's address, its role's token and team, its interactions.
func buildAuditPlan(seat *auditSeat, screens []auditScreenDef, ids *auditSeedIDs, tokens map[string]string,
	warm int, countsOnly bool) auditPlan {
	values := auditPlaceholders(ids)
	plan := auditPlan{UI: seat.uiURL(), API: seat.apiURL(), CountsOnly: countsOnly}

	for _, s := range screens {
		ready := s.Ready
		if ready == "" {
			ready = fmt.Sprintf(`[data-testid="%s-page"]`, s.Name)
		}

		ps := auditPlanScreen{
			Name:         s.Name,
			URL:          seat.uiURL() + fillPlaceholders(s.Route, values),
			Role:         s.Role,
			Token:        tokens[s.Role],
			Team:         strconv.FormatUint(auditRoleTeam(s.Role, ids), 10),
			Ready:        ready,
			TypingPasses: auditTypingPasses,
			TypingWaitMS: auditTypingWaitMS,
			UsableCapMS:  15000,
			QuietMS:      500,
			SaveQuietMS:  1000,
			SaveCapMS:    10000,
			ChainGapMS:   auditChainGapMS,
			WarmLoads:    warm,
			DepDelayMS:   auditDepDelayMS,
			DepPasses:    auditDepPasses,
			Shell:        auditShell,
		}

		if s.Save != nil {
			save := resolveInteraction(*s.Save, values)
			ps.Save = &save
		}

		for _, p := range s.Probes {
			ps.Probes = append(ps.Probes, resolveInteraction(p, values))
		}

		for _, f := range s.Typing {
			ps.Typing = append(ps.Typing, resolveTyping(f, values))
		}

		plan.Screens = append(plan.Screens, ps)
	}

	return plan
}
