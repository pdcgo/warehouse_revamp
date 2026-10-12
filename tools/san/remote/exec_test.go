package remote

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

func TestExecStreamsStdout(t *testing.T) {
	h := newHarness(t, nil)

	got, err := h.exec(t, &remotev1.ExecRequest{Command: "echo hello"})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	if !strings.Contains(got.stdout, "hello") {
		t.Fatalf("stdout = %q, want it to contain hello", got.stdout)
	}

	if got.result == nil {
		t.Fatal("no result frame — a caller would never learn the run had ended")
	}

	if got.result.GetExitCode() != 0 {
		t.Fatalf("exit = %d, want 0", got.result.GetExitCode())
	}
}

// stderr must arrive TAGGED, not merged into stdout: an agent reading a build's output needs to
// know which half was the error.
func TestExecSeparatesStderr(t *testing.T) {
	h := newHarness(t, nil)

	got, err := h.exec(t, &remotev1.ExecRequest{Command: scripts().echoStderr})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	if !strings.Contains(got.stderr, "oops") {
		t.Fatalf("stderr = %q, want it to contain oops", got.stderr)
	}

	if strings.Contains(got.stdout, "oops") {
		t.Fatalf("stderr leaked into stdout: %q", got.stdout)
	}
}

// A non-zero exit is a RESULT, not an RPC error. If this ever regresses into an error, every
// caller loses the output of the failing command — which is the output they most needed.
func TestExecNonZeroExitIsAResultNotAnError(t *testing.T) {
	h := newHarness(t, nil)

	got, err := h.exec(t, &remotev1.ExecRequest{Command: scripts().exit3})
	if err != nil {
		t.Fatalf("Exec returned an error for a non-zero exit: %v", err)
	}

	if got.result.GetExitCode() != 3 {
		t.Fatalf("exit = %d, want 3", got.result.GetExitCode())
	}

	if got.result.GetTimedOut() {
		t.Fatal("timed_out set on a command that exited on its own")
	}
}

func TestExecRunsInWorkingDir(t *testing.T) {
	h := newHarness(t, nil)

	sub := filepath.Join(h.root, "nested")

	err := os.Mkdir(sub, 0o755)
	if err != nil {
		t.Fatal(err)
	}

	_, err = h.exec(t, &remotev1.ExecRequest{
		Command:    scripts().writeFile,
		WorkingDir: "nested",
	})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	_, err = os.Stat(filepath.Join(sub, "marker.txt"))
	if err != nil {
		t.Fatalf("the command did not run in nested/: %v", err)
	}
}

func TestExecRefusesWorkingDirOutsideRoot(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.exec(t, &remotev1.ExecRequest{
		Command:    "echo hello",
		WorkingDir: "../..",
	})
	if err == nil {
		t.Fatal("a working_dir above the root was accepted")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// The timeout must both KILL the command and say so — a caller seeing exit 1 with no timed_out
// flag would retry a command that will never finish.
func TestExecTimesOut(t *testing.T) {
	h := newHarness(t, nil)

	started := time.Now()

	got, err := h.exec(t, &remotev1.ExecRequest{
		Command:        scripts().sleep5,
		TimeoutSeconds: 1,
	})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	if !got.result.GetTimedOut() {
		t.Fatalf("timed_out not set; result = %v", got.result)
	}

	if time.Since(started) > 20*time.Second {
		t.Fatalf("the command was not actually killed — the run took %s", time.Since(started))
	}
}

// A request asking for more than the ceiling is CAPPED, not refused: the run is still worth doing.
func TestExecCapsTimeoutAtTheCeiling(t *testing.T) {
	svc, err := NewService(Config{
		Root:           t.TempDir(),
		Shell:          DefaultShell(),
		DefaultTimeout: 30 * time.Second,
		MaxTimeout:     45 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := svc.timeoutFor(600); got != 45*time.Second {
		t.Fatalf("timeoutFor(600) = %s, want the 45s ceiling", got)
	}

	if got := svc.timeoutFor(0); got != 30*time.Second {
		t.Fatalf("timeoutFor(0) = %s, want the 30s default", got)
	}

	if got := svc.timeoutFor(10); got != 10*time.Second {
		t.Fatalf("timeoutFor(10) = %s, want 10s", got)
	}
}

// A default above the ceiling would let every 0-timeout request quietly exceed the limit the
// operator set.
func TestNewServiceClampsDefaultToCeiling(t *testing.T) {
	svc, err := NewService(Config{
		Root:           t.TempDir(),
		Shell:          DefaultShell(),
		DefaultTimeout: 2 * time.Hour,
		MaxTimeout:     time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := svc.timeoutFor(0); got != time.Minute {
		t.Fatalf("timeoutFor(0) = %s, want the 1m ceiling", got)
	}
}

func TestExecFeedsStdin(t *testing.T) {
	h := newHarness(t, nil)

	command := "cat"
	if scripts().sleep5 != "sleep 5" { // windows
		command = "$input | Write-Output"
	}

	got, err := h.exec(t, &remotev1.ExecRequest{
		Command: command,
		Stdin:   "from-stdin\n",
	})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	if !strings.Contains(got.stdout, "from-stdin") {
		t.Fatalf("stdout = %q, want it to contain from-stdin", got.stdout)
	}
}

// protovalidate runs before anything else, so the contract's own min_len is what rejects an empty
// command — not a hand-written if in the handler that could drift from the proto.
func TestExecRejectsEmptyCommand(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.exec(t, &remotev1.ExecRequest{Command: ""})
	if err == nil {
		t.Fatal("an empty command was accepted")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// The run's narration must be tagged SYSTEM so a caller can keep it out of the command's output.
func TestExecNarratesOnTheSystemStream(t *testing.T) {
	h := newHarness(t, nil)

	got, err := h.exec(t, &remotev1.ExecRequest{Command: "echo hello"})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	if !strings.Contains(got.system, "running") {
		t.Fatalf("system = %q, want the run to be narrated", got.system)
	}

	if !strings.Contains(got.system, "finished") {
		t.Fatalf("system = %q, want a finishing line on the final frame", got.system)
	}
}

func TestExecPassesEnv(t *testing.T) {
	h := newHarness(t, nil)

	command := "echo $SAN_TEST_VAR"
	if scripts().sleep5 != "sleep 5" { // windows
		command = "$env:SAN_TEST_VAR"
	}

	got, err := h.exec(t, &remotev1.ExecRequest{
		Command: command,
		Env:     map[string]string{"SAN_TEST_VAR": "visible"},
	})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}

	if !strings.Contains(got.stdout, "visible") {
		t.Fatalf("stdout = %q, want it to contain visible", got.stdout)
	}
}

// A multi-byte rune split across two reads must arrive whole. Without the carry, a 32KB boundary
// landing inside a 3-byte character produces two replacement glyphs where there was one.
func TestTrailingPartialHoldsBackAnIncompleteRune(t *testing.T) {
	full := []byte("héllo→")

	if got := trailingPartial(full); got != 0 {
		t.Fatalf("trailingPartial(complete) = %d, want 0", got)
	}

	// → is three bytes; cut one off.
	cut := full[:len(full)-1]

	if got := trailingPartial(cut); got != 2 {
		t.Fatalf("trailingPartial(cut) = %d, want 2 held back", got)
	}
}
