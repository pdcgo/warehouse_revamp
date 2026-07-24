// Package settlement_v1 implements warehouse.settlement.v1.SettlementService — the ledger of what
// teams owe each other (#180).
//
// At this point it is the LEDGER CORE only (#183): the two tables and the single posting function
// everything else calls. The handlers the proto declares (#182) arrive with the screens (#185) and
// the payment flow (#188), so this package is deliberately not mounted yet — a service registered
// with half its RPCs missing would advertise a contract it cannot serve.
package settlement_v1

import (
	"errors"
	"math"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service serves the READ surface. The payment and terms services are declared in
// the same proto and land with #188 and #189 — they are separate services precisely so this one can
// be mounted before they exist, rather than stubbed.
var _ settlementv1connect.SettlementServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// dbError keeps the mapping in one place, as every other service here does.
func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

var errSameTeam = errors.New("a team cannot owe itself")

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
