package inventory_v1_test

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE PHOTOS TAKEN AT THE DOOR, KEPT AND READ BACK (a-broken-product-carries-a-photo,
// the-courier-slip-has-an-optional-photo, the-detail-pages-show-the-broken-photo,
// the-detail-pages-show-the-slip-and-the-broken-rack): at Terima the receiving warehouse may send a photo of each line's
// broken units and one of the courier's slip — both optional, both the warehouse's own uploads (document ids). The accept
// keeps the broken photo on the line's broken row and the slip beside the charge; RestockDoorPhotos signs them for the
// restock's selling team and its warehouse, and for nobody else.
//
// The restocks here are expiryRestock's: selling team 2 → warehouse 5 (expiryWarehouse).

const (
	doorSeller       uint64 = 2
	doorOtherSeller  uint64 = 3
	doorOtherHouse   uint64 = 6
	doorBrokenA             = "doc-broken-a"
	doorBrokenB             = "doc-broken-b"
	doorNoBrokenLine        = "doc-nothing-broken"
	doorSlip                = "doc-slip"
)

// doorLinker is document_service's LabelURL over the warehouse's uploads: each document is the WAREHOUSE's, as the
// accept page uploads them under the warehouse's team.
func doorLinker() *fakePhotoLinker {
	return &fakePhotoLinker{owners: map[string]uint64{
		doorBrokenA:      expiryWarehouse,
		doorBrokenB:      expiryWarehouse,
		doorNoBrokenLine: expiryWarehouse,
		doorSlip:         expiryWarehouse,
	}}
}

// brokenLine is countedLine with a photo of the broken units.
func brokenLine(item *inventoryv1.RestockRequestItem, received, broken int64, rack uint64, photo string) *inventoryv1.RestockRequestReceivedLine {
	line := countedLine(item, received, broken, rack, "")
	line.BrokenPhotoFile = photo

	return line
}

// storedProblem is one stored problem row, as the database holds it.
type storedProblem struct {
	ProductID   uint64
	ProblemType string
	Count       int64
	Note        string
	PhotoFile   string
}

func storedProblems(t *testing.T, db *gorm.DB, restockID uint64) []storedProblem {
	t.Helper()

	var rows []storedProblem

	err := db.
		Table("restock_problem_items").
		Select("product_id, problem_type, count, note, photo_file").
		Where("restock_id = ?", restockID).
		Order("product_id, problem_type").
		Scan(&rows).
		Error
	if err != nil {
		t.Fatal(err)
	}

	return rows
}

// storedSlip is the restock's charge, its note and its slip, as stored.
func storedSlip(t *testing.T, db *gorm.DB, restockID uint64) inventory_service_models.Restock {
	t.Helper()

	var rr inventory_service_models.Restock

	err := db.
		Select("id", "warehouse_additional_cost", "warehouse_additional_cost_note", "warehouse_additional_cost_file").
		Where("id = ?", restockID).
		First(&rr).
		Error
	if err != nil {
		t.Fatal(err)
	}

	return rr
}

// acceptWithPhotos raises a restock of three lines and counts it in with the door's photos:
//
//	100  ordered 10, 10 in the box, 2 broken — photographed (doorBrokenA)
//	200  ordered 6, 5 in the box, 1 broken — photographed (doorBrokenB) — and 1 missing
//	300  ordered 4, all good — a photo sent anyway (doorNoBrokenLine): no broken row to keep it on
//
// and the courier's charge with its note and slip.
func acceptWithPhotos(t *testing.T, svc *inventory_v1.Service, charge float64, slip string) (*inventoryv1.RestockRequest, uint64) {
	t.Helper()

	req, rack := expiryRestock(t, svc, map[uint64]int64{100: 10, 200: 6, 300: 4}, []uint64{100, 200, 300})
	items := req.GetItems()

	note := ""
	if charge > 0 {
		note = "biaya COD"
	}

	accepted, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: expiryWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			brokenLine(items[0], 10, 2, rack, doorBrokenA),
			brokenLine(items[1], 5, 1, rack, doorBrokenB),
			brokenLine(items[2], 4, 0, rack, doorNoBrokenLine),
		},
		WarehouseAdditionalCost:     charge,
		WarehouseAdditionalCostNote: note,
		WarehouseAdditionalCostFile: slip,
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	return accepted.Msg.GetRequest(), req.GetId()
}

// The accept keeps each line's broken photo on its broken row — never on the missing row, and nowhere for a line with no
// broken unit — and the slip beside the charge; the answer and Detail read them back.
func TestRestockRequestAccept_KeepsTheDoorPhotos(t *testing.T) {
	db := san_testdb.DB(t)
	svc := photoService(db, doorLinker())

	answer, id := acceptWithPhotos(t, svc, 5000, doorSlip)

	want := []storedProblem{
		{ProductID: 100, ProblemType: "broken", Count: 2, PhotoFile: doorBrokenA},
		{ProductID: 200, ProblemType: "broken", Count: 1, PhotoFile: doorBrokenB},
		{ProductID: 200, ProblemType: "missing", Count: 1},
	}
	if got := storedProblems(t, db, id); !slices.Equal(got, want) {
		t.Fatalf("problem rows = %+v, want %+v", got, want)
	}

	rr := storedSlip(t, db, id)
	if rr.WarehouseAdditionalCost != 5000 || rr.WarehouseAdditionalCostNote != "biaya COD" ||
		rr.WarehouseAdditionalCostFile != doorSlip {
		t.Fatalf("charge = %v %q %q, want 5000 \"biaya COD\" %q",
			rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostNote, rr.WarehouseAdditionalCostFile, doorSlip)
	}

	detail, err := svc.RestockRequestDetail(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: doorSeller, RequestId: id,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	for name, got := range map[string]*inventoryv1.RestockRequest{"accept": answer, "detail": detail.Msg.GetRequest()} {
		if got.GetWarehouseAdditionalCostFile() != doorSlip {
			t.Errorf("%s: slip = %q, want %q", name, got.GetWarehouseAdditionalCostFile(), doorSlip)
		}

		photos := map[uint64]string{}
		for _, item := range got.GetItems() {
			for _, p := range item.GetProblems() {
				if p.GetType() == inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_MISSING && p.GetPhotoFile() != "" {
					t.Errorf("%s: product %d's missing row carries a photo", name, item.GetProductId())
				}

				if p.GetType() == inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_BROKEN {
					photos[item.GetProductId()] = p.GetPhotoFile()
				}
			}
		}

		if photos[100] != doorBrokenA || photos[200] != doorBrokenB || len(photos) != 2 {
			t.Errorf("%s: broken photos = %v", name, photos)
		}
	}
}

// Both photos are optional: an accept without them stores the same count, notes and charge as ever, and no photo.
func TestRestockRequestAccept_WithoutPhotosIsUnchanged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := photoService(db, doorLinker())

	req, rack := expiryRestock(t, svc, map[uint64]int64{100: 10, 200: 6}, []uint64{100, 200})
	items := req.GetItems()

	broken := countedLine(items[0], 10, 2, rack, "")
	broken.BrokenNote = "karung sobek"

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: expiryWarehouse, RequestId: req.GetId(),
		Lines:                       []*inventoryv1.RestockRequestReceivedLine{broken, countedLine(items[1], 5, 0, rack, "")},
		WarehouseAdditionalCost:     5000,
		WarehouseAdditionalCostNote: "biaya COD",
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	want := []storedProblem{
		{ProductID: 100, ProblemType: "broken", Count: 2, Note: "karung sobek"},
		{ProductID: 200, ProblemType: "missing", Count: 1},
	}
	if got := storedProblems(t, db, req.GetId()); !slices.Equal(got, want) {
		t.Fatalf("problem rows = %+v, want %+v", got, want)
	}

	rr := storedSlip(t, db, req.GetId())
	if rr.WarehouseAdditionalCost != 5000 || rr.WarehouseAdditionalCostNote != "biaya COD" || rr.WarehouseAdditionalCostFile != "" {
		t.Fatalf("charge = %v %q %q, want 5000 \"biaya COD\" and no slip",
			rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostNote, rr.WarehouseAdditionalCostFile)
	}

	res, err := svc.RestockDoorPhotos(ctxUser(1), connect.NewRequest(&inventoryv1.RestockDoorPhotosRequest{
		TeamId: doorSeller, RequestId: req.GetId(),
	}))
	if err != nil {
		t.Fatalf("door photos: %v", err)
	}

	if res.Msg.GetCourierSlipUrl() != "" || len(res.Msg.GetBroken()) != 0 || res.Msg.GetExpiresAtUnix() != 0 {
		t.Fatalf("door photos = %v, want none", res.Msg)
	}
}

// The slip belongs to the charge: with no charge (Tidak ada) a slip sent anyway is not kept.
func TestRestockRequestAccept_ASlipWithNoChargeIsNotKept(t *testing.T) {
	db := san_testdb.DB(t)
	svc := photoService(db, doorLinker())

	_, id := acceptWithPhotos(t, svc, 0, doorSlip)

	rr := storedSlip(t, db, id)
	if rr.WarehouseAdditionalCost != 0 || rr.WarehouseAdditionalCostFile != "" {
		t.Fatalf("charge = %v, slip = %q — want no charge and no slip", rr.WarehouseAdditionalCost, rr.WarehouseAdditionalCostFile)
	}
}

// A missing row never carries a photo — the database refuses one, whoever writes it.
func TestRestockProblemItems_AMissingRowHoldsNoPhoto(t *testing.T) {
	db := san_testdb.DB(t)
	svc := photoService(db, doorLinker())

	_, id := acceptWithPhotos(t, svc, 0, "")

	row := func(kind, photo string) error {
		return db.Transaction(func(tx *gorm.DB) error {
			return tx.Create(&inventory_service_models.RestockProblemItem{
				RestockID: id, ProductID: 300, ProblemType: kind, Count: 1, PhotoFile: photo,
			}).Error
		})
	}

	// Line 300 came whole, so it has no problem row yet.
	err := row("missing", "doc-x")
	if !errors.Is(err, gorm.ErrCheckConstraintViolated) && (err == nil || !strings.Contains(err.Error(), "check constraint")) {
		t.Fatalf("err = %v, want the CHECK to refuse a missing row with a photo", err)
	}

	// The controls: a broken row with a photo, and a missing row without one, are stored.
	for _, ok := range [][2]string{{"broken", "doc-x"}, {"missing", ""}} {
		err = row(ok[0], ok[1])
		if err != nil {
			t.Fatalf("%s row, photo %q: %v", ok[0], ok[1], err)
		}
	}
}

func doorPhotos(svc *inventory_v1.Service, teamID, requestID uint64) (*inventoryv1.RestockDoorPhotosResponse, error) {
	res, err := svc.RestockDoorPhotos(ctxUser(1), connect.NewRequest(&inventoryv1.RestockDoorPhotosRequest{
		TeamId: teamID, RequestId: requestID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// Both detail pages read the photos: the selling team that raised the restock and the warehouse it went to get the same
// links — each signed with the WAREHOUSE as the owner (its upload), the broken ones in product order.
func TestRestockDoorPhotos_BothSidesOpenThem(t *testing.T) {
	db := san_testdb.DB(t)
	linker := doorLinker()
	svc := photoService(db, linker)

	_, id := acceptWithPhotos(t, svc, 5000, doorSlip)

	for _, side := range []uint64{doorSeller, expiryWarehouse} {
		got, err := doorPhotos(svc, side, id)
		if err != nil {
			t.Fatalf("team %d: %v", side, err)
		}

		if got.GetCourierSlipUrl() != "https://files.invalid/"+doorSlip {
			t.Errorf("team %d: slip = %q", side, got.GetCourierSlipUrl())
		}

		broken := got.GetBroken()
		if len(broken) != 2 ||
			broken[0].GetProductId() != 100 || broken[0].GetUrl() != "https://files.invalid/"+doorBrokenA ||
			broken[1].GetProductId() != 200 || broken[1].GetUrl() != "https://files.invalid/"+doorBrokenB {
			t.Errorf("team %d: broken = %v", side, broken)
		}

		if got.GetExpiresAtUnix() != 1_900_000_000 {
			t.Errorf("team %d: expires = %d", side, got.GetExpiresAtUnix())
		}
	}

	// The photo sent for a line with no broken unit was never kept, so it is never asked for.
	if slices.Contains(linker.asked, doorNoBrokenLine) {
		t.Fatalf("asked to sign %q, which nothing keeps", doorNoBrokenLine)
	}
}

// Nobody else opens them: another selling team, another warehouse and an unknown restock all read NotFound — and
// document_service is never asked.
func TestRestockDoorPhotos_AnotherTeamIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	linker := doorLinker()
	svc := photoService(db, linker)

	_, id := acceptWithPhotos(t, svc, 5000, doorSlip)

	for name, c := range map[string]struct{ team, restock uint64 }{
		"another selling team": {doorOtherSeller, id},
		"another warehouse":    {doorOtherHouse, id},
		"an unknown restock":   {doorSeller, id + 1000},
	} {
		_, err := doorPhotos(svc, c.team, c.restock)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: err = %v, want NotFound", name, err)
		}
	}

	if len(linker.asked) != 0 {
		t.Fatalf("document_service was asked for %v", linker.asked)
	}
}

// A document id alone opens nothing: a photo that is not the restock's warehouse's own upload — another team's file, or
// one removed since — is left out, the rest still answered.
func TestRestockDoorPhotos_OnlyTheWarehousesOwnUploadOpens(t *testing.T) {
	db := san_testdb.DB(t)
	linker := doorLinker()
	// The slip id names a file of the SELLING team, the second broken photo a file document_service no longer holds.
	linker.owners[doorSlip] = doorSeller
	delete(linker.owners, doorBrokenB)
	svc := photoService(db, linker)

	_, id := acceptWithPhotos(t, svc, 5000, doorSlip)

	got, err := doorPhotos(svc, doorSeller, id)
	if err != nil {
		t.Fatal(err)
	}

	if got.GetCourierSlipUrl() != "" {
		t.Errorf("slip = %q, want none: the file is not the warehouse's", got.GetCourierSlipUrl())
	}

	if len(got.GetBroken()) != 1 || got.GetBroken()[0].GetProductId() != 100 {
		t.Errorf("broken = %v, want product 100's only", got.GetBroken())
	}
}

// A failure that is not "no such file" is the read's error, not a silently missing photo.
func TestRestockDoorPhotos_ALinkerFailureIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	linker := doorLinker()
	svc := photoService(db, linker)

	_, id := acceptWithPhotos(t, svc, 5000, doorSlip)

	linker.err = connect.NewError(connect.CodeUnavailable, errors.New("storage down"))

	_, err := doorPhotos(svc, expiryWarehouse, id)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
}

// Who may ask: RestockRequestDetail's roles exactly — both sides of a restock read the pages the photos are on, plus Root
// and the Administrator. A read: an agent and the monitor may call it, as they read Detail.
func TestRestockDoorPhotos_Policy(t *testing.T) {
	policyOf := func(name protoreflect.FullName) []role_basev1.Role {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(name)
		if err != nil {
			t.Fatal(err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		return policy.GetRoles()
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}

	got := policyOf("warehouse.inventory.v1.RestockDoorPhotosRequest")
	if !slices.Equal(got, want) {
		t.Fatalf("roles = %v, want %v", got, want)
	}

	if detail := policyOf("warehouse.inventory.v1.RestockRequestDetailRequest"); !slices.Equal(got, detail) {
		t.Fatalf("roles = %v, Detail's = %v — the photos are read on Detail's pages", got, detail)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockDoorPhotos")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockDoorPhotos must be marked NO_SIDE_EFFECTS")
	}
}
