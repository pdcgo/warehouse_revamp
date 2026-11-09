package settlement_v1

import settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"

// SettlementTypeText is a type's stored text, for tests that write log rows as SettlementPost does.
func SettlementTypeText(settlementType settlementv1.SettlementType) string {
	return settlementTypeText[settlementType]
}
