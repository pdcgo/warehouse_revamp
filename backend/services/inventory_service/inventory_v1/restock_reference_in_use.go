package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A REFERENCE IN USE STOPS THE RESTOCK — the server half of a-reference-in-use-stops-the-restock-form
// (docs/technical/frontend/restock_decision.md): a resi or an Order ID, each on its own, already on another restock of
// this team that is not cancelled, exact but for letter case and the spaces around it.
//
// The rule is kept by the DATABASE, not here: inventory 00048's two partial unique indexes, one per reference. A create
// or an ongoing edit that would give a second restock one of those values fails at its own INSERT / UPDATE — and of two
// saves at the same second, the second waits on the first's uncommitted row and fails once that commits — so there is
// no check-then-write here for a concurrent save to slip between. The restock being edited is never its own duplicate
// (an index does not compare a row with itself), and an arrived restock's references cannot change (editArrived), so
// nothing is asked of them again.
//
// What the violation does not say is WHICH reference, or WHO holds it: GORM's TranslateError replaces the driver's error
// — and its constraint name — with gorm.ErrDuplicatedKey. So once the transaction has rolled back, referenceRefusal
// asks: one probe of each index for the other restock holding the value. It runs only on a refused save.

// restockReference is one of the two references and the column holding it. Fixed strings, never typed input: the column
// is written into the SQL.
type restockReference struct {
	reference inventoryv1.RestockReference
	column    string
	// How the refusal's sentence names it.
	word string
}

var (
	receiptReference = restockReference{
		reference: inventoryv1.RestockReference_RESTOCK_REFERENCE_RECEIPT,
		column:    "receipt",
		word:      "resi",
	}
	invoiceRefReference = restockReference{
		reference: inventoryv1.RestockReference_RESTOCK_REFERENCE_INVOICE_REF,
		column:    "invoice_ref_id",
		word:      "Order ID",
	}
)

// errRestockReferenceInUse is the refusal's sentence when no holder could be named in it.
var errRestockReferenceInUse = errors.New("a resi or an Order ID of this restock is already on another restock of this team")

// isReferenceClash is how a save that would make a second holder fails: the unique violation, or — two ONGOING EDITS
// trading their references at the same instant, each holding its own row and waiting on the other's old value — the
// deadlock Postgres breaks by aborting one (40P01). Either way the serial answer is the same refusal (in either order
// the other restock still holds the value), so both go through referenceRefusal, which leaves a failure no reference
// explains as it was.
func isReferenceClash(err error) bool {
	if isUniqueViolation(err) {
		return true
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "40P01"
	}

	return false
}

// referenceRefusal turns a save's unique violation into the refusal the form shows: AlreadyExists, carrying a
// RestockReferenceInUse detail naming each reference held and the restock holding it. exceptID is the restock being
// edited, 0 on a create. A violation no reference explains — no other restock holds either value — stays the error it
// was: it was not one of 00048's indexes (or its holder was cancelled in the meantime, and a second save passes).
func (s *Service) referenceRefusal(
	ctx context.Context,
	teamID, exceptID uint64,
	receipt, invoiceRef string,
	cause error,
) error {
	held, err := s.referencesHeld(ctx, teamID, exceptID, receipt, invoiceRef)
	if err != nil {
		return restockErr(errors.Join(cause, err))
	}

	if len(held) == 0 {
		return restockErr(cause)
	}

	return referenceInUseError(held)
}

// referencesHeld finds, for each reference given, the other restock of the team that holds it — 00048's index lets only
// one hold a value at a time. The predicate repeats the index's word for word, literals included, so each probe is an
// index scan of it; no ORDER BY / LIMIT, which the planner answers by walking the primary key backwards instead.
func (s *Service) referencesHeld(
	ctx context.Context,
	teamID, exceptID uint64,
	receipt, invoiceRef string,
) ([]*inventoryv1.RestockReferenceHeld, error) {
	asked := []struct {
		ref   restockReference
		value string
	}{
		{receiptReference, receipt},
		{invoiceRefReference, invoiceRef},
	}

	var held []*inventoryv1.RestockReferenceHeld

	for _, a := range asked {
		// btrim's spaces — an empty reference holds nothing.
		if strings.Trim(a.value, " ") == "" {
			continue
		}

		var holders []inventory_service_models.Restock

		err := s.db.
			WithContext(ctx).
			Select("id", "status").
			Where("team_id = ? AND id <> ?", teamID, exceptID).
			Where(fmt.Sprintf("status <> 'cancelled' AND btrim(%s) <> ''", a.ref.column)).
			Where(fmt.Sprintf("lower(btrim(%s)) = lower(btrim(?))", a.ref.column), a.value).
			Find(&holders).
			Error
		if err != nil {
			return nil, err
		}

		if len(holders) == 0 {
			continue
		}

		held = append(held, &inventoryv1.RestockReferenceHeld{
			Reference:    a.ref.reference,
			HolderId:     holders[0].ID,
			HolderStatus: restockStatusFromText(holders[0].Status),
		})
	}

	return held, nil
}

// referenceInUseError is the AlreadyExists the form maps onto the field: its sentence names each holder by number and
// status ("the resi is already on restock #502 (arrived)"), and its detail carries the same for the screen.
func referenceInUseError(held []*inventoryv1.RestockReferenceHeld) error {
	words := make([]string, 0, len(held))

	for _, h := range held {
		words = append(words, fmt.Sprintf("the %s is already on restock #%d (%s)",
			referenceWord(h.GetReference()), h.GetHolderId(), restockStatusToText(h.GetHolderStatus())))
	}

	out := connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("%w: %s", errRestockReferenceInUse, strings.Join(words, "; ")))

	detail, detailErr := connect.NewErrorDetail(&inventoryv1.RestockReferenceInUse{Held: held})
	if detailErr == nil {
		out.AddDetail(detail)
	}

	return out
}

func referenceWord(ref inventoryv1.RestockReference) string {
	if ref == invoiceRefReference.reference {
		return invoiceRefReference.word
	}

	return receiptReference.word
}
