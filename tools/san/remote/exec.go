package remote

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// readChunk is how much output is taken per read. Big enough that a chatty build does not turn
// into thousands of frames, small enough that a slow command's first line arrives immediately —
// a read returns what is available, it does not wait to fill the buffer.
const readChunk = 32 * 1024

// Exec runs ONE command and streams its output as it is produced.
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
	logger := newStreamLogger(out)

	dir, err := s.resolveDir(msg.GetWorkingDir())
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, err)
	}

	timeout := s.timeoutFor(msg.GetTimeoutSeconds())

	// The operator sees every command on their own terminal, in full. That visibility is the
	// point of running this in the foreground: handing an agent a shell is only reasonable if
	// the person who handed it over can watch what it does.
	s.audit.Info("exec",
		"peer", req.Peer().Addr,
		"dir", dir,
		"timeout", timeout.String(),
		"command", msg.GetCommand(),
	)

	logger.Info("running",
		"shell", s.shell[0],
		"dir", dir,
		"timeout", timeout.String(),
	)

	// The deadline hangs off the REQUEST context, so the command dies both when it overruns and
	// when the caller hangs up — an agent that crashes mid-build does not leave the build running.
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := append(append([]string(nil), s.shell[1:]...), msg.GetCommand())

	cmd := exec.CommandContext(runCtx, s.shell[0], args...)
	cmd.Dir = dir
	cmd.Env = environ(msg.GetEnv())
	cmd.Stdin = strings.NewReader(msg.GetStdin())

	// Kill the whole TREE, not just the shell. `sh -c "go build ./..."` is a shell that spawns a
	// compiler; killing the shell alone on a timeout leaves the compiler running and the operator
	// wondering why the machine is still hot.
	configureProcessGroup(cmd)
	cmd.Cancel = func() error { return killProcessTree(cmd) }

	// A child that ignores the kill must not hold the RPC open forever.
	cmd.WaitDelay = 5 * time.Second

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	started := time.Now()

	err = cmd.Start()
	if err != nil {
		s.audit.Error("exec failed to start", "command", msg.GetCommand(), "error", err)

		return connect.NewError(connect.CodeInternal, err)
	}

	var wg sync.WaitGroup

	wg.Add(2)

	go pump(&wg, stdout, out, remotev1.ExecStream_EXEC_STREAM_STDOUT)
	go pump(&wg, stderr, out, remotev1.ExecStream_EXEC_STREAM_STDERR)

	// Both pipes must be drained BEFORE Wait: Wait closes them, and a pump still reading would
	// lose the tail of the output — the last few lines, which are the ones that say what failed.
	wg.Wait()

	waitErr := cmd.Wait()
	duration := time.Since(started)

	result := &remotev1.ExecResult{
		ExitCode:   exitCode(waitErr),
		TimedOut:   errors.Is(runCtx.Err(), context.DeadlineExceeded),
		DurationMs: duration.Milliseconds(),
	}

	// The CALLER hung up — distinct from a timeout, and there is nobody left to send a final
	// frame to. Report it as the cancellation it is.
	if ctx.Err() != nil && !result.GetTimedOut() {
		return connect.NewError(connect.CodeCanceled, ctx.Err())
	}

	s.audit.Info("exec done",
		"exit", result.GetExitCode(),
		"timed_out", result.GetTimedOut(),
		"took", duration.String(),
	)

	return out.finish(finishLine(result), result)
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

// pump forwards one pipe to the stream as the bytes arrive.
//
// A fixed-size read, NOT a bufio.Scanner: a Scanner waits for a newline, so a command that prints
// a progress bar or a prompt without one would appear frozen until it finished.
func pump(wg *sync.WaitGroup, r io.Reader, out *sender, kind remotev1.ExecStream) {
	defer wg.Done()

	buf := make([]byte, readChunk)

	var carry []byte

	for {
		n, err := r.Read(buf)

		if n > 0 {
			chunk := append(carry, buf[:n]...)

			// Hold back the bytes of a rune the read cut in half; they arrive on the next one.
			partial := trailingPartial(chunk)
			carry = append([]byte(nil), chunk[len(chunk)-partial:]...)

			_ = out.text(string(chunk[:len(chunk)-partial]), kind)
		}

		if err != nil {
			// Whatever is left was never going to be completed — emit it rather than dropping
			// bytes on the floor.
			if len(carry) > 0 {
				_ = out.text(string(carry), kind)
			}

			return
		}
	}
}

// environ merges the request's extra variables over the server's own environment.
//
// nil means "inherit unchanged", which is the common case and avoids copying the environment for
// nothing. The keys are sorted so two identical requests produce an identical command — an
// unsorted map makes a reproduction depend on Go's map iteration order.
func environ(extra map[string]string) []string {
	if len(extra) == 0 {
		return nil
	}

	keys := make([]string, 0, len(extra))
	for key := range extra {
		keys = append(keys, key)
	}

	sort.Strings(keys)

	env := os.Environ()
	for _, key := range keys {
		env = append(env, key+"="+extra[key])
	}

	return env
}

// exitCode maps Wait's error to a status. -1 means the command never produced one — killed, or
// never really started.
func exitCode(err error) int32 {
	if err == nil {
		return 0
	}

	var exitErr *exec.ExitError

	if errors.As(err, &exitErr) {
		return int32(exitErr.ExitCode())
	}

	return -1
}
