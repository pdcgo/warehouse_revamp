package settlement_v1

import (
	"context"
	"errors"

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
		TeamID:          msg.GetTeamId(),
		OrderID:         msg.GetOrderId(),
		ShopID:          msg.GetShopId(),
		UniqueID:        msg.GetUniqueId(),
		SettlementType:  msg.GetSettlementType(),
		SourceType:      msg.GetSourceType(),
		Change:          msg.GetChange(),
		OccurredOn:      msg.GetOccurredOn(),
		ReversesID:      msg.GetReversesId(),
		Note:            msg.GetNote(),
		ActorID:         actorFrom(ctx),
		CreatedByUserID: msg.GetCreatedByUserId(),
	}, postOptions{})
	if err != nil {
		return nil, err
	}

	res := &settlementv1.SettlementPostResponse{
		Entry:   entryToProto(&result.Entry, ""),
		Created: result.Created,
	}

	// ⚠ LEFT UNSET for a shop-addressed row: there is no per-order account to return, and an empty
	// OrderSettlement would read as an account whose every figure is 0. The row's own running position
	// is on `entry.balance` either way.
	if result.State != nil {
		res.Settlement = settlementToProto(result.State)
	}

	return connect.NewResponse(res), nil
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

	// Who created the order. Stamped onto the account ONLY by the post that opens it, and ignored by
	// every later one (#the-creator-is-stamped-on-the-state-row).
	CreatedByUserID uint64
}

// CancelInput is an order cancel, as `order_service` posts it.
//
// It carries NO amount, on purpose. A cancel undoes the LIVE sale (#cancel-zeroes-the-live-sale), and
// the live sale is what the account holds right now — not what the order said at placement. If a person
// reversed a wrong sale and reposted the right one, an amount taken from the order would cancel the
// wrong figure. So the amount is read from the account, under its lock.
type CancelInput struct {
	TeamID  uint64
	ShopID  uint64
	OrderID uint64

	// Derived by the caller from the order and the ACT's date (#the-cancel-key-is-order-plus-act-date).
	UniqueID string

	// YYYY-MM-DD — the day the cancel happened.
	OccurredOn string

	ActorID uint64
	Note    string
}

// ErrNothingToCancel is a cancel against an account with no live sale — one that never opened (an
// order with no marketplace total, a failed opening post) or was already zeroed by hand.
//
// Exported because it is a NORMAL answer for the one caller that posts cancels: there is nothing to
// undo, and the order's own cancel has already committed.
var ErrNothingToCancel = connect.NewError(
	connect.CodeFailedPrecondition,
	errors.New("this order has no live sale to cancel"),
)

type PostResult struct {
	Entry settlement_service_models.SettlementLog

	// THE ACCOUNT this row moved, and exactly one of them is set — the grain decides which
	// (#an-entry-names-an-order-or-a-shop). A caller that only ever posts against orders can keep
	// reading `State` and will never see a nil it did not ask for.
	State     *settlement_service_models.OrderSettlement
	ShopState *settlement_service_models.ShopSettlement

	Created bool
}

// postOptions carries what only an in-process caller may ask for, so the wire request cannot.
type postOptions struct {
	// Take the cancel's amount from the account's LIVE sale rather than from the input. See CancelInput.
	changeFromLiveSale bool
}

// setState attaches whichever account the write actually touched. Taken by value and stored as a
// pointer so the caller cannot mistake a zero struct for a real account.
func (r *PostResult) setState(
	hasOrder bool,
	order settlement_service_models.OrderSettlement,
	shop settlement_service_models.ShopSettlement,
) {
	if hasOrder {
		r.State = &order

		return
	}

	r.ShopState = &shop
}

// derefOrder reads a log row's grain as the wire does: an order id, or 0 for a shop-addressed row.
//
// ⚠ The 0 is a WIRE convention, never a storage one — the column is NULL, because 0 already means
// "not recorded" elsewhere in this ledger and one sentinel meaning two things is the bug this design
// keeps finding.
func derefOrder(id *uint64) uint64 {
	if id == nil {
		return 0
	}

	return *id
}

// PostEntry is the in-process write path. See PostInput.
func (s *Service) PostEntry(ctx context.Context, in PostInput) (PostResult, error) {
	return s.postEntry(ctx, in, postOptions{})
}

// CancelSale posts an order's `initial_total_cancel`, taking the amount from the live sale. See
// CancelInput. Returns ErrNothingToCancel when the account holds no live sale.
func (s *Service) CancelSale(ctx context.Context, in CancelInput) (PostResult, error) {
	return s.postEntry(ctx, PostInput{
		TeamID:         in.TeamID,
		OrderID:        in.OrderID,
		ShopID:         in.ShopID,
		UniqueID:       in.UniqueID,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
		// ⚠ The ONLY source a cancel is accepted from (#only-machines-post-the-cancel).
		SourceType: settlementv1.SourceType_SOURCE_TYPE_ORDER,
		OccurredOn: in.OccurredOn,
		ActorID:    in.ActorID,
		Note:       in.Note,
	}, postOptions{changeFromLiveSale: true})
}

func (s *Service) postEntry(ctx context.Context, in PostInput, opts postOptions) (PostResult, error) {
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

	// ⚠ THE GRAIN IS DECIDED BY THE TYPE, not left to the caller (#an-entry-names-an-order-or-a-shop).
	// Both directions are refused, because each would produce a row nothing can read correctly:
	//
	//   - a sale with no order has no account to open and never reaches the detail panel;
	//   - a system adjustment ON an order files a repair that spans many orders against one of them,
	//     and moves that order's balance for something the marketplace never did.
	if isInitialType(typeText) && in.OrderID == 0 {
		return out, errInitialNeedsOrder
	}

	if typeText == typeSystemAdjustment && in.OrderID != 0 {
		return out, errAdjustmentIsShopWide
	}

	occurred, err := parseDate(in.OccurredOn)
	if err != nil {
		return out, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// THE ACCOUNT. Which table it lives in is the grain, but the protocol is identical either way:
		// insert-if-absent, then lock. The account must EXIST before it can be locked — lock-then-read
		// does not protect a row that is not there yet, and two concurrent first-postings would
		// otherwise both find nothing, both insert, and lose one update. DO NOTHING rather than an
		// existence check, because the check and the insert would be the same race one level up.
		var (
			orderState settlement_service_models.OrderSettlement
			shopState  settlement_service_models.ShopSettlement

			// The position this row builds on, whichever account it came from.
			prevBalance int64
		)

		if in.OrderID != 0 {
			opening := settlement_service_models.OrderSettlement{
				OrderID: in.OrderID,
				TeamID:  in.TeamID,
				ShopID:  in.ShopID,
				// ⚠ STAMPED HERE AND NOWHERE ELSE. DO NOTHING leaves an existing account untouched, so
				// only the post that OPENS the account names the creator — set once, as decided.
				CreatedByUserID: in.CreatedByUserID,
			}

			err := tx.
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&opening).
				Error
			if err != nil {
				return dbError(err)
			}

			// Now guaranteed present, so this serialises every concurrent poster on one order.
			err = tx.
				Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("order_id = ?", in.OrderID).
				Take(&orderState).
				Error
			if err != nil {
				return dbError(err)
			}

			// The scope proves the caller belongs to the team it named. It does NOT prove the account
			// does — so the account is checked too, or one team could append to another's ledger
			// simply by knowing an order id.
			if orderState.TeamID != in.TeamID {
				return errWrongTeam
			}

			if orderState.ShopID != in.ShopID {
				return errWrongShop
			}

			prevBalance = orderState.LastBalance
		} else {
			// THE SHOP GRAIN. `shop_settlements` exists to be locked exactly as `order_settlements` is
			// — without a row to take FOR UPDATE, two concurrent shop-addressed posts read the same
			// previous balance and the second silently overwrites the first's position.
			opening := settlement_service_models.ShopSettlement{
				ShopID: in.ShopID,
				TeamID: in.TeamID,
			}

			err := tx.
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&opening).
				Error
			if err != nil {
				return dbError(err)
			}

			err = tx.
				Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("shop_id = ?", in.ShopID).
				Take(&shopState).
				Error
			if err != nil {
				return dbError(err)
			}

			// Same reasoning as the order account: the scope proves the caller's team, not the
			// account's. A shop belongs to one team, so a mismatch means the caller named someone
			// else's shop.
			if shopState.TeamID != in.TeamID {
				return errWrongTeam
			}

			prevBalance = shopState.LastBalance
		}

		// IDEMPOTENCY. `.Find` rather than `.First` — a miss here is the NORMAL case, and First would
		// turn it into an error to unwrap.
		//
		// ⚠ Keyed on `unique_id` ALONE (#00002). The index it mirrors is global rather than scoped to
		// the order, because `order_id` is nullable — a shop-addressed row has no order to scope by,
		// and Postgres would have let `(NULL, key)` insert twice.
		//
		// ⚠ BEFORE THE LIVE-SALE RULES BELOW, deliberately: a retried cancel finds its own row here and
		// returns it, where the rules would otherwise see the zeroed sale and refuse the retry.
		var existing settlement_service_models.SettlementLog

		err = tx.
			Where("unique_id = ?", in.UniqueID).
			Limit(1).
			Find(&existing).
			Error
		if err != nil {
			return dbError(err)
		}

		// A hit on ANOTHER account is a collision, not a retry. Returning it would hand the caller a
		// row from an account it never wrote to, labelled as its own successful (idempotent) write.
		// Compared across the GRAIN too: an order row and a shop row are different accounts even when
		// they share a shop.
		if existing.ID != 0 && derefOrder(existing.OrderID) != in.OrderID {
			return errUniqueIDTaken
		}

		if existing.ID != 0 {
			// Already written. Return it unchanged, and say so — a caller whose key recipe is broken
			// has no other way to learn that it has silently stopped recording.
			out = PostResult{Entry: existing, Created: false}
			out.setState(in.OrderID != 0, orderState, shopState)

			return nil
		}

		// A reversal points BACKWARDS at a row of the SAME account. Checked because a dangling pointer
		// in an append-only ledger can never be repaired by an edit.
		//
		// ⚠ `order_id = ?` cannot express the shop grain — in SQL, `order_id = NULL` is never true. The
		// predicate is split so a shop-addressed reversal is scoped to its shop instead.
		if in.ReversesID != 0 {
			var reversed settlement_service_models.SettlementLog

			scoped := tx.Where("id = ?", in.ReversesID)
			if in.OrderID != 0 {
				scoped = scoped.Where("order_id = ?", in.OrderID)
			} else {
				scoped = scoped.Where("order_id IS NULL AND shop_id = ?", in.ShopID)
			}

			err = scoped.Limit(1).Find(&reversed).Error
			if err != nil {
				return dbError(err)
			}

			if reversed.ID == 0 {
				return errReversesUnknown
			}
		}

		// THE LIVE SALE'S RULES — read under the account's lock, so two concurrent posts cannot both see
		// "no live sale" and both open one.
		if in.OrderID != 0 {
			if opts.changeFromLiveSale {
				if orderState.InitialTotal == 0 {
					return ErrNothingToCancel
				}

				// The exact opposite of the live sale: `initial_total` is NEGATIVE on the log and the
				// state stores it POSITIVE, so the cancel's positive change is the state's own figure.
				in.Change = orderState.InitialTotal
			}

			// A reversal (reverses_id set) is how a live sale is taken DOWN, so it is exempt — it is the
			// first half of reverse-then-repost.
			if typeText == typeInitialTotal && in.ReversesID == 0 && orderState.InitialTotal != 0 {
				return errSaleAlreadyOpen
			}

			if typeText == typeInitialTotalCancel && in.Change > orderState.InitialTotal {
				return errCancelExceedsSale
			}
		}

		entry := settlement_service_models.SettlementLog{
			ShopID:         in.ShopID,
			TeamID:         in.TeamID,
			ActorID:        in.ActorID,
			SourceType:     sourceText,
			SettlementType: typeText,
			Change:         in.Change,
			Balance:        prevBalance + in.Change,
			UniqueID:       in.UniqueID,
			OccurredOn:     occurred,
			// `posted_on` is left to the column's DEFAULT CURRENT_DATE and read back by the insert, so
			// the day the event announces is the day the database stored — one calendar, the session's.
			Note: in.Note,
		}

		if in.OrderID != 0 {
			order := in.OrderID
			entry.OrderID = &order
		}

		if in.ReversesID != 0 {
			reverses := in.ReversesID
			entry.ReversesID = &reverses
		}

		err = tx.Create(&entry).Error
		if err != nil {
			return dbError(err)
		}

		// THE PROJECTION, into whichever account this row belongs to. Both are the same formula over
		// the rows of that account:
		//
		//	last_balance  =  SUM(change) over every row
		//	initial_total = −SUM(change) over the two initial types   (order accounts only)
		//
		// The second line is why a cancel needs no special case. Its `change` is the exact opposite of
		// the sale's, so the running sum returns to zero on its own.
		if in.OrderID != 0 {
			orderState.LastBalance = entry.Balance

			if isInitialType(typeText) {
				orderState.InitialTotal -= in.Change
			}

			err = tx.
				Model(&settlement_service_models.OrderSettlement{}).
				Where("order_id = ?", in.OrderID).
				Updates(map[string]any{
					"initial_total": orderState.InitialTotal,
					"last_balance":  orderState.LastBalance,
					"updated_at":    gorm.Expr("NOW()"),
				}).
				Error
		} else {
			// ⚠ The shop account has no `initial_total`: a sale belongs to an order, and the type
			// guard above already refuses an initial row with no order.
			shopState.LastBalance = entry.Balance

			err = tx.
				Model(&settlement_service_models.ShopSettlement{}).
				Where("shop_id = ?", in.ShopID).
				Updates(map[string]any{
					"last_balance": shopState.LastBalance,
					"updated_at":   gorm.Expr("NOW()"),
				}).
				Error
		}

		if err != nil {
			return dbError(err)
		}

		out = PostResult{Entry: entry, Created: true}
		out.setState(in.OrderID != 0, orderState, shopState)

		return nil
	})
	if err != nil {
		return PostResult{}, err
	}

	// ANNOUNCED AFTER THE COMMIT, and never fatal — the row is the truth and the event is how its
	// readers learn of it. Published on an idempotent hit too: that is how a publish that failed the
	// first time is repaired by simply retrying the post, and every consumer dedups on the derived id.
	s.publishPosted(ctx, out)

	return out, nil
}
