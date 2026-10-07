package settlement_importer_v1

import (
	"context"
	"log/slog"
	"sync"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
)

// progress is one message of an import's stream. Both imports' responses carry the same five fields.
type progress struct {
	level   settlement_importerv1.LogLevel
	message string
	step    uint32
	count   uint32
	file    *settlement_importerv1.UploadedFile
}

// streamSink is the WINDOW onto an import (an-import-finishes-whether-anyone-watches). It sends while
// somebody listens; when a send fails — the tab closed — it says so once in the server log and drops
// every later message, and the import carries on.
//
// ⚠ THE HANDLER DETACHES IT BEFORE IT RETURNS. Nothing may write to a stream whose handler has returned,
// and the import outlives the handler — so every send takes the lock, and detach waits out a send in
// flight before the handler is allowed to go.
type streamSink struct {
	mu       sync.Mutex
	send     func(progress) error
	gone     bool
	detached bool
}

func newStreamSink(send func(progress) error) *streamSink {
	return &streamSink{send: send}
}

func (s *streamSink) deliver(ctx context.Context, p progress) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.gone || s.detached {
		return
	}

	err := s.send(p)
	if err != nil {
		s.gone = true

		slog.WarnContext(ctx, "settlement import: nobody is watching any more — the import carries on",
			"error", err)
	}
}

// detach closes the window for good. The handler calls it before it returns.
func (s *streamSink) detach() {
	s.mu.Lock()
	s.detached = true
	s.mu.Unlock()
}

// streamHandler is the long-task guideline's slog binding (code-implementation-guideline §Long Running
// Task 3) — as a slog.Handler rather than the guideline's io.Writer, because a handler receives each
// record's LEVEL beside its message, so `level` is a field the screen colours by and never text it would
// have to parse (every-stream-message-is-a-leveled-log-line).
//
// Three attributes are the stream's own fields rather than text: "step", "count" and "file". Every other
// attribute, and every line, also reaches the server log — watched or not.
type streamHandler struct {
	sink   *streamSink
	server slog.Handler
	attrs  []slog.Attr
}

func newStreamLogger(sink *streamSink, attrs ...slog.Attr) *slog.Logger {
	return slog.New(&streamHandler{sink: sink, server: slog.Default().Handler(), attrs: attrs})
}

func (h *streamHandler) Enabled(context.Context, slog.Level) bool {
	return true
}

func (h *streamHandler) Handle(ctx context.Context, record slog.Record) error {
	p := progress{level: levelOf(record.Level), message: record.Message}

	server := slog.NewRecord(record.Time, record.Level, "settlement import: "+record.Message, record.PC)
	server.AddAttrs(h.attrs...)

	record.Attrs(func(attr slog.Attr) bool {
		switch attr.Key {
		case "step":
			p.step = uint32(attr.Value.Int64())
		case "count":
			p.count = uint32(attr.Value.Int64())
		case "file":
			file, ok := attr.Value.Any().(*settlement_importerv1.UploadedFile)
			if ok {
				p.file = file
			}
		default:
			server.AddAttrs(attr)
		}

		return true
	})

	h.sink.deliver(ctx, p)

	if h.server.Enabled(ctx, record.Level) {
		return h.server.Handle(ctx, server)
	}

	return nil
}

func (h *streamHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &streamHandler{sink: h.sink, server: h.server, attrs: append(append([]slog.Attr{}, h.attrs...), attrs...)}
}

func (h *streamHandler) WithGroup(string) slog.Handler {
	return h
}

func levelOf(level slog.Level) settlement_importerv1.LogLevel {
	switch {
	case level >= slog.LevelError:
		return settlement_importerv1.LogLevel_LOG_LEVEL_ERROR
	case level >= slog.LevelWarn:
		return settlement_importerv1.LogLevel_LOG_LEVEL_WARN
	default:
		return settlement_importerv1.LogLevel_LOG_LEVEL_INFO
	}
}
