package financial_account_v1

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

var (
	errNoStatement = connect.NewError(
		connect.CodeFailedPrecondition,
		errors.New("an unknown account has no statement to read — name its bank first"),
	)

	errNeedsWhy = connect.NewError(connect.CodeInvalidArgument, errors.New("say why the books and the bank differ"))

	errBadFigure = connect.NewError(connect.CodeInvalidArgument, errors.New("type the figure the bank shows"))
)

// FinancialAccountReconcile takes the figure the bank app shows — or the cash box counts — and posts the
// DIFFERENCE as an `adjustment` (adjustment-is-for-reconciling-only). Nobody types an adjustment's amount or
// its sign.
//
// A non-zero difference needs a note: it is the one row that can hide missing cash. A zero difference posts
// nothing. Either way the account is stamped checked (`reconciled_at`) — both my spec, accepted with the
// prototype. The difference is computed against the balance read UNDER THE LOCK, so a row posting at the same
// moment is either already in it or waits.
func (s *Service) FinancialAccountReconcile(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountReconcileRequest],
) (*connect.Response[financial_accountv1.FinancialAccountReconcileResponse], error) {
	msg := req.Msg

	actual := msg.GetActualBalance()
	if math.IsInf(actual, 0) || math.IsNaN(actual) {
		return nil, errBadFigure
	}

	occurredAt, err := s.pickedDay(msg.GetAsOf())
	if err != nil {
		return nil, err
	}

	actor := actorFrom(ctx)
	note := strings.TrimSpace(msg.GetNote())

	var (
		difference float64
		row        *m.FinancialAccountLog
		stamped    time.Time
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		if account.Status != m.StatusActive {
			return errArchived(account.Name)
		}

		if account.Type == m.TypeUnknown {
			return errNoStatement
		}

		difference = rupiah(actual) - account.Balance

		if difference != 0 {
			if note == "" {
				return errNeedsWhy
			}

			read := "the app showed"
			if account.Type == m.TypeCash {
				read = "the box counted"
			}

			posted, err := post(tx, account, entry{
				changeType:  m.ChangeAdjustment,
				change:      difference,
				description: "Reconcile — " + read + " " + formatRupiah(actual) + " · " + note,
				occurredAt:  occurredAt,
				actorID:     actor,
			})
			if err != nil {
				return err
			}

			row = &posted
		}

		stamped = s.now()

		return tx.Model(&m.FinancialAccount{}).
			Where("id = ?", account.ID).
			Updates(map[string]any{"reconciled_at": stamped, "updated_at": gorm.Expr("NOW()")}).
			Error
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	resp := &financial_accountv1.FinancialAccountReconcileResponse{
		Difference:   difference,
		ReconciledAt: timestamppb.New(stamped),
	}

	if row != nil {
		resp.Log = logToProto(*row)
	}

	return connect.NewResponse(resp), nil
}
