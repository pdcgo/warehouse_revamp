package main

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// SHOP ENTRIES' two outside questions (the-shop-entries-page-is-accepted), answered in-process: the statement a shop
// row came from — the importer's own line, read by settlement log id — and the names of who posted or uploaded it, the
// user read. Settlement owns both interfaces and reads neither service's tables (HARD RULE 3).

// settlementStatementSources answers settlement's StatementSources from the importer.
type settlementStatementSources struct {
	importer *settlement_importer_v1.Service
}

func NewSettlementStatementSources(importer *settlement_importer_v1.Service) settlement_v1.StatementSources {
	return &settlementStatementSources{importer: importer}
}

func (a *settlementStatementSources) StatementLines(
	ctx context.Context,
	teamID uint64,
	logIDs []uint64,
) (map[uint64]settlement_v1.StatementLine, error) {
	lines, err := a.importer.StatementLinesBySettlementLogIds(ctx, teamID, logIDs)
	if err != nil {
		return nil, err
	}

	out := make(map[uint64]settlement_v1.StatementLine, len(lines))

	for _, line := range lines {
		out[line.SettlementLogID] = settlement_v1.StatementLine{
			UploadedFileID: line.UploadedFileID,
			Platform:       line.Platform,
			PeriodFrom:     line.PeriodFrom,
			PeriodTo:       line.PeriodTo,
			Sheet:          line.Sheet,
			Description:    line.Description,
			OrderRef:       line.OrderRef,
			Reason:         line.Reason,
			FoundOrderIDs:  line.FoundOrderIDs,
			UploadedBy:     line.UploadedBy,
		}
	}

	return out, nil
}

// settlementUserNames answers settlement's UserNames from UserByIDs, in-process.
type settlementUserNames struct {
	users *user_v1.Service
}

func NewSettlementUserNames(users *user_v1.Service) settlement_v1.UserNames {
	return &settlementUserNames{users: users}
}

func (a *settlementUserNames) UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.users.UserByIDs(ctx, connect.NewRequest(&userv1.UserByIDsRequest{
		Filter:      &userv1.UserByIdsFilter{Ids: ids},
		DataRequest: []userv1.UserByIdsDataType{userv1.UserByIdsDataType_USER_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		return nil, err
	}

	for _, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			for id, general := range item.GetGeneral().GetMapData() {
				out[id] = general.GetName()
			}
		}
	}

	return out, nil
}
