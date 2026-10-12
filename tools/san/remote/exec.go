package remote

import (
	"context"
	"errors"
	"strconv"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// Exec runs ONE command and streams its output as it is produced.
//
// The running itself lives in run() ([runner.go]), shared with the MCP `run_command` tool. What
// is left here is the part that is genuinely Connect's: turning the request message into params,
// writing frames down the stream, and mapping a failure to a status code.
//
// A non-zero exit is a RESULT, not an RPC error: the run happened and the caller wants the output
// and the code. An error is returned only when nothing ran — a bad working_dir, a shell that will
// not start — because then there is nothing to report but the failure.
func (s *Service) Exec(
	ctx context.Context,
	req *connect.Request[remotev1.ExecRequest],
	stream *connect.ServerStream[remotev1.ExecResponse],
) error {
	msg := req.Msg
	out := &sender{stream: stream}

	result, err := s.run(ctx, runParams{
		command:        msg.GetCommand(),
		workingDir:     msg.GetWorkingDir(),
		env:            msg.GetEnv(),
		stdin:          msg.GetStdin(),
		timeoutSeconds: msg.GetTimeoutSeconds(),
		peer:           req.Peer().Addr,
	}, out)
	if err != nil {
		return execError(err)
	}

	return out.finish(finishLine(result), result)
}

// execError maps a run that produced no result to the status code a caller can act on.
//
// The three cases are genuinely different to an agent: a bad path is its own mistake to fix, a
// shell that would not start is the operator's machine, and a cancellation is its own doing.
func execError(err error) error {
	switch {
	case errors.Is(err, errBadPath):
		return connect.NewError(connect.CodeInvalidArgument, err)

	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, err)

	case errors.Is(err, errNotStarted):
		return connect.NewError(connect.CodeInternal, err)

	default:
		// A working_dir that does not exist arrives here as a bare os error from resolveDir —
		// still the caller's path to fix, not the server's fault.
		return connect.NewError(connect.CodeInvalidArgument, err)
	}
}

// finishLine is the final frame's text. It is written by hand rather than through the slog
// binding because it must travel WITH the result on one frame — a caller that stops reading at
// the first frame carrying a result would otherwise never see how the run ended.
func finishLine(result *remotev1.ExecResult) string {
	took := strconv.FormatInt(result.GetDurationMs(), 10) + "ms"

	// The trailing newline is not decoration: a caller printing frames verbatim would otherwise
	// run its shell prompt straight onto the end of this line.
	if result.GetTimedOut() {
		return "timed out after " + took + "\n"
	}

	return "finished: exit " + strconv.FormatInt(int64(result.GetExitCode()), 10) + " in " + took + "\n"
}
