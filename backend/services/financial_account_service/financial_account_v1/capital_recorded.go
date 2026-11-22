package financial_account_v1

import (
	"context"
	"log/slog"
	"strconv"
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital — one act, one record, two doors): a
// Setor / Tarik Modal made on the account page posts its `capital` row HERE, by hand, as it always has — the balance
// moves at once — and then tells the broker (FinancialAccountCapitalRecorded). expense_service records a SELLING team's
// as the same one record on Biaya (Setoran modal / Prive, *Dicatat di halaman akun*), keyed by this row's id, and posts
// nothing back; a warehouse team's it drops. This service knows no team types, so it tells every team's.
//
// The capital row's description is `Capital in` / `Capital out`, then ` — <the note>` when one was typed
// (capitalDescription); the event carries the note back out of it (capitalNote), so a row posted before the door
// existed builds the very message its act would have sent — the one-time import (HandCapitalEvents) cannot record an
// old act differently from a new one.

const (
	capitalLead     = "Capital "
	capitalNoteJoin = " — "
)

// capitalDescription is a by-hand capital row's description: `Capital in` / `Capital out`, then the note.
func capitalDescription(direction string, note string) string {
	description := capitalLead + direction

	note = strings.TrimSpace(note)
	if note != "" {
		description += capitalNoteJoin + note
	}

	return description
}

// capitalNote is what the person typed, read back out of capitalDescription's text — empty when none was typed.
func capitalNote(description string) string {
	for _, lead := range []string{capitalLead + "in", capitalLead + "out"} {
		if description == lead {
			return ""
		}

		if strings.HasPrefix(description, lead+capitalNoteJoin) {
			return strings.TrimPrefix(description, lead+capitalNoteJoin)
		}
	}

	return description
}

// capitalRecordedEvent is the broker's message for one by-hand capital row. `event_id` is derived from the row, so a
// republish (or the import beside the live door) collides in the listener's claim.
func capitalRecordedEvent(row *m.FinancialAccountLog) *eventsv1.Event {
	ref := strconv.FormatUint(row.ID, 10)

	return &eventsv1.Event{
		EventId:     "financial-account-capital:" + ref,
		OccurredAt:  timestamppb.New(row.CreatedAt),
		AggregateId: "financial-account:" + strconv.FormatUint(row.AccountID, 10),
		Message: &eventsv1.Event_FinancialAccountCapitalRecorded{
			FinancialAccountCapitalRecorded: &eventsv1.FinancialAccountCapitalRecorded{
				LogId:           row.ID,
				TeamId:          row.TeamID,
				AccountId:       row.AccountID,
				Change:          row.Change,
				OccurredOn:      row.OccurredAt.In(jakarta).Format(dateLayout),
				Note:            capitalNote(row.Description),
				ActorId:         row.ActorID,
				ActorIsOverride: row.IsOverride,
				CreatedAtUnix:   row.CreatedAt.Unix(),
			},
		},
	}
}

// publishCapital tells the broker, AFTER the commit. A failed publish is logged, never returned: the money moved and the
// row is the act's own, so the caller must not read it as refused (and retry it into a second row). The Biaya side is
// then short this act until `san expense import-capital` runs — it brings in every by-hand capital row not yet there.
func (s *Service) publishCapital(ctx context.Context, event *eventsv1.Event) {
	err := s.events(ctx, capitalIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "capital committed but its event was not published — Biaya is short this act until "+
			"`san expense import-capital` runs",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}

func capitalIdentity(ctx context.Context) *role_basev1.Identity {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return event_source.SystemIdentity("financial_account_service")
	}

	return identity
}

// HandCapitalEvents is the one-time import's read (`san expense import-capital`): the by-hand capital rows — Setor /
// Tarik Modal made on the account page, every team's — with an id above `afterID`, oldest first, at most `limit`, each
// as the message the live door publishes. A row the expense listener posted from Biaya (`expense_id` set) is not one:
// Biaya already holds it.
func HandCapitalEvents(db *gorm.DB, afterID uint64, limit int) ([]*eventsv1.Event, error) {
	rows := []m.FinancialAccountLog{}

	err := db.
		Where("change_type = ?", m.ChangeCapital).
		Where("expense_id = 0").
		Where("id > ?", afterID).
		Order("id").
		Limit(limit).
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make([]*eventsv1.Event, 0, len(rows))
	for i := range rows {
		out = append(out, capitalRecordedEvent(&rows[i]))
	}

	return out, nil
}
