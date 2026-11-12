package inventory_ledgers

import (
	"context"
	"time"

	"gorm.io/gorm"
)

// InStockReport gives a test's db a stock report that is never written — for the ledger's own tests, which call the
// writers directly rather than through StockTransaction. Only the tests compile it.
func InStockReport(db *gorm.DB) *gorm.DB {
	ctx := db.Statement.Context
	if ctx == nil {
		ctx = context.Background()
	}

	return db.WithContext(context.WithValue(ctx, stockReportKey{}, newStockReport(time.Now())))
}
