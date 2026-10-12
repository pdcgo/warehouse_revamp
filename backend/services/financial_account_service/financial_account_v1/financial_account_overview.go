package financial_account_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountOverview serves the BALANCES — per account, and a total per type. The one read that
// carries money, kept apart from the list so who may see it is one policy line
// (seeing-is-team-wide-moving-is-admin-and-up).
//
// A balance may be below zero — warned on screen, never refused (below-zero-is-warned-never-refused) — so
// each type total counts its accounts below zero, once, for the screen's banner.
func (s *Service) FinancialAccountOverview(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountOverviewRequest],
) (*connect.Response[financial_accountv1.FinancialAccountOverviewResponse], error) {
	msg := req.Msg
	db := s.db.WithContext(ctx)

	items := []*financial_accountv1.FinancialAccountOverviewResponseItem{}

	for _, want := range uniqueMetrics(msg.GetMetricRequest()) {
		switch want {
		case financial_accountv1.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_BALANCE:
			balances := &financial_accountv1.FinancialAccountBalanceMapItem{
				MapData: map[uint64]*financial_accountv1.FinancialAccountBalanceItem{},
			}

			ids := msg.GetFilter().GetAccountIds()
			if len(ids) > 0 {
				rows := []m.FinancialAccount{}

				err := db.
					Select("id", "balance", "reconciled_at").
					Where("team_id = ? AND id IN ?", msg.GetTeamId(), ids).
					Find(&rows).
					Error
				if err != nil {
					return nil, dbError(err)
				}

				for _, r := range rows {
					balances.MapData[r.ID] = &financial_accountv1.FinancialAccountBalanceItem{
						AccountId:    r.ID,
						Balance:      r.Balance,
						ReconciledAt: optionalTime(r.ReconciledAt),
					}
				}
			}

			items = append(items, &financial_accountv1.FinancialAccountOverviewResponseItem{
				D: &financial_accountv1.FinancialAccountOverviewResponseItem_Balance{Balance: balances},
			})

		case financial_accountv1.FinancialAccountMetricDataType_FINANCIAL_ACCOUNT_METRIC_DATA_TYPE_TYPE_TOTAL:
			type total struct {
				Type           string
				Balance        float64
				AccountCount   int64
				BelowZeroCount int64
			}

			rows := []total{}

			// ACTIVE accounts only — an archived one holds zero by rule.
			err := db.Raw(`
SELECT type,
       COALESCE(SUM(balance), 0)           AS balance,
       COUNT(*)                            AS account_count,
       COUNT(*) FILTER (WHERE balance < 0) AS below_zero_count
FROM financial_accounts
WHERE team_id = ? AND status = ?
GROUP BY type`, msg.GetTeamId(), m.StatusActive).Scan(&rows).Error
			if err != nil {
				return nil, dbError(err)
			}

			// In the screen's order: bank, wallet, cash, then the money whose bank is not named.
			order := []string{m.TypeBankAccount, m.TypeWallet, m.TypeCash, m.TypeUnknown}
			list := &financial_accountv1.FinancialAccountTypeTotalList{}

			for _, t := range order {
				for _, r := range rows {
					if r.Type != t {
						continue
					}

					list.Items = append(list.Items, &financial_accountv1.FinancialAccountTypeTotalItem{
						Type:           typeEnum[r.Type],
						Balance:        r.Balance,
						AccountCount:   r.AccountCount,
						BelowZeroCount: r.BelowZeroCount,
					})
				}
			}

			items = append(items, &financial_accountv1.FinancialAccountOverviewResponseItem{
				D: &financial_accountv1.FinancialAccountOverviewResponseItem_TypeTotal{TypeTotal: list},
			})
		}
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountOverviewResponse{Items: items}), nil
}

func uniqueMetrics(in []financial_accountv1.FinancialAccountMetricDataType) []financial_accountv1.FinancialAccountMetricDataType {
	seen := map[financial_accountv1.FinancialAccountMetricDataType]bool{}
	out := []financial_accountv1.FinancialAccountMetricDataType{}

	for _, v := range in {
		if seen[v] {
			continue
		}

		seen[v] = true
		out = append(out, v)
	}

	return out
}

func optionalTime(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}

	return timestamppb.New(*t)
}
