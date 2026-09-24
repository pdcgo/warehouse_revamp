package san_excel_readers

import "errors"

// SettlementType is the classification a settlement row is imported as.
//
// ⚠ The set of values is NOT defined yet. context.md points at
// docs/business/settlement/context.md#what-is-settlement_type, and that section is currently an
// empty heading — the eight values it used to list were removed. So there are no constants here
// on purpose: naming them would be inventing the enum rather than reading it.
//
// What IS written down is the Shopee mapping table in context.md, which names three of them —
// withdrawal, fund, marketplace_adjustment. A reader returns those verbatim and refuses to guess
// at anything else.
type SettlementType string

// ErrNoSettlementTypeMapping is for when a row's platform transaction type has no row in the
// mapping table: a gap in the contract, not a broken file — the file is fine and the caller can
// still read every other field.
//
// ⚠ Nothing returns it yet. SettlementType panics rather than classifying, so this is the shape
// the gap will take once the mapping is written, kept here because there is already a known gap
// to return it for: "Program Ekspor Shopee FLEXI" is in the samples and not in the table.
var ErrNoSettlementTypeMapping = errors.New("san_excel_readers: no settlement type mapped for this transaction type")
