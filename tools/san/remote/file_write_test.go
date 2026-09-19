package remote

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

func (h *harness) write(t *testing.T, req *remotev1.FileWriteRequest) (*remotev1.FileWriteResponse, error) {
	t.Helper()

	resp, err := h.client.FileWrite(context.Background(), connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

func TestFileWriteStoresExactBytes(t *testing.T) {
	h := newHarness(t, nil)

	// Every character here is one a shell heredoc would interfere with, which is the point.
	content := []byte("$env:PATH `x` \"y\" 'z' \\n\r\n\x00\xff")

	got, err := h.write(t, &remotev1.FileWriteRequest{Path: "out.txt", Content: content})
	if err != nil {
		t.Fatalf("FileWrite: %v", err)
	}

	if got.GetReplaced() {
		t.Fatal("replaced set on a file that did not exist")
	}

	onDisk, err := os.ReadFile(filepath.Join(h.root, "out.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(onDisk) != string(content) {
		t.Fatalf("on disk = %q, want %q", onDisk, content)
	}
}

// A round trip must be byte-identical, or an agent's read-edit-write cycle silently corrupts the
// file a little more on every pass.
func TestFileWriteThenReadRoundTrips(t *testing.T) {
	h := newHarness(t, nil)

	content := []byte("line one\r\nline two\n\ttabbed\n\xc3\xa9 accented\n")

	_, err := h.write(t, &remotev1.FileWriteRequest{Path: "round.txt", Content: content})
	if err != nil {
		t.Fatalf("FileWrite: %v", err)
	}

	got, err := h.read(t, "round.txt")
	if err != nil {
		t.Fatalf("FileRead: %v", err)
	}

	if string(got.GetContent()) != string(content) {
		t.Fatalf("round trip = %q, want %q", got.GetContent(), content)
	}
}

func TestFileWriteReportsReplacement(t *testing.T) {
	h := newHarness(t, nil)

	err := os.WriteFile(filepath.Join(h.root, "existing.txt"), []byte("old"), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	got, err := h.write(t, &remotev1.FileWriteRequest{Path: "existing.txt", Content: []byte("new")})
	if err != nil {
		t.Fatalf("FileWrite: %v", err)
	}

	if !got.GetReplaced() {
		t.Fatal("replaced not set — an agent cannot notice it clobbered something")
	}

	onDisk, err := os.ReadFile(filepath.Join(h.root, "existing.txt"))
	if err != nil {
		t.Fatal(err)
	}

	if string(onDisk) != "new" {
		t.Fatalf("on disk = %q, want new", onDisk)
	}
}

// Missing parents fail LOUDLY by default: a typo in a path should not quietly create a tree.
func TestFileWriteNeedsCreateDirsForANewTree(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.write(t, &remotev1.FileWriteRequest{
		Path:    "brand/new/file.txt",
		Content: []byte("x"),
	})
	if err == nil {
		t.Fatal("a write into a missing directory succeeded without create_dirs")
	}

	got, err := h.write(t, &remotev1.FileWriteRequest{
		Path:       "brand/new/file.txt",
		Content:    []byte("x"),
		CreateDirs: true,
	})
	if err != nil {
		t.Fatalf("FileWrite with create_dirs: %v", err)
	}

	if got.GetSize() != 1 {
		t.Fatalf("size = %d, want 1", got.GetSize())
	}

	_, err = os.Stat(filepath.Join(h.root, "brand", "new", "file.txt"))
	if err != nil {
		t.Fatalf("the file was not created: %v", err)
	}
}

func TestFileWriteRefusesEscapes(t *testing.T) {
	h := newHarness(t, nil)

	for _, path := range []string{"../escaped.txt", "/tmp/escaped.txt", `C:\escaped.txt`} {
		_, err := h.write(t, &remotev1.FileWriteRequest{Path: path, Content: []byte("x")})
		if err == nil {
			t.Fatalf("FileWrite(%q) succeeded — it is outside the workspace", path)
		}

		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("FileWrite(%q) code = %v, want InvalidArgument", path, connect.CodeOf(err))
		}
	}
}

func TestFileWriteRefusesADirectory(t *testing.T) {
	h := newHarness(t, nil)

	err := os.Mkdir(filepath.Join(h.root, "adir"), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	_, err = h.write(t, &remotev1.FileWriteRequest{Path: "adir", Content: []byte("x")})
	if err == nil {
		t.Fatal("writing over a directory succeeded")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestFileWriteRefusesOversizeContent(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.write(t, &remotev1.FileWriteRequest{
		Path:    "big.bin",
		Content: make([]byte, MaxFileBytes+1),
	})
	if err == nil {
		t.Fatal("oversize content was accepted")
	}

	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("code = %v, want ResourceExhausted", connect.CodeOf(err))
	}
}

func TestFileWriteRequiresAToken(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.unauthenticated("").FileWrite(context.Background(),
		connect.NewRequest(&remotev1.FileWriteRequest{Path: "x.txt", Content: []byte("x")}))
	if err == nil {
		t.Fatal("FileWrite served with no token — an unauthenticated caller could edit the tree")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

// The write is atomic, so a failure must leave the ORIGINAL intact rather than a truncated file.
// The temp file it goes through must not be left behind either.
func TestFileWriteLeavesNoTempFiles(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.write(t, &remotev1.FileWriteRequest{Path: "clean.txt", Content: []byte("hello")})
	if err != nil {
		t.Fatalf("FileWrite: %v", err)
	}

	entries, err := os.ReadDir(h.root)
	if err != nil {
		t.Fatal(err)
	}

	if len(entries) != 1 || entries[0].Name() != "clean.txt" {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}

		t.Fatalf("workspace holds %v, want only clean.txt", names)
	}
}
