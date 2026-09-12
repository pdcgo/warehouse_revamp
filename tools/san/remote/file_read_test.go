package remote

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

func (h *harness) read(t *testing.T, path string) (*remotev1.FileReadResponse, error) {
	t.Helper()

	resp, err := h.client.FileRead(context.Background(),
		connect.NewRequest(&remotev1.FileReadRequest{Path: path}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

func TestFileReadReturnsExactBytes(t *testing.T) {
	h := newHarness(t, nil)

	// Deliberately NOT valid UTF-8, and full of characters a shell would mangle: this is the
	// whole reason the RPC exists rather than Exec("cat").
	want := []byte("package main // $PATH `backtick` \"quote\"\n\x00\xff\xfe\n")

	err := os.WriteFile(filepath.Join(h.root, "sample.go"), want, 0o644)
	if err != nil {
		t.Fatal(err)
	}

	got, err := h.read(t, "sample.go")
	if err != nil {
		t.Fatalf("FileRead: %v", err)
	}

	if string(got.GetContent()) != string(want) {
		t.Fatalf("content = %q, want %q", got.GetContent(), want)
	}

	if got.GetSize() != int64(len(want)) {
		t.Fatalf("size = %d, want %d", got.GetSize(), len(want))
	}

	if got.GetModifiedAt() == nil {
		t.Fatal("modified_at unset — an agent cannot tell whether the file moved under it")
	}
}

func TestFileReadAcceptsForwardSlashes(t *testing.T) {
	h := newHarness(t, nil)

	err := os.MkdirAll(filepath.Join(h.root, "a", "b"), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	err = os.WriteFile(filepath.Join(h.root, "a", "b", "c.txt"), []byte("nested"), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	got, err := h.read(t, "a/b/c.txt")
	if err != nil {
		t.Fatalf("FileRead: %v", err)
	}

	if string(got.GetContent()) != "nested" {
		t.Fatalf("content = %q, want nested", got.GetContent())
	}
}

// NotFound must be distinguishable from a bad path: one means "create it", the other means
// "the caller built the path wrong".
func TestFileReadMissingIsNotFound(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.read(t, "nope.txt")
	if err == nil {
		t.Fatal("a missing file read succeeded")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestFileReadRefusesEscapes(t *testing.T) {
	h := newHarness(t, nil)

	for _, path := range []string{"../outside.txt", "/etc/passwd", `C:\Windows\win.ini`} {
		_, err := h.read(t, path)
		if err == nil {
			t.Fatalf("FileRead(%q) succeeded — it is outside the workspace", path)
		}

		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("FileRead(%q) code = %v, want InvalidArgument", path, connect.CodeOf(err))
		}
	}
}

func TestFileReadRefusesADirectory(t *testing.T) {
	h := newHarness(t, nil)

	err := os.Mkdir(filepath.Join(h.root, "adir"), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	_, readErr := h.read(t, "adir")
	if readErr == nil {
		t.Fatal("reading a directory succeeded")
	}

	if connect.CodeOf(readErr) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(readErr))
	}
}

// The cap must be enforced from the file's SIZE, before the bytes are pulled into memory.
func TestFileReadRefusesAnOversizeFile(t *testing.T) {
	h := newHarness(t, nil)

	big := make([]byte, MaxFileBytes+1)

	err := os.WriteFile(filepath.Join(h.root, "big.bin"), big, 0o644)
	if err != nil {
		t.Fatal(err)
	}

	_, err = h.read(t, "big.bin")
	if err == nil {
		t.Fatal("an oversize file was returned")
	}

	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("code = %v, want ResourceExhausted", connect.CodeOf(err))
	}
}

func TestFileReadRequiresAToken(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.unauthenticated("").FileRead(context.Background(),
		connect.NewRequest(&remotev1.FileReadRequest{Path: "anything.txt"}))
	if err == nil {
		t.Fatal("FileRead served with no token")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

// The proto's own min_len, applied by the validation interceptor — not a hand-written if.
func TestFileReadRejectsAnEmptyPath(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.read(t, "")
	if err == nil {
		t.Fatal("an empty path was accepted")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}
