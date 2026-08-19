package remote

import (
	"log/slog"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// streamLogWriter binds a slog logger to the response stream, which is what
// guidelines/code-implementation-guideline.md asks of every long-running-task RPC: the important
// steps of the run are logged, and the log IS the stream.
//
// Frames it writes are tagged SYSTEM, so a caller can tell the server narrating the run apart
// from the command's own output — an agent that mixed the two would try to parse "running…" as
// compiler output.
type streamLogWriter struct {
	out *sender
}

// Write implements io.Writer.
func (w *streamLogWriter) Write(p []byte) (int, error) {
	err := w.out.text(string(p), remotev1.ExecStream_EXEC_STREAM_SYSTEM)
	if err != nil {
		return 0, err
	}

	return len(p), nil
}

// newStreamLogger is the binding from the guideline, in one place so every RPC added here logs
// the same way.
func newStreamLogger(out *sender) *slog.Logger {
	return slog.New(slog.NewTextHandler(&streamLogWriter{out: out}, nil))
}
