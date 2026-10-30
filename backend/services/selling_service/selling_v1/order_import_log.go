package selling_v1

import (
	"context"
	"log/slog"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// orderImportMessage is one message of an import's stream. Both platforms' responses carry the same five fields.
type orderImportMessage struct {
	level   sellingv1.OrderImportLogLevel
	message string
	step    uint32
	count   uint32
	tally   *sellingv1.OrderImportTally
}

// orderImportLog binds slog to an import's stream (code-implementation-guideline.md, Long Running Task 3): every record
// is one message. As a slog.Handler rather than the guideline's io.Writer, because a handler receives the record's
// LEVEL beside its message — so the level is a field the screen colours by, never text it would have to parse.
//
// Three attributes are the message's own fields: "count" (sticky once known), "step" (sticky, so the closing line
// keeps the bar full) and "tally". A send that fails — the tab closed — is kept, and every later line is dropped.
type orderImportLog struct {
	state *orderImportLogState
}

type orderImportLogState struct {
	send        func(orderImportMessage) error
	step, count uint32
	err         error
}

func newOrderImportLogger(send func(orderImportMessage) error) *slog.Logger {
	return slog.New(&orderImportLog{state: &orderImportLogState{send: send}})
}

func (h *orderImportLog) Enabled(context.Context, slog.Level) bool {
	return true
}

func (h *orderImportLog) Handle(_ context.Context, record slog.Record) error {
	state := h.state
	if state.err != nil {
		return state.err
	}

	message := orderImportMessage{level: sellingv1.OrderImportLogLevel_ORDER_IMPORT_LOG_LEVEL_INFO, message: record.Message}

	switch {
	case record.Level >= slog.LevelError:
		message.level = sellingv1.OrderImportLogLevel_ORDER_IMPORT_LOG_LEVEL_ERROR
	case record.Level >= slog.LevelWarn:
		message.level = sellingv1.OrderImportLogLevel_ORDER_IMPORT_LOG_LEVEL_WARN
	}

	record.Attrs(func(attr slog.Attr) bool {
		switch attr.Key {
		case "count":
			state.count = uint32(attr.Value.Uint64())
		case "step":
			state.step = uint32(attr.Value.Uint64())
		case "tally":
			message.tally, _ = attr.Value.Any().(*sellingv1.OrderImportTally)
		}

		return true
	})

	message.step = state.step
	message.count = state.count

	state.err = state.send(message)

	return state.err
}

// The import's logger carries no attributes or groups of its own.
func (h *orderImportLog) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *orderImportLog) WithGroup(string) slog.Handler      { return h }
