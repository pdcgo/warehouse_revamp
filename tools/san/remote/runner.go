package remote

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// readChunk is how much output is taken per read. Big enough that a chatty build does not turn
// into thousands of frames, small enough that a slow command's first line arrives immediately —
// a read returns what is available, it does not wait to fill the buffer.
const readChunk = 32 * 1024

// runParams is ONE command to run, with no transport's message type in it.
//
// It exists because there are now two ways in: the Connect stream (Exec) and the MCP tool
// (run_command). Both need the process-group kill, the timeout ceiling, the UTF-8 repair and the
// audit line — and a second copy of that sequence is a copy that falls behind the first.
type runParams struct {
	command        string
	workingDir     string
	env            map[string]string
	stdin          string
	timeoutSeconds uint32

	// peer is whatever the transport can say about who asked. It only ever reaches the audit log.
	peer string
}

// outputSink is where a run's output goes AS IT IS PRODUCED.
//
// The Connect handler's sink writes frames down the stream; the MCP tool's sink appends to a
// transcript it returns at the end. Both see the same bytes in the same order, tagged the same
// way — the difference between "streamed" and "buffered" is this interface and nothing else.
type outputSink interface {
	text(body string, kind remotev1.ExecStream) error
}

// errNotStarted marks "nothing ran", as opposed to "it ran and failed".
//
// The distinction is the whole error contract of a run: a non-zero exit is a RESULT the caller
// wants, and only a command that never started leaves nothing to report but the failure.
var errNotStarted = errors.New("remote: command did not start")

// run executes one command, feeding output to the sink as it arrives, and returns how it ended.
//
// A non-zero exit comes back as a RESULT with a nil error. An error is returned only when there
// is no result to give: a bad working_dir, a shell that would not start, or a caller that hung up.
func (s *Service) run(ctx context.Context, p runParams, out outputSink) (*remotev1.ExecResult, error) {
	dir, err := s.resolveDir(p.workingDir)
	if err != nil {
		return nil, err
	}

	timeout := s.timeoutFor(p.timeoutSeconds)

	// The operator sees every command on their own terminal, in full. That visibility is the
	// point of running this in the foreground: handing an agent a shell is only reasonable if
	// the person who handed it over can watch what it does.
	s.audit.Info("exec",
		"peer", p.peer,
		"dir", dir,
		"timeout", timeout.String(),
		"command", p.command,
	)

	logger := newStreamLogger(out)
	logger.Info("running",
		"shell", s.shell[0],
		"dir", dir,
		"timeout", timeout.String(),
	)

	// The deadline hangs off the CALLER's context, so the command dies both when it overruns and
	// when the caller hangs up — an agent that crashes mid-build does not leave the build running.
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := append(append([]string(nil), s.shell[1:]...), p.command)

	cmd := exec.CommandContext(runCtx, s.shell[0], args...)
	cmd.Dir = dir
	cmd.Env = environ(p.env)
	cmd.Stdin = strings.NewReader(p.stdin)

	// Kill the whole TREE, not just the shell. `sh -c "go build ./..."` is a shell that spawns a
	// compiler; killing the shell alone on a timeout leaves the compiler running and the operator
	// wondering why the machine is still hot.
	configureProcessGroup(cmd)
	cmd.Cancel = func() error { return killProcessTree(cmd) }

	// A child that ignores the kill must not hold the call open forever.
	cmd.WaitDelay = 5 * time.Second

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, errors.Join(errNotStarted, err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, errors.Join(errNotStarted, err)
	}

	started := time.Now()

	err = cmd.Start()
	if err != nil {
		s.audit.Error("exec failed to start", "command", p.command, "error", err)

		return nil, errors.Join(errNotStarted, err)
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

	// The CALLER hung up — distinct from a timeout, and there is nobody left to report to.
	if ctx.Err() != nil && !result.GetTimedOut() {
		return nil, ctx.Err()
	}

	s.audit.Info("exec done",
		"exit", result.GetExitCode(),
		"timed_out", result.GetTimedOut(),
		"took", duration.String(),
	)

	return result, nil
}

// pump forwards one pipe to the sink as the bytes arrive.
//
// A fixed-size read, NOT a bufio.Scanner: a Scanner waits for a newline, so a command that prints
// a progress bar or a prompt without one would appear frozen until it finished.
func pump(wg *sync.WaitGroup, r io.Reader, out outputSink, kind remotev1.ExecStream) {
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
