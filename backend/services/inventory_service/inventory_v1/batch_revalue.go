package inventory_v1

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
)

// revalueReasonMax is the reason's limit — the form's counter stops there too (a-limited-field-shows-its-count).
const revalueReasonMax = 200

// BatchRevalue is KOREKSI HARGA — the owning team corrects one batch's unit price (the-owning-team-revalues-with-a-reason,
// the-correct-price-prototype-is-accepted). The policy lets in the selling Owner and Admin of the scoped team, and Root
// and the System Administrator (stamped an override outside it, an-override-is-stamped-in-every-service); the batch must
// be the scoped team's own, or it is NotFound. The reason is required and trimmed; the new price must be above Rp 0
// (a-corrected-price-is-above-zero). Everything else is judged under the batch's row lock by PostRevaluation: no units
// left, a price that moved since the form opened, the same price — FailedPrecondition, nothing written.
func (s *Service) BatchRevalue(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchRevalueRequest],
) (*connect.Response[inventoryv1.BatchRevalueResponse], error) {
	msg := req.Msg

	// The proto's min_len counts spaces; a reason of spaces says nothing (the-owning-team-revalues-with-a-reason).
	reason := strings.TrimSpace(msg.GetReason())
	if reason == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a price correction needs a reason"))
	}

	if utf8.RuneCountInString(reason) > revalueReasonMax {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("the reason is at most 200 characters"))
	}

	// The proto refuses it first on the wire; a direct caller is refused here (a-corrected-price-is-above-zero).
	if !san_money.Positive(msg.GetNewPriceUnit()) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("the new unit price must be above Rp 0"))
	}

	var posted inventory_mutations.Revalued

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var postErr error

		posted, postErr = inventory_mutations.PostRevaluation(tx, inventory_mutations.Revaluation{
			TeamID:            msg.GetTeamId(),
			BatchID:           msg.GetBatchId(),
			ExpectedPriceUnit: msg.GetExpectedPriceUnit(),
			NewPriceUnit:      msg.GetNewPriceUnit(),
			Reason:            reason,
			ActorID:           actorFrom(ctx),
			IsOverride:        overrideFrom(ctx),
		})

		return postErr
	})
	if err != nil {
		return nil, revalueErr(err)
	}

	return connect.NewResponse(&inventoryv1.BatchRevalueResponse{
		TransactionId:   posted.Transaction.ID,
		PriceUnitBefore: posted.PriceBefore,
		PriceUnitAfter:  posted.PriceAfter,
		ValueChange:     posted.ValueChange,
		Units:           posted.Units,
	}), nil
}

// revalueErr maps a correction's refusal to its code, its text unchanged — the form shows it as the server said it.
func revalueErr(err error) error {
	switch {
	case errors.Is(err, inventory_mutations.ErrRevalueNotOwned):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, inventory_mutations.ErrRevalueNoUnits),
		errors.Is(err, inventory_mutations.ErrRevaluePriceMoved),
		errors.Is(err, inventory_mutations.ErrRevalueSamePrice):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
