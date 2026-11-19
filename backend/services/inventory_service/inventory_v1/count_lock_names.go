package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
)

// A COUNT REFUSAL NAMES THE PERSON WHO STARTED THE COUNT (an-abandoned-count-waits-for-the-admin: *"a blocked action names
// the session, who started it and when"* — *"started by Ani, Fri 17:00"*). The lock rows know only the starter's user id,
// and the person is user_service's (HARD RULE 3), so the name is read AFTER the write is refused, outside its
// transaction, through the by-id user read this service already names people with — the export store's UserNames
// (export_store.go; at the composition root UserByIDs as the caller, the read the screens name a person with). It is
// filled into the refusal in place, so every refusal's own words carry it; a name that cannot be read — no store, the
// read failing, no such user, no caller to read as (an event's redelivery) — leaves the refusal naming the user id, as
// before.
//
// Two doors: every inventory RPC over HTTP passes CountRefusalNames (mounted in register.go, inside the shared chain, so
// the read is made as the caller); the in-process seams a person's refusal comes back through — the order's take
// (OrderTransactionCreate), its cancel's check (StockLockCheck) and the return accept (OrderTransactionReturn) — call
// nameCountStarters themselves before their refusal is put into words. A refusal written in one step from a session row
// (a second count while one is active, opnameActiveRefusal) asks countStarter.

// CountRefusalNames is the unary interceptor that names the starter of the count a refused RPC's error names. Every other
// error, and every answer, passes untouched.
func (s *Service) CountRefusalNames() connect.Interceptor {
	return connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			res, err := next(ctx, req)
			if err != nil {
				s.nameCountStarters(ctx, err)
			}

			return res, err
		}
	})
}

// starterSlot is one place a refusal names a count's starter: the id, and the name to fill.
type starterSlot struct {
	id   uint64
	name *string
}

// countStarterSlots is every place `err` names a count's starter — each line of a refused take, a held rack, or the one
// count of a refused move. nil when `err` is no count refusal.
func countStarterSlots(err error) []starterSlot {
	// The take's lines first: its Unwrap answers a NEW CountedError each time, which no message reads.
	var lines *inventory_mutations.CountedLinesError
	if errors.As(err, &lines) {
		slots := make([]starterSlot, 0, len(lines.Lines))
		for i := range lines.Lines {
			lock := &lines.Lines[i].Lock
			slots = append(slots, starterSlot{id: lock.StartedByID, name: &lock.StartedByName})
		}

		return slots
	}

	var rack *inventory_ledgers.RackCountedError
	if errors.As(err, &rack) {
		return []starterSlot{{id: rack.StartedByID, name: &rack.StartedByName}}
	}

	var counted *inventory_ledgers.CountedError
	if errors.As(err, &counted) {
		return []starterSlot{{id: counted.StartedByID, name: &counted.StartedByName}}
	}

	return nil
}

// nameCountStarters fills the display name of every count starter `err` names, in ONE read for all of them. Best
// effort by design: the refusal is the answer, and a name it could not read leaves the user id in its words.
func (s *Service) nameCountStarters(ctx context.Context, err error) {
	if s.exports == nil {
		return
	}

	slots := countStarterSlots(err)

	ids := make([]uint64, 0, len(slots))
	seen := make(map[uint64]bool, len(slots))

	for _, slot := range slots {
		if *slot.name != "" || slot.id == 0 || seen[slot.id] {
			continue
		}

		seen[slot.id] = true
		ids = append(ids, slot.id)
	}

	if len(ids) == 0 {
		return
	}

	names, lookupErr := s.exports.UserNames(ctx, ids)
	if lookupErr != nil {
		return
	}

	for _, slot := range slots {
		if *slot.name == "" {
			*slot.name = names[slot.id]
		}
	}
}

// countStarter is the starter of a count as a refusal names them — the display name, read now through the same user
// read, or the user id when it cannot be read.
func (s *Service) countStarter(ctx context.Context, id uint64) string {
	lock := inventory_ledgers.CountLock{StartedByID: id}
	if s.exports == nil || id == 0 {
		return lock.Starter()
	}

	names, err := s.exports.UserNames(ctx, []uint64{id})
	if err == nil {
		lock.StartedByName = names[id]
	}

	return lock.Starter()
}
