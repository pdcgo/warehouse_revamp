package financial_account_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountArchive takes an account out of every picker — ONLY AT A ZERO BALANCE
// (an-account-is-archived-only-at-zero): an account still holding money is money the screens would stop
// showing. Its operational mark goes with it — an archived account pays for nothing. Its history stays, and
// a broker row still posts into it (my spec: refusing would dead-letter money that really moved).
//
// The balance is read under the account's lock, so a row posting at the same moment cannot slip in between
// the check and the archive.
func (s *Service) FinancialAccountArchive(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountArchiveRequest],
) (*connect.Response[financial_accountv1.FinancialAccountArchiveResponse], error) {
	msg := req.Msg

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		if account.Balance != 0 {
			return connect.NewError(connect.CodeFailedPrecondition,
				fmt.Errorf("%s still holds %s — move it out first; an account is archived only at zero", account.Name, formatRupiah(account.Balance)))
		}

		err = tx.Where("account_id = ?", account.ID).Delete(&m.OperationalAccount{}).Error
		if err != nil {
			return dbError(err)
		}

		return tx.Model(&m.FinancialAccount{}).
			Where("id = ?", account.ID).
			Updates(map[string]any{"status": m.StatusArchived, "updated_at": gorm.Expr("NOW()")}).
			Error
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), msg.GetAccountId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountArchiveResponse{Account: account}), nil
}

// formatRupiah is a figure in a refusal a person reads — "Rp 600.000".
func formatRupiah(v float64) string {
	n := int64(rupiah(v))
	sign := ""

	if n < 0 {
		sign = "-"
		n = -n
	}

	digits := fmt.Sprintf("%d", n)
	out := ""

	for i, d := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out += "."
		}

		out += string(d)
	}

	return "Rp " + sign + out
}
