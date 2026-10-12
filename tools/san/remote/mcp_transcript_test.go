package remote

import (
	"strings"
	"sync"
	"testing"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

func stdout(t *transcript, body string) {
	_ = t.text(body, remotev1.ExecStream_EXEC_STREAM_STDOUT)
}

func TestTranscriptKeepsShortOutputWhole(t *testing.T) {
	tr := newTranscript(1024)

	stdout(tr, "first\n")
	stdout(tr, "second\n")

	if tr.String() != "first\nsecond\n" {
		t.Fatalf("transcript = %q, want the two chunks in order", tr.String())
	}

	if tr.truncated() {
		t.Fatal("truncated on output well under the limit")
	}
}

// The server narrating the run is not the run's output. Every fact those frames carry is already a
// typed field on the tool result, so keeping them would spend a model's context twice.
func TestTranscriptDropsSystemFrames(t *testing.T) {
	tr := newTranscript(1024)

	_ = tr.text("level=INFO msg=running\n", remotev1.ExecStream_EXEC_STREAM_SYSTEM)
	stdout(tr, "real output\n")

	if tr.String() != "real output\n" {
		t.Fatalf("transcript = %q, want the SYSTEM frame dropped", tr.String())
	}
}

// stderr is INTERLEAVED, not appended, because that is the order the command produced it in — a
// transcript that grouped the two would show an error beside the wrong line of output.
func TestTranscriptInterleavesStderrInOrder(t *testing.T) {
	tr := newTranscript(1024)

	stdout(tr, "compiling\n")
	_ = tr.text("error: nope\n", remotev1.ExecStream_EXEC_STREAM_STDERR)
	stdout(tr, "done\n")

	want := "compiling\nerror: nope\ndone\n"
	if tr.String() != want {
		t.Fatalf("transcript = %q, want %q", tr.String(), want)
	}

	if tr.stderrSeen() != len("error: nope\n") {
		t.Fatalf("stderrSeen = %d, want %d", tr.stderrSeen(), len("error: nope\n"))
	}
}

// ⚠ The MIDDLE goes, not the head and not the tail. The head holds the FIRST error — usually the
// only real one — and the tail holds the verdict. A cap that kept only one end would throw away
// exactly the half an agent needed.
func TestTranscriptDropsTheMiddleNotTheEnds(t *testing.T) {
	tr := newTranscript(100)

	stdout(tr, "HEAD-"+strings.Repeat("a", 200))
	stdout(tr, strings.Repeat("b", 200)+"-TAIL")

	got := tr.String()

	if !strings.HasPrefix(got, "HEAD-") {
		t.Fatalf("the head was lost: %q", got)
	}

	if !strings.HasSuffix(got, "-TAIL") {
		t.Fatalf("the tail was lost: %q", got)
	}

	if !tr.truncated() {
		t.Fatal("truncated is false after dropping 300 bytes")
	}

	// Named, not silently missing: output that just stops reads as a command that just stopped.
	if !strings.Contains(got, "bytes of output omitted") {
		t.Fatalf("the gap is unmarked: %q", got)
	}

	if tr.droppedBytes() == 0 {
		t.Fatal("droppedBytes = 0 while truncated is true")
	}
}

// Output that exactly fills the budget must not be reported as truncated — a false "truncated"
// sends an agent chasing output that was all there.
func TestTranscriptDoesNotTruncateAtTheLimit(t *testing.T) {
	tr := newTranscript(100)

	stdout(tr, strings.Repeat("x", 100))

	if tr.truncated() {
		t.Fatalf("truncated at exactly the limit, dropping %d bytes", tr.droppedBytes())
	}
}

// The two pumps write concurrently, same as they do into the Connect sender. Without the lock this
// is a data race that shows up under load and never in a single-threaded test.
func TestTranscriptIsSafeUnderConcurrentPumps(t *testing.T) {
	tr := newTranscript(1 << 16)

	var wg sync.WaitGroup

	wg.Add(2)

	for _, kind := range []remotev1.ExecStream{
		remotev1.ExecStream_EXEC_STREAM_STDOUT,
		remotev1.ExecStream_EXEC_STREAM_STDERR,
	} {
		go func() {
			defer wg.Done()

			for range 500 {
				_ = tr.text("chunk", kind)
			}
		}()
	}

	wg.Wait()

	if tr.String() == "" {
		t.Fatal("nothing was recorded")
	}
}
