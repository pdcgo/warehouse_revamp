package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/order_import_readers"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// orderImportBatch is the refs read per query and the orders per move — moveOrders' own cap is 200 a call.
const orderImportBatch = 200

// orderImportRun is one import: whose, which shop, which platform's reader, and the file.
type orderImportRun struct {
	teamID, shopID uint64
	// platform is the shop's stored marketplace this import reads ("shopee"), label how a person names it.
	platform, label string
	read            func([]byte) ([]order_import_readers.Order, error)
	content         []byte
}

// importOutcome is what became of one order of the file.
type importOutcome int

const (
	importNotApplied importOutcome = iota
	importAlreadyThere
	importMoved
)

// importedOrder is one order of the file and what became of it — the line the stream writes about it.
type importedOrder struct {
	file    order_import_readers.Order
	outcome importOutcome
	reason  string
	// ours and path are set once the order is matched and has moves to make: one status, or two when it passes
	// through shipped (a-completed-shipping-order-passes-through-shipped).
	ours *selling_service_models.Order
	path []string
	// trail is each status of the path the order has reached, moved holds whether this import moved it there, and
	// stopped whether a step was refused — applyImported's progress along the path.
	trail   []string
	moved   bool
	stopped bool
}

// stop ends the order's path on a refused step: not applied, saying how far it got.
func (o *importedOrder) stop(reason string) {
	o.stopped = true
	o.outcome = importNotApplied
	o.reason = reason

	if o.moved {
		o.reason = o.ours.Status + " → " + strings.Join(o.trail, " → ") + ", then refused: " + reason
	}
}

// finish gives an order that reached the end of its path its outcome.
func (o *importedOrder) finish() {
	if !o.moved {
		o.outcome = importAlreadyThere
		o.reason = "already " + o.path[len(o.path)-1]

		return
	}

	o.outcome = importMoved
	o.reason = o.ours.Status + " → " + strings.Join(o.trail, " → ")
}

// importOrders is both imports (the-import-moves-only-after-handover): the shop is checked, the file read into one
// order per ref, each matched to this shop's live order with that ref, and the moves customer service makes after
// handover made through moveOrders — the code a hand move runs. Every other order is listed with its reason.
//
// A REFUSAL IS A LINE, NOT AN ERROR. A shop that is not this platform's, a file that is not its export: one ERROR
// line ends the stream before any order is touched. Only the database failing is an error of the RPC.
//
// IT FINISHES WHETHER ANYONE WATCHES, as the settlement import does: the work runs on a context the caller's
// disconnect does not cancel, so closing the dialog stops the lines, never the moves halfway through a file.
func (s *Service) importOrders(callerCtx context.Context, run orderImportRun, logger *slog.Logger) error {
	ctx := context.WithoutCancel(callerCtx)

	var shop selling_service_models.Shop

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND team_id = ? AND deleted = ?", run.shopID, run.teamID, false).
		First(&shop).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		logger.Error("this shop is not one of this team's shops")

		return nil
	}

	if err != nil {
		return dbError(err)
	}

	if shop.Marketplace != run.platform {
		logger.Error(fmt.Sprintf("%s is not a %s shop — import its orders with its own platform's import", shop.Name, run.label))

		return nil
	}

	logger.Info(fmt.Sprintf("reading %s's %s order export", shop.Name, run.label))

	read, err := run.read(run.content)
	if err != nil {
		logger.Error(err.Error())

		return nil
	}

	count := uint32(len(read))
	logger.Info(fmt.Sprintf("%d orders in the file", count), "count", count)

	orders := make([]*importedOrder, len(read))
	for i := range read {
		orders[i] = &importedOrder{file: read[i]}
	}

	err = s.matchImported(ctx, run, shop, orders)
	if err != nil {
		return dbError(err)
	}

	s.applyImported(ctx, run, orders, logger)

	tally := &sellingv1.OrderImportTally{}

	for i, order := range orders {
		step := slog.Uint64("step", uint64(i+1))

		switch order.outcome {
		case importMoved:
			tally.Moved++
			logger.Info(fmt.Sprintf("%s: %s (%s)", order.file.Ref, order.reason, order.file.Words), step)
		case importAlreadyThere:
			tally.AlreadyThere++
			logger.Info(fmt.Sprintf("%s: %s (%s)", order.file.Ref, order.reason, order.file.Words), step)
		default:
			tally.NotApplied++
			logger.Warn(fmt.Sprintf("%s: %s (%s)", order.file.Ref, order.reason, order.file.Words), step)
		}
	}

	logger.Info(
		fmt.Sprintf("done — %d moved, %d already there, %d not applied", tally.Moved, tally.AlreadyThere, tally.NotApplied),
		slog.Any("tally", tally),
	)

	return nil
}

// matchImported finds each order's live order in this shop — not cancelled — and decides what the import would do
// with it. Nothing is written here; the moves are applyImported's.
func (s *Service) matchImported(
	ctx context.Context,
	run orderImportRun,
	shop selling_service_models.Shop,
	orders []*importedOrder,
) error {
	found := map[string][]*selling_service_models.Order{}

	for start := 0; start < len(orders); start += orderImportBatch {
		end := min(start+orderImportBatch, len(orders))

		refs := make([]string, 0, end-start)
		for _, order := range orders[start:end] {
			refs = append(refs, order.file.Ref)
		}

		var ours []selling_service_models.Order

		// orders_team_external_ref_idx — (team_id, order_external_ref_id), partial on a ref being present.
		//
		// ⚠ The `<> ''` is LOAD-BEARING. The planner proves an IN list implies the partial index's predicate only for
		// lists of up to 100 items, and a batch is 200: without it the lookup seq-scans every order the team has
		// (audits/services/selling_service/performances/ShopeeOrderImport.md, finding 2).
		err := s.db.
			WithContext(ctx).
			Select("id", "team_id", "warehouse_id", "shop_id", "status", "order_external_ref_id").
			Where("team_id = ? AND order_external_ref_id <> '' AND order_external_ref_id IN ? AND shop_id = ? AND status <> ?",
				run.teamID, refs, run.shopID, orderStatusCancel).
			Find(&ours).
			Error
		if err != nil {
			return err
		}

		for i := range ours {
			found[ours[i].OrderExternalRefID] = append(found[ours[i].OrderExternalRefID], &ours[i])
		}
	}

	for _, order := range orders {
		decideImported(order, found[order.file.Ref], shop.Name)
	}

	return nil
}

// importTargets is our status for each thing the platform can say after handover. Before handover the platform's
// word is the warehouse's to act on, and a cancel is the selling team's — neither has a target.
var importTargets = map[order_import_readers.Status]string{
	order_import_readers.StatusInTransit: orderStatusShipped,
	order_import_readers.StatusCompleted: orderStatusCompleted,
	order_import_readers.StatusReturn:    orderStatusReturn,
}

// importRank orders the statuses after handover along the journey, so "the file is behind ours" can be told from a
// move the diagram simply lacks. lost has no rank: it is not behind or ahead of anything, only a different ending.
var importRank = map[string]int{
	orderStatusShipping:        1,
	orderStatusShipped:         2,
	orderStatusProblem:         3,
	orderStatusCompleted:       4,
	orderStatusReturn:          5,
	orderStatusReturnCompleted: 6,
}

// decideImported is the-import-moves-only-after-handover's table for one order: listed, already there, or a move
// for applyImported to make.
func decideImported(order *importedOrder, live []*selling_service_models.Order, shopName string) {
	switch {
	case order.file.Status == order_import_readers.StatusCancelled && len(live) == 0:
		// Nothing live holds the ref — ours is cancelled too, or was never made — so there is nothing to do
		// (a-cancelled-order-with-nothing-live-is-already-there).
		order.outcome = importAlreadyThere
		order.reason = "cancelled on the platform, and no live order here"

		return
	case order.file.Status == order_import_readers.StatusCancelled:
		// Customer service cancels a pending order by hand; a later one goes back through the warehouse first.
		order.reason = "cancelled on the platform"

		return
	case order.file.Status == order_import_readers.StatusUnknown:
		order.reason = "the import does not read these words"

		return
	case len(live) == 0:
		order.reason = "no such order in " + shopName

		return
	case len(live) > 1:
		order.reason = fmt.Sprintf("matches %d orders in %s", len(live), shopName)

		return
	}

	ours := live[0]
	target, after := importTargets[order.file.Status]

	switch {
	case !after:
		// The platform has not seen it leave. While ours has not either, there is nothing to do.
		if _, handedOver := importRank[ours.Status]; handedOver || ours.Status == orderStatusLost {
			order.reason = "the file is behind ours: " + ours.Status + " here"

			return
		}

		order.outcome = importAlreadyThere
		order.reason = "not handed over yet — " + ours.Status + " here"
	case ours.Status == target:
		order.outcome = importAlreadyThere
		order.reason = "already " + target
	case importRank[ours.Status] == 0 && ours.Status != orderStatusLost:
		// pending, processed, picked: every move before the handover is the warehouse's.
		order.reason = "not handed over yet: still " + ours.Status + " here"
	case importRank[ours.Status] > importRank[target]:
		order.reason = "the file is behind ours: " + ours.Status + " here"
	default:
		// The diagram decides the rest, under the lock, in moveOrders — a move it lacks comes back refused, with why.
		order.ours = ours
		order.path = []string{target}

		if bridge, ok := importBridges[orderMove{from: ours.Status, to: target}]; ok {
			order.path = bridge
		}
	}
}

// importBridges are the targets the import reaches in more than one move
// (a-completed-shipping-order-passes-through-shipped): the platform says completed while ours is still shipping, and
// customer service would have marked it shipped, then completed. The status diagram itself gains no edge.
var importBridges = map[orderMove][]string{
	{orderStatusShipping, orderStatusCompleted}: {orderStatusShipped, orderStatusCompleted},
}

// applyImported makes the moves, one moveOrders call per target status and batch: locked, re-checked against the
// status diagram, a timeline row each naming the importer, and the events published once each batch commits.
//
// ONE ROUND PER STEP OF A PATH: every order's first move, then the second move of the orders passing through shipped —
// so the second is only tried once the first has committed, and an order refused at its first step never takes its
// second.
func (s *Service) applyImported(ctx context.Context, run orderImportRun, orders []*importedOrder, logger *slog.Logger) {
	note := run.label + " order import"

	for step := 0; ; step++ {
		byTarget := map[string][]*importedOrder{}
		var targets []string

		for _, order := range orders {
			if order.ours == nil || order.stopped || step >= len(order.path) {
				continue
			}

			target := order.path[step]
			if _, seen := byTarget[target]; !seen {
				targets = append(targets, target)
			}

			byTarget[target] = append(byTarget[target], order)
		}

		if len(targets) == 0 {
			break
		}

		for _, target := range targets {
			s.moveImported(ctx, run, byTarget[target], target, note, logger)
		}
	}

	for _, order := range orders {
		if order.ours != nil && !order.stopped {
			order.finish()
		}
	}
}

// moveImported moves one round's orders to one target, 200 a call.
func (s *Service) moveImported(
	ctx context.Context,
	run orderImportRun,
	group []*importedOrder,
	target, note string,
	logger *slog.Logger,
) {
	logger.Info(fmt.Sprintf("moving %d orders to %s", len(group), target))

	for start := 0; start < len(group); start += orderImportBatch {
		batch := group[start:min(start+orderImportBatch, len(group))]

		ids := make([]uint64, 0, len(batch))
		for _, order := range batch {
			ids = append(ids, order.ours.ID)
		}

		results, moved, err := s.moveOrders(ctx, run.teamID, ids, target, note)
		if err != nil {
			slog.ErrorContext(ctx, "an order import batch could not be saved",
				"team_id", run.teamID, "shop_id", run.shopID, "to", target, "orders", len(ids), "error", err)

			for _, order := range batch {
				order.stop("could not be saved — import the file again")
			}

			continue
		}

		s.publishMoves(ctx, moved)

		for i, result := range results {
			order := batch[i]

			switch {
			case result.GetMoved():
				order.trail = append(order.trail, target)
				order.moved = true
			case orderStatusToText(result.GetStatus()) == target:
				// Moved there by someone else between the read and the lock — a second import of the same file.
				order.trail = append(order.trail, target)
			default:
				order.stop(result.GetRefusedReason())
			}
		}
	}
}
