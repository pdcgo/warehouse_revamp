package settlement_v1

import (
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// The enums are stored as TEXT, matching `orders.status` and `liability_entries`. The mapping lives
// here and nowhere else, so a value can only drift in one file.
//
// ⚠ The text is the CONTRACT with the database. Renaming a constant in the proto is free; changing
// one of these strings rewrites history, because rows already carry the old spelling.

const (
	typeInitialTotal         = "initial_total"
	typeInitialTotalCancel   = "initial_total_cancel"
	typeFund                 = "fund"
	typeExternalAdsFee       = "external_ads_fee"
	typeAffiliateFee         = "affiliate_fee"
	typeMarketplaceAdjust    = "marketplace_adjustment"
	typeOther                = "other"

	sourceExporter = "exporter"
	sourceManual   = "manual"
	sourceOrder    = "order"
)

var settlementTypeText = map[settlementv1.SettlementType]string{
	settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL:          typeInitialTotal,
	settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL:   typeInitialTotalCancel,
	settlementv1.SettlementType_SETTLEMENT_TYPE_FUND:                   typeFund,
	settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE:       typeExternalAdsFee,
	settlementv1.SettlementType_SETTLEMENT_TYPE_AFFILIATE_FEE:          typeAffiliateFee,
	settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_ADJUSTMENT: typeMarketplaceAdjust,
	settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER:                  typeOther,
}

var settlementTypeEnum = reverseOf(settlementTypeText)

var sourceTypeText = map[settlementv1.SourceType]string{
	settlementv1.SourceType_SOURCE_TYPE_EXPORTER: sourceExporter,
	settlementv1.SourceType_SOURCE_TYPE_MANUAL:   sourceManual,
	settlementv1.SourceType_SOURCE_TYPE_ORDER:    sourceOrder,
}

var sourceTypeEnum = reverseOf(sourceTypeText)

func reverseOf[E comparable](forward map[E]string) map[string]E {
	back := make(map[string]E, len(forward))
	for enum, text := range forward {
		back[text] = enum
	}

	return back
}

// isInitialType reports whether a row moves the LIVE SALE rather than the balance alone. Both initial
// types do, in opposite directions, which is what makes `initial_total` a projection rather than a
// column somebody maintains.
func isInitialType(text string) bool {
	return text == typeInitialTotal || text == typeInitialTotalCancel
}

func entryToProto(
	log *settlement_service_models.SettlementLog,
	actorName string,
) *settlementv1.SettlementEntry {
	entry := settlementv1.SettlementEntry{
		Id:             log.ID,
		UniqueId:       log.UniqueID,
		OrderId:        log.OrderID,
		ShopId:         log.ShopID,
		TeamId:         log.TeamID,
		ActorId:        log.ActorID,
		SourceType:     sourceTypeEnum[log.SourceType],
		SettlementType: settlementTypeEnum[log.SettlementType],
		Change:         log.Change,
		Balance:        log.Balance,
		OccurredOn:     log.OccurredOn.Format(dateLayout),
		PostedOn:       log.PostedOn.Format(dateLayout),
		Note:           log.Note,
		ActorName:      actorName,
	}

	if log.ReversesID != nil {
		entry.ReversesId = *log.ReversesID
	}

	return &entry
}

func settlementToProto(
	state *settlement_service_models.OrderSettlement,
) *settlementv1.OrderSettlement {
	return &settlementv1.OrderSettlement{
		OrderId:      state.OrderID,
		InitialTotal: state.InitialTotal,
		LastBalance:  state.LastBalance,
		TeamId:       state.TeamID,
		ShopId:       state.ShopID,
	}
}
