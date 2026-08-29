package settlement_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// SettlementPost appends one row to an order's ledger and re-projects the account.
//
// ⚠ IT IS IDEMPOTENT, and that is the whole reason all three writers share one RPC. Every one of them
// retries for a different reason — the exporter re-imports an overlapping statement, a person
// double-submits the form, and `order_service` retries a cancel across a network timeout. The last is
// the dangerous one: a retried cancel landing on a fresh key would CREDIT THE ACCOUNT TWICE. Settling
// that in three separate RPCs would be settling it three times, which is how two of them end up wrong.
func (s *Service) SettlementPost(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementPostRequest],
) (*connect.Response[settlementv1.SettlementPostResponse], error) {
	msg := req.Msg

	result, err := s.postEntry(ctx, PostInput{
		TeamID:         msg.GetTeamId(),
		OrderID:        msg.GetOrderId(),
		ShopID:         msg.GetShopId(),
		UniqueID:       msg.GetUniqueId(),
		SettlementType: msg.GetSettlementType(),
		SourceType:     msg.GetSourceType(),
		Change:         msg.GetChange(),
		OccurredOn:     msg.GetOccurredOn(),
		ReversesID:     msg.GetReversesId(),
		Note:           msg.GetNote(),
		ActorID:        actorFrom(ctx),
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&settlementv1.SettlementPostResponse{
		Entry:      entryToProto(&result.Entry, ""),
		Settlement: settlementToProto(&result.State),
		Created:    result.Created,
	}), nil
}

// PostInput is the domain shape of a posting, free of the wire type.
//
// It exists so `order_service` can post IN-PROCESS on order create and cancel without building a
// Connect request and without a network hop to itself — the same reason liability_service's
// `PostEntry` is a domain function. The RPC above is one caller of it, not the only path in.
type PostInput struct {
	TeamID         uint64
	OrderID        uint64
	ShopID         uint64
	UniqueID       string
	SettlementType settlementv1.SettlementType
	SourceType     settlementv1.SourceType
	Change         int64
	OccurredOn     string
	ReversesID     uint64
	Note           string
	ActorID        uint64
}

type PostResult struct {
	Entry   settlement_service_models.SettlementLog
	State   settlement_service_models.OrderSettlement
	Created bool
}

// PostEntry is the in-process write path. See PostInput.
func (s *Service) PostEntry(ctx context.Context, in PostInput) (PostResult, error) {
	return s.postEntry(ctx, in)
}

func (s *Service) postEntry(ctx context.Context, in PostInput) (PostResult, error) {
	var out PostResult

	typeText, ok := settlementTypeText[in.SettlementType]
	if !ok {
		return out, connect.NewError(connect.CodeInvalidArgument, errUnknownType)
	}

	sourceText, ok := sourceTypeText[in.SourceType]
	if !ok {
		return out, connect.NewError(connect.CodeInvalidArgument, errUnknownSource)
	}

	// ⚠ THE ONE RULE ENFORCED BY THE DATA RATHER THAN BY CONVENTION. A cancel zeroes the sale of an
	// order the order service still believes is live — so if a person could post one, the two systems
	// would disagree with no screen showing it. Having `order` as a source of its own is what makes
	// this a check instead of a comment.
	if typeText == typeInitialTotalCancel && sourceText != sourceOrder {
		return out, errCancelNotMachine
	}

	occurred, err := parseDate(in.OccurredOn)
	if err != nil {
		return out, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The account must EXIST before it can be locked — lock-then-read does not protect a row that
		// is not there yet, and two concurrent first-postings would otherwise both find nothing, both
		// insert, and lose one update. DO NOTHING rather than an existence check, because the check
		// and the insert would be the same race one level up.
		opening := settlement_service_models.OrderSettlement{
			OrderID: in.OrderID,
			TeamID:  in.TeamID,
			ShopID:  in.ShopID,
		}

		err := tx.
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&opening).
			Error
		if err != nil {
			return dbError(err)
		}

		// Now it is guaranteed present, so this serialises every concurrent poster on one order.
		var state settlement_service_models.OrderSettlement

		err = tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("order_id = ?", in.OrderID).
			Take(&state).
			Error
		if err != nil {
			return dbError(err)
		}

		// The scope proves the caller belongs to the team it named. It does NOT prove the account
		// does — so the account is checked too, or one team could append to another's ledger simply
		// by knowing an order id.
		if state.TeamID != in.TeamID {
			return errWrongTeam
		}

		if state.ShopID != in.ShopID {
			return errWrongShop
		}

		// IDEMPOTENCY. `.Find` rather than `.First` — a miss here is the NORMAL case, and First would
		// turn it into an error to unwrap.
		var existing settlement_service_models.SettlementLog

		err = tx.
			Where("order_id = ? AND unique_id = ?", in.OrderID, in.UniqueID).
			Limit(1).
			Find(&existing).
			Error
		if err != nil {
			return dbError(err)
		}

		if existing.ID != 0 {
			// Already written. Return it unchanged, and say so — a caller whose key recipe is broken
			// has no other way to learn that it has silently stopped recording.
			out = PostResult{Entry: existing, State: state, Created: false}

			return nil
		}

		// A reversal points BACKWARDS at a row of the same order. Checked because a dangling pointer
		// in an append-only ledger can never be repaired by an edit.
		if in.ReversesID != 0 {
			var reversed settlement_service_models.SettlementLog

			err = tx.
				Where("id = ? AND order_id = ?", in.ReversesID, in.OrderID).
				Limit(1).
				Find(&reversed).
				Error
			if err != nil {
				return dbError(err)
			}

			if reversed.ID == 0 {
				return errReversesUnknown
			}
		}

		entry := settlement_service_models.SettlementLog{
			OrderID:        in.OrderID,
			ShopID:         in.ShopID,
			TeamID:         in.TeamID,
			ActorID:        in.ActorID,
			SourceType:     sourceText,
			SettlementType: typeText,
			Change:         in.Change,
			Balance:        state.LastBalance + in.Change,
			UniqueID:       in.UniqueID,
			OccurredOn:     occurred,
			PostedOn:       time.Now(),
			Note:           in.Note,
		}

		if in.ReversesID != 0 {
			reverses := in.ReversesID
			entry.ReversesID = &reverses
		}

		err = tx.Create(&entry).Error
		if err != nil {
			return dbError(err)
		}

		// THE PROJECTION, and it is exactly the formula the schema documents:
		//
		//	last_balance  =  SUM(change) over every row
		//	initial_total = −SUM(change) over the two initial types
		//
		// The second line is why a cancel needs no special case. Its `change` is the exact opposite of
		// the sale's, so the running sum returns to zero on its own — and if a second sale was ever
		// posted by hand, one cancel correctly does NOT zero it, because two sales are on the account.
		state.LastBalance = entry.Balance

		if isInitialType(typeText) {
			state.InitialTotal -= in.Change
		}

		err = tx.
			Model(&settlement_service_models.OrderSettlement{}).
			Where("order_id = ?", in.OrderID).
			Updates(map[string]any{
				"initial_total": state.InitialTotal,
				"last_balance":  state.LastBalance,
				"updated_at":    time.Now(),
			}).
			Error
		if err != nil {
			return dbError(err)
		}

		out = PostResult{Entry: entry, State: state, Created: true}

		return nil
	})
	if err != nil {
		return PostResult{}, err
	}

	return out, nil
}
