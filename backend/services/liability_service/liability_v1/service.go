// Package liability_v1 implements the ledger of what teams owe each other (#180).
//
// It serves TWO of the contract's three proto services today: LiabilityService — the read surface
// behind the Liability screens (#185) — and LiabilityTermsService, a creditor's rates and credit
// limits (#189). LiabilityPaymentService (#188) is declared in the same proto and is deliberately
// NOT served yet: a service is mounted whole, so registering it with half its RPCs missing would
// advertise a contract this build cannot honour.
//
// ⚠ THE LEDGER'S WRITE PATH HAS NO WIRE SURFACE, and never will. `PostEntry` is a domain function
// called in-process, because nothing outside this system may assert that one team owes another —
// every posting originates from a real event inside it (a restock accepted, an order placed).
//
// ⚠ TERMS ARE READ BY THE FEES BUT NEVER BY THE LEDGER. Changing a rate changes what FUTURE postings
// charge; entries already written are immutable facts about money that moved.
package liability_v1

import (
	"errors"
	"math"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service serves the READ surface and the TERMS surface (#189).
//
// One impl behind several proto services, as selling_v1 already does. The split is about WHEN each
// can be mounted, not about which struct serves it: a service is mounted whole, so LiabilityTerms
// could not be served until all three of its RPCs existed. LiabilityPaymentService is still absent
// and still deliberately unmounted until #188.
var (
	_ liabilityv1connect.LiabilityServiceHandler        = (*Service)(nil)
	_ liabilityv1connect.LiabilityTermsServiceHandler   = (*Service)(nil)
	_ liabilityv1connect.LiabilityPaymentServiceHandler = (*Service)(nil)
)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// dbError keeps the mapping in one place, as every other service here does.
func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

var errSameTeam = errors.New("a team cannot owe itself")

// The terms change log has no table yet — see terms_history_list.go for what it is waiting on.
var errTermsHistoryNotBuilt = errors.New("the terms change log is not implemented yet")

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
