package remote

import (
	"strconv"
	"strings"
	"sync"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// MaxTranscriptBytes caps what one `run_command` call hands back.
//
// A tool result is not a stream: it lands in a model's context in one piece, and a cold
// `go build ./...` on a broken tree can print megabytes. The cap is a context budget, not a
// safety limit — which is why going over it TRUNCATES rather than failing the call. An agent
// that asked for a build and got an error instead of the first forty lines of it has been given
// nothing.
const MaxTranscriptBytes = 128 << 10

// transcript is the outputSink for a buffered run: it keeps the output in order and hands back
// one block of text at the end.
//
// It keeps the HEAD and the TAIL and drops the middle, because those are the two ends that carry
// meaning — the head has the first error, the tail has the summary line that says how many there
// were. Keeping only the tail loses the first failure, which is usually the only real one; keeping
// only the head loses the verdict.
//
// ⚠ It is written from TWO goroutines (the stdout pump and the stderr pump), same as the Connect
// sender, so every method takes the lock.
type transcript struct {
	mu    sync.Mutex
	limit int

	head      []segment
	headBytes int

	tail      []segment
	tailBytes int

	dropped int

	// stderrBytes is how much of the output came from stderr — reported so an agent can tell a
	// command that printed a warning from one that said nothing at all, without the transcript
	// having to interleave markers into the text.
	stderrBytes int
}

// segment is one chunk of output and which pipe it came from. Kept rather than flattened so a
// future caller can render stdout and stderr apart without the run having to be repeated.
type segment struct {
	kind remotev1.ExecStream
	body string
}

func newTranscript(limit int) *transcript {
	if limit <= 0 {
		limit = MaxTranscriptBytes
	}

	return &transcript{limit: limit}
}

// text implements outputSink.
//
// SYSTEM frames are DROPPED. They are the server narrating the run ("running", "finished: exit
// 0"), and every fact in them is already a typed field on the tool's result — keeping them would
// spend a model's context on a line it can read off `exit_code` instead.
func (t *transcript) text(body string, kind remotev1.ExecStream) error {
	if body == "" || kind == remotev1.ExecStream_EXEC_STREAM_SYSTEM {
		return nil
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	if kind == remotev1.ExecStream_EXEC_STREAM_STDERR {
		t.stderrBytes += len(body)
	}

	// Fill the head first, then let everything after it roll through the tail.
	half := t.limit / 2

	if t.headBytes < half {
		room := half - t.headBytes

		if len(body) <= room {
			t.head = append(t.head, segment{kind: kind, body: body})
			t.headBytes += len(body)

			return nil
		}

		t.head = append(t.head, segment{kind: kind, body: body[:room]})
		t.headBytes += room
		body = body[room:]
	}

	t.tail = append(t.tail, segment{kind: kind, body: body})
	t.tailBytes += len(body)
	t.trim(half)

	return nil
}

// trim drops from the FRONT of the tail until it fits — the oldest bytes of the middle are the
// ones worth losing, since the head already holds the beginning of the run.
func (t *transcript) trim(max int) {
	for t.tailBytes > max && len(t.tail) > 0 {
		excess := t.tailBytes - max
		front := t.tail[0]

		if len(front.body) > excess {
			t.tail[0].body = front.body[excess:]
			t.tailBytes -= excess
			t.dropped += excess

			return
		}

		t.tail = t.tail[1:]
		t.tailBytes -= len(front.body)
		t.dropped += len(front.body)
	}
}

// truncated reports whether anything was dropped — a separate boolean rather than "the text has a
// marker in it", so an agent can branch on it without parsing the output it was given.
func (t *transcript) truncated() bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	return t.dropped > 0
}

func (t *transcript) droppedBytes() int {
	t.mu.Lock()
	defer t.mu.Unlock()

	return t.dropped
}

func (t *transcript) stderrSeen() int {
	t.mu.Lock()
	defer t.mu.Unlock()

	return t.stderrBytes
}

// String renders the run's output the way a terminal showed it — stdout and stderr interleaved in
// the order they were produced, with the dropped middle named rather than silently missing.
func (t *transcript) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()

	var out strings.Builder

	out.Grow(t.headBytes + t.tailBytes + 64)

	for _, seg := range t.head {
		out.WriteString(seg.body)
	}

	if t.dropped > 0 {
		// On its own lines: dropping into the middle of a half-written line would look like
		// output the command produced.
		out.WriteString("\n… " + strconv.Itoa(t.dropped) + " bytes of output omitted …\n")
	}

	for _, seg := range t.tail {
		out.WriteString(seg.body)
	}

	return out.String()
}
