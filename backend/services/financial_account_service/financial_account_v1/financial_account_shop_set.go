package financial_account_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

var (
	errShopNotTeams = connect.NewError(connect.CodeNotFound, errors.New("that shop is not one of this team's live shops"))

	errShopIntoUnknown = connect.NewError(connect.CodeInvalidArgument, errors.New("point the shop at a real account"))
)

// FinancialAccountShopSet names the account a shop withdraws into — its `shop_accounts` row
// (a-shop-names-the-account-it-withdraws-into). `shop_id` is unique (a-shop-has-one-account), so pointing a
// shop here MOVES it off whichever account it named before; the answer says which.
//
// ⚠ THE SHOP IS ASKED OF ITS OWN SERVICE FIRST. `shop_id` arrives in the request, and the request's team is
// only the ACCOUNT's scope — without the check, one team's admin could point another team's shop here and
// take its withdrawals.
func (s *Service) FinancialAccountShopSet(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountShopSetRequest],
) (*connect.Response[financial_accountv1.FinancialAccountShopSetResponse], error) {
	msg := req.Msg

	err := s.shops.ShopOfTeam(ctx, msg.GetTeamId(), msg.GetShopId())
	if err != nil {
		return nil, errShopNotTeams
	}

	var previous uint64

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		if account.Status != m.StatusActive {
			return errArchived(account.Name)
		}

		if account.Type == m.TypeUnknown {
			return errShopIntoUnknown
		}

		var before m.ShopAccount

		err = tx.Where("shop_id = ?", msg.GetShopId()).Limit(1).Find(&before).Error
		if err != nil {
			return dbError(err)
		}

		previous = before.AccountID

		// One statement — the unique shop_id is the conflict target, so two admins pointing the same shop at
		// once end with one row, the later one's.
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "shop_id"}},
			DoUpdates: clause.Assignments(map[string]any{"account_id": account.ID, "team_id": account.TeamID, "updated_at": gorm.Expr("NOW()")}),
		}).Create(&m.ShopAccount{
			TeamID:    account.TeamID,
			ShopID:    msg.GetShopId(),
			AccountID: account.ID,
		}).Error
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), msg.GetAccountId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountShopSetResponse{
		Account:           account,
		PreviousAccountId: previous,
	}), nil
}
