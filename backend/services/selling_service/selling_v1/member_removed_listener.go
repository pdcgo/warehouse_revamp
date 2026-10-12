package selling_v1

import (
	"context"
	"fmt"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// MemberRemovedHandler drops a removed person's shop access (removing-a-member-drops-their-shop-access): every
// grant they hold on a shop of the team they left. A primary Customer Service flag is ON a grant
// (the-primary-cs-is-a-flag-on-a-grant), so it goes with it. Their grants in other teams stay — they left one team.
//
// ONLY GRANTS MADE BEFORE THE REMOVAL. Pub/Sub delivers at least once and in any order, so this can arrive after the
// person was added back and granted a shop again; the event's occurred_at is the removal's own instant, and a grant
// newer than that is the new membership's and stays.
//
// Idempotent without a dedup row: a second delivery finds nothing older to delete. A database error NACKs, so the
// broker retries; anything else is ACKed.
func (s *Service) MemberRemovedHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		removed := event.GetMemberRemoved()
		if removed == nil {
			return nil
		}

		err := s.db.
			WithContext(ctx).
			Where("user_id = ? AND created_at <= ?", removed.GetUserId(), event.GetOccurredAt().AsTime()).
			Where("shop_id IN (?)", s.db.Model(&selling_service_models.Shop{}).Select("id").Where("team_id = ?", removed.GetTeamId())).
			Delete(&selling_service_models.ShopUser{}).
			Error
		if err != nil {
			return fmt.Errorf("selling: %s: drop shop grants: %w", event.GetEventId(), err)
		}

		return nil
	}
}
