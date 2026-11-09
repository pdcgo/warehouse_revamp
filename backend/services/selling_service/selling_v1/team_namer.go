package selling_v1

import (
	"context"
	"strconv"
)

// TeamNamer names teams for a sentence a person reads — today the return accept's refusal, which names the warehouse a
// parcel goes to (only-the-return-warehouse-accepts-a-return: "this return goes to Gudang C"). An interface this service
// owns, so selling_service never imports team_service; the composition root answers it from TeamByIds in process. An
// unknown team is absent from the map.
type TeamNamer interface {
	TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
}

// teamName is a team's name for a sentence, or "warehouse #<id>" when it cannot be named — no namer wired, the lookup
// failed, or the team is unknown. A refusal is never held up by the name it carries.
func (s *Service) teamName(ctx context.Context, id uint64) string {
	if s.names != nil {
		names, err := s.names.TeamNames(ctx, []uint64{id})
		if err == nil && names[id] != "" {
			return names[id]
		}
	}

	return "warehouse #" + strconv.FormatUint(id, 10)
}
