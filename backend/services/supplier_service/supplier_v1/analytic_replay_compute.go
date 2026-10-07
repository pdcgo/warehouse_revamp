package supplier_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// ReplayBroker is what a replay needs from the message broker, in this service's own terms. The implementation lives
// in the composition root, which knows the subscription and the project.
type ReplayBroker interface {
	// ReplayWindow is how far back the fold's subscription can still redeliver, read from Pub/Sub's own configuration.
	ReplayWindow(ctx context.Context) (time.Duration, error)

	// Seek redelivers every message published at or after `to` through the normal webhook.
	Seek(ctx context.Context, to time.Time) error
}

var errNoReplayBroker = errors.New("no message broker is configured for replay")

// noReplayBroker is what a Service built without a broker uses: every replay is REFUSED. Never a silent success — a
// replay that deletes and cannot rebuild is the worst thing this RPC can do.
type noReplayBroker struct{}

func (noReplayBroker) ReplayWindow(context.Context) (time.Duration, error) {
	return 0, errNoReplayBroker
}

func (noReplayBroker) Seek(context.Context, time.Time) error {
	return errNoReplayBroker
}

var errReplayLockHeld = connect.NewError(
	connect.CodeFailedPrecondition,
	errors.New("process_event_lock is already held — another replay or a developer's maintenance is in progress"),
)

// AnalyticReplayCompute rebuilds every figure row from `start_date` onward — settlement's replay, read for the
// supplier (the-report-is-processed-like-settlement):
//
//	refuse outside the retention, or into the backfilled past → lock → delete two tables on one line → seek → unlock
//
// ⚠ THE BACKFILLED PAST CANNOT BE REPLAYED. Figures folded by `san supplier backfill-figures`
// (past-accepts-are-backfilled-once) were never on the broker, so a seek would not bring them back. A replay must
// therefore start AFTER the live fold's first day (`figures_live_since`) — every row from then on came off the broker.
//
// ⚠ IT REPORTS "started", NEVER "done". The seek is asynchronous.
func (s *Service) AnalyticReplayCompute(
	ctx context.Context,
	req *connect.Request[supplierv1.AnalyticReplayComputeRequest],
) (*connect.Response[supplierv1.AnalyticReplayComputeResponse], error) {
	start, err := parseDate(req.Msg.GetStartDate())
	if err != nil {
		return nil, err
	}

	window, err := s.broker.ReplayWindow(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("cannot read how far back the subscription can redeliver — refusing rather than guessing: %w", err))
	}

	if window <= 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the subscription retains nothing a seek could redeliver — a replay would only delete"))
	}

	earliest := earliestReplayDay(time.Now(), window)

	if start.Before(earliest) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
			"the replay can reach back to %s — %s is outside the subscription's retention; correct older figures with an adjustment",
			earliest.Format(dateLayout), start.Format(dateLayout)))
	}

	liveSince, err := s.metadataValue(s.db.WithContext(ctx), supplier_service_models.MetadataFiguresLiveSince)
	if err != nil {
		return nil, internal(err)
	}

	err = refuseBackfilledPast(start, liveSince)
	if err != nil {
		return nil, err
	}

	acquired, err := s.swapEventLock(ctx, lockOff, lockOn)
	if err != nil {
		return nil, internal(err)
	}

	if !acquired {
		return nil, errReplayLockHeld
	}

	// Released whatever happens below, on a context the caller's cancellation cannot abandon — a lock left held stops
	// every figure from updating.
	defer func() {
		_, releaseErr := s.swapEventLock(context.WithoutCancel(ctx), lockOn, lockOff)
		if releaseErr != nil {
			slog.ErrorContext(ctx, "replay finished but process_event_lock was NOT released — "+
				"the fold is stopped until it is set back to {\"lock\":false}",
				"error", releaseErr,
			)
		}
	}()

	day := start.Format(dateLayout)

	var reportRows, eventLogs int64

	// ⚠ ONE PREDICATE, TWO TABLES, ONE TRANSACTION. If the dedup delete failed while the figure delete committed, the
	// seek would redeliver into a table that still says "already folded" and the range would stay empty.
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		report := tx.Exec(`DELETE FROM supplier_product_daily_reports WHERE day >= CAST(? AS date)`, day)
		if report.Error != nil {
			return report.Error
		}

		logs := tx.Exec(`DELETE FROM supplier_event_logs WHERE day >= CAST(? AS date)`, day)
		if logs.Error != nil {
			return logs.Error
		}

		reportRows = report.RowsAffected
		eventLogs = logs.RowsAffected

		return nil
	})
	if err != nil {
		return nil, internal(err)
	}

	// The seek boundary is the Jakarta midnight the delete cut at — one calendar for both.
	err = s.broker.Seek(ctx, time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, jakarta))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf(
			"the figures from %s were cleared but the seek failed — run the replay again: %w", day, err))
	}

	return connect.NewResponse(&supplierv1.AnalyticReplayComputeResponse{
		Status:            "started",
		DeletedReportRows: reportRows,
		DeletedEventLogs:  eventLogs,
		EarliestStartDate: earliest.Format(dateLayout),
	}), nil
}

// refuseBackfilledPast refuses a replay that would delete figures only the backfill wrote. Every row on a day AFTER the
// live fold's first accept came off the broker; that day itself may still hold a backfilled accept from earlier in it.
func refuseBackfilledPast(start time.Time, liveSince string) error {
	if liveSince == "" {
		return connect.NewError(connect.CodeFailedPrecondition, errors.New(
			"no live accept has been folded yet — every figure so far came from the backfill, and a replay could not bring them back"))
	}

	since, err := time.Parse(liveSinceLayout, liveSince)
	if err != nil {
		return internal(fmt.Errorf("%s is %q: %w", supplier_service_models.MetadataFiguresLiveSince, liveSince, err))
	}

	sinceDay := since.In(jakarta)
	firstReplayable := time.Date(sinceDay.Year(), sinceDay.Month(), sinceDay.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)

	if start.Before(firstReplayable) {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
			"the figures before %s came from the backfill, which the broker never carried — start the replay on %s or later",
			firstReplayable.Format(dateLayout), firstReplayable.Format(dateLayout)))
	}

	return nil
}

// earliestReplayDay is the first Jakarta day the subscription can still redeliver WHOLE — the first Jakarta midnight
// at or after now − window.
func earliestReplayDay(now time.Time, window time.Duration) time.Time {
	reach := now.Add(-window).In(jakarta)

	midnight := time.Date(reach.Year(), reach.Month(), reach.Day(), 0, 0, 0, 0, jakarta)
	if midnight.Before(reach) {
		midnight = midnight.AddDate(0, 0, 1)
	}

	return time.Date(midnight.Year(), midnight.Month(), midnight.Day(), 0, 0, 0, 0, time.UTC)
}

// swapEventLock moves `process_event_lock` from one value to another, and reports whether it did. A compare-and-set,
// so two replays cannot both believe they took the lock.
func (s *Service) swapEventLock(ctx context.Context, from, to string) (bool, error) {
	result := s.db.WithContext(ctx).
		Model(&supplier_service_models.SupplierServiceMetadata{}).
		Where("key = ? AND value = ?", supplier_service_models.MetadataProcessEventLock, from).
		Updates(map[string]any{
			"value":      to,
			"updated_at": gorm.Expr("NOW()"),
		})
	if result.Error != nil {
		return false, result.Error
	}

	return result.RowsAffected == 1, nil
}
