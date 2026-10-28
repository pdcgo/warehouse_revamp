package selling_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// errNoteBlank is a note of only spaces. The proto's min_len counts the spaces, so the handler, which trims, is what
// refuses it.
var errNoteBlank = errors.New("a note must say something — spaces alone are not a note")

// OrderNoteCreate writes one NOTE on an order (a-note-is-a-timeline-row): an order_timeline_logs row with NO status —
// the trimmed text, the side it came from, who wrote it and when. Either end of the order writes one: its selling team
// ("the buyer asked for the glass one wrapped") and its warehouse ("no goods on Rak A").
//
// APPEND-ONLY. There is no edit and no delete, here or anywhere: a correction is a new note, so an instruction somebody
// already acted on cannot change under them.
//
// THE SIDE FOLLOWS FROM THE SCOPE, never from the request: `selling` when the caller is the order's team, `warehouse`
// when it is the order's warehouse. A team that is both ends (its own warehouse) writes from `selling` — a note has no
// move to say which end made it, and the team that placed the order is the one that wrote its first note.
//
// ANY OTHER TEAM READS NotFound, the same answer as an order that does not exist, so a caller cannot probe for ids.
// ⚠ That includes Root/Administrator scoped to the ROOT team: the policy admits them, but the root team is neither end
// of any order, and a note must carry the side it came from — inventing one would put words in a side's mouth. Root
// reads every order (OrderDetail's readsEveryTeam) but writes a note only scoped to one of the order's two ends.
//
// Two statements, no transaction and no lock: the read is the scope check, and the two columns it reads never change
// once the order is placed (the warehouse is frozen at create). The row's foreign key is what holds if the order went
// away between them.
func (s *Service) OrderNoteCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderNoteCreateRequest],
) (*connect.Response[sellingv1.OrderNoteCreateResponse], error) {
	teamID := req.Msg.GetTeamId()

	note := strings.TrimSpace(req.Msg.GetNote())
	if note == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errNoteBlank)
	}

	var order selling_service_models.Order

	err := s.db.
		WithContext(ctx).
		Select("id", "team_id", "warehouse_id").
		Where("id = ? AND (team_id = ? OR warehouse_id = ?)", req.Msg.GetOrderId(), teamID, teamID).
		First(&order).
		Error
	if err != nil {
		return nil, mapOrderErr(err)
	}

	logs := []selling_service_models.OrderTimelineLog{{
		OrderID: order.ID,
		// No status: a note moves nothing (a-note-is-a-timeline-row).
		Status:  "",
		Note:    note,
		From:    noteFrom(&order, teamID),
		ActorID: eventActor(ctx),
		// Stamped here, as every timeline writer stamps its own row — the row is written at the moment it describes.
		CreatedAt: time.Now(),
	}}

	err = recordTimelineLogs(s.db.WithContext(ctx), logs)
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.OrderNoteCreateResponse{Log: timelineLogToProto(&logs[0])}), nil
}

// noteFrom is the side a note is written from: the selling team when the caller is the order's team — a team that is
// both ends included — and the warehouse otherwise. The caller is one of the two; the scoped read made sure of it.
func noteFrom(order *selling_service_models.Order, teamID uint64) string {
	if callerSide(order, teamID)&sideSelling != 0 {
		return timelineFromSelling
	}

	return timelineFromWarehouse
}
