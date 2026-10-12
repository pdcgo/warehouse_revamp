package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE HISTORY THE SELLING TEAM READS (00019).
//
// A restock is handled by TWO TEAMS. The warehouse counts the delivery in; the SELLING TEAM is the one
// waiting to know it landed, who counted it, and what it ended up costing — and its detail page is the
// only screen that answers any of that. So the acceptance is not tested where it is written, it is
// tested where the other team reads it: through Detail, called with the SELLING team's id.
//
// That distinction is the whole point of these cases. `RestockRequestDetail` scopes by
// `requesting_team_id OR warehouse_id`, and a scope narrowed to the warehouse would leave every one of
// these passing when called as the warehouse and returning NotFound to the team that has been waiting.

const (
	tlSellingTeam uint64 = 2
	tlWarehouse   uint64 = 5
	tlProduct     uint64 = 420
	tlBuyer       uint64 = 11
	tlReceiver    uint64 = 12
)

// trailStep is one row of a restock's trail as a reader sees it (every-status-change-is-logged,
// edits-are-in-the-same-trail): the status it left, the status it reached, and what happened. An edit or a charge
// leaves the status where it was.
type trailStep struct {
	from        inventoryv1.RestockRequestStatus
	to          inventoryv1.RestockRequestStatus
	description string
}

// The steps a restock's trail is made of, as the stored history reads back.
var (
	stepCreated   = trailStep{inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED, ongoing, "created"}
	stepEdited    = trailStep{ongoing, ongoing, "edited"}
	stepCharge    = trailStep{ongoing, ongoing, "courier's charge recorded"}
	stepAccepted  = trailStep{ongoing, accepted, "accepted"}
	stepCancelled = trailStep{ongoing, cancelled, "cancelled"}
)

// trail is the timeline as a reader sees it, in order.
func trail(r *inventoryv1.RestockRequest) []trailStep {
	out := make([]trailStep, 0, len(r.GetLogs()))
	for _, l := range r.GetLogs() {
		out = append(out, trailStep{from: l.GetFromStatus(), to: l.GetToStatus(), description: l.GetDescription()})
	}

	return out
}

// acceptAndReadAsSellingTeam raises a restock as the buyer, has a DIFFERENT person accept it for the
// warehouse, then reads it back as the SELLING team — the sequence a real delivery goes through, and
// the only one where "the timeline is recorded" can be told apart from "the accepting side can see its
// own write".
func acceptAndReadAsSellingTeam(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	codFee int64,
) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(tlBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: tlSellingTeam, WarehouseId: tlWarehouse,
		ShipmentCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: tlProduct, Sku: "SKU-TL", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestAccept(ctxUser(tlReceiver), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: tlWarehouse, RequestId: reqID,
		WarehouseAdditionalCost: codFee, WarehouseAdditionalCostNote: courierNote,
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	detail, err := svc.RestockRequestDetail(ctxUser(tlBuyer), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: tlSellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail as the selling team: %v", err)
	}

	return detail.Msg.GetRequest()
}

// ACCEPTANCE LANDS ON THE SELLING TEAM'S TIMELINE — with the WAREHOUSE person's name on it, which is
// the piece the buyer cannot get anywhere else.
func TestRestockDetail_TheSellingTeamSeesTheAcceptanceOnItsTimeline(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := acceptAndReadAsSellingTeam(t, db, svc, 0)

	got := trail(req)

	want := []trailStep{stepCreated, stepAccepted}

	if len(got) != len(want) {
		t.Fatalf("timeline = %v, want %v", got, want)
	}

	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("timeline = %v, want %v — an acceptance the buying team cannot see is an "+
				"acceptance it has to phone the warehouse about", got, want)
		}
	}

	acceptance := req.GetLogs()[1]

	// WHO. The accepting warehouse's person, not the buyer who raised it — the step exists to name the
	// other side, and an actor copied off the request would name the wrong one while looking right.
	if acceptance.GetActorUserId() != tlReceiver {
		t.Fatalf("the acceptance names user %d, want the warehouse's %d (the buyer is %d)",
			acceptance.GetActorUserId(), tlReceiver, tlBuyer)
	}

	// WHEN, and the same second the `accepted_at` column carries — the timeline and the accepted-date
	// filter must not disagree about which day a delivery landed.
	if acceptance.GetAtUnix() != req.GetAcceptedAtUnix() {
		t.Fatalf("the acceptance step is stamped %d and the column says %d — one delivery, one moment",
			acceptance.GetAtUnix(), req.GetAcceptedAtUnix())
	}

	if acceptance.GetAtUnix() <= 0 {
		t.Fatalf("the acceptance carries no moment (%d)", acceptance.GetAtUnix())
	}
}

// A COD DELIVERY WRITES TWO STEPS, AND THE FEE COMES FIRST (owner).
//
// The order is the claim: the courier is paid at the door, and THEN the box is opened and counted. Two
// steps rather than one because they are two facts about two pockets — one says goods landed, the
// other says the warehouse is out of pocket for goods it does not own and the selling team now owes it
// (#184). Folded into the acceptance, the payment is invisible on the timeline of the team that has to
// settle it.
func TestRestockDetail_ACODFeeRecordsItsOwnStepBeforeTheAcceptance(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := acceptAndReadAsSellingTeam(t, db, svc, 25000)

	got := trail(req)

	want := []trailStep{stepCreated, stepCharge, stepAccepted}

	if len(got) != len(want) {
		t.Fatalf("timeline = %v, want %v — a COD acceptance is TWO things happening", got, want)
	}

	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("timeline = %v, want %v — the fee is paid at the door BEFORE the box is counted "+
				"in, and the order is what makes the sequence readable", got, want)
		}
	}

	fee := req.GetLogs()[1]

	// The person who paid it is the person who accepted it — one act, one actor. They share a moment
	// too, which is why the ORDER above cannot come from the timestamps and comes from the insert order.
	if fee.GetActorUserId() != tlReceiver {
		t.Fatalf("the fee step names user %d, want the warehouse's %d", fee.GetActorUserId(), tlReceiver)
	}

	if fee.GetAtUnix() != req.GetLogs()[2].GetAtUnix() {
		t.Fatalf("the fee (%d) and the acceptance (%d) are one act and must carry one moment",
			fee.GetAtUnix(), req.GetLogs()[2].GetAtUnix())
	}
}

// MOST DELIVERIES ARE NOT COD, and a step saying "paid nothing at the door" is a claim about something
// that did not happen. Same reasoning that keeps a zero fee out of the liability ledger.
func TestRestockDetail_NoCODFeeWritesNoFeeStep(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := acceptAndReadAsSellingTeam(t, db, svc, 0)

	for _, step := range trail(req) {
		if step == stepCharge {
			t.Fatalf("a non-COD delivery wrote a fee step — timeline %v", trail(req))
		}
	}
}
