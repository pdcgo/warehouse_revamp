package settlement_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// ReplayBroker is what a replay needs from the message broker, in this service's own terms. The
// implementation lives in the composition root, which knows the subscription and the project.
type ReplayBroker interface {
	// ReplayWindow is how far back the fold's subscription can still redeliver, read from Pub/Sub's own
	// configuration (#the-replay-is-bounded-by-the-subscription-retention).
	ReplayWindow(ctx context.Context) (time.Duration, error)

	// Seek redelivers every message published at or after `to` through the normal webhook
	// (#the-replay-seeks-the-broker).
	Seek(ctx context.Context, to time.Time) error
}

var errNoReplayBroker = errors.New("no message broker is configured for replay")

// noReplayBroker is what a Service built without a broker uses: every replay is REFUSED. Never a silent
// success — a replay that deletes and cannot rebuild is the worst thing this RPC can do.
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

// AnalyticReplayCompute rebuilds every report row from `start_date` onward
// (analytic_context.md §How AnalyticReplayCompute works).
//
//	refuse outside the retention → lock → delete three tables on one line → seek → unlock
//
// ⚠ IT REPORTS "started", NEVER "done". The seek is asynchronous: the messages come back through the
// webhook over the following minutes, and nothing here can know when the last one has.
func (s *Service) AnalyticReplayCompute(
	ctx context.Context,
	req *connect.Request[settlementv1.AnalyticReplayComputeRequest],
) (*connect.Response[settlementv1.AnalyticReplayComputeResponse], error) {
	start, err := parseDate(req.Msg.GetStartDate())
	if err != nil {
		return nil, err
	}

	// THE ONE BOUND, read and never assumed. If it cannot be read the replay is refused: a guard that
	// guesses deletes days it cannot rebuild.
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
			"the replay can reach back to %s — %s is outside the subscription's retention; repair older damage with a system_adjustment",
			earliest.Format(dateLayout), start.Format(dateLayout)))
	}

	acquired, err := s.swapEventLock(ctx, lockOff, lockOn)
	if err != nil {
		return nil, dbError(err)
	}

	if !acquired {
		return nil, errReplayLockHeld
	}

	// Released whatever happens below, and on a context the caller's cancellation cannot abandon — a lock
	// left held stops every report in the service from updating.
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

	var shopDays, userDays, eventLogs int64

	// ⚠ ONE PREDICATE, THREE TABLES, ONE TRANSACTION (#the-replay-cuts-three-tables-on-one-line). If the
	// dedup delete failed while the report delete committed, the seek would redeliver into a table that
	// still says "already processed" and the range would stay empty.
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		shop := tx.Exec(`DELETE FROM shop_settlement_daily_reports WHERE day >= CAST(? AS date)`, day)
		if shop.Error != nil {
			return shop.Error
		}

		user := tx.Exec(`DELETE FROM user_settlement_daily_reports WHERE day >= CAST(? AS date)`, day)
		if user.Error != nil {
			return user.Error
		}

		logs := tx.Exec(`DELETE FROM settlement_event_logs WHERE day >= CAST(? AS date)`, day)
		if logs.Error != nil {
			return logs.Error
		}

		shopDays = shop.RowsAffected
		userDays = user.RowsAffected
		eventLogs = logs.RowsAffected

		return nil
	})
	if err != nil {
		return nil, dbError(err)
	}

	// The seek boundary is the Jakarta midnight the delete cut at — one calendar for both.
	err = s.broker.Seek(ctx, time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, jakarta))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf(
			"the reports from %s were cleared but the seek failed — run the replay again: %w", day, err))
	}

	return connect.NewResponse(&settlementv1.AnalyticReplayComputeResponse{
		Status:            "started",
		DeletedShopDays:   shopDays,
		DeletedUserDays:   userDays,
		DeletedEventLogs:  eventLogs,
		EarliestStartDate: earliest.Format(dateLayout),
	}), nil
}

// earliestReplayDay is the first Jakarta day the subscription can still redeliver WHOLE — the first
// Jakarta midnight at or after now − window.
func earliestReplayDay(now time.Time, window time.Duration) time.Time {
	reach := now.Add(-window).In(jakarta)

	midnight := time.Date(reach.Year(), reach.Month(), reach.Day(), 0, 0, 0, 0, jakarta)
	if midnight.Before(reach) {
		midnight = midnight.AddDate(0, 0, 1)
	}

	return time.Date(midnight.Year(), midnight.Month(), midnight.Day(), 0, 0, 0, 0, time.UTC)
}

// swapEventLock moves `process_event_lock` from one value to another, and reports whether it did. A
// compare-and-set, so two replays cannot both believe they took the lock.
func (s *Service) swapEventLock(ctx context.Context, from, to string) (bool, error) {
	result := s.db.WithContext(ctx).
		Model(&settlement_service_models.SettlementServiceMetadata{}).
		Where("key = ? AND value = ?", settlement_service_models.MetadataProcessEventLock, from).
		Updates(map[string]any{
			"value":      to,
			"updated_at": gorm.Expr("NOW()"),
		})
	if result.Error != nil {
		return false, result.Error
	}

	return result.RowsAffected == 1, nil
}
