package remote

import (
	"os"
	"path/filepath"
	"testing"
)

func newWorkspace(t *testing.T) *Service {
	t.Helper()

	svc, err := NewService(Config{Root: t.TempDir(), Shell: DefaultShell()})
	if err != nil {
		t.Fatal(err)
	}

	return svc
}

func TestResolveDirDefaultsToTheRoot(t *testing.T) {
	svc := newWorkspace(t)

	got, err := svc.resolveDir("")
	if err != nil {
		t.Fatal(err)
	}

	if got != svc.Root() {
		t.Fatalf("resolveDir(\"\") = %q, want the root %q", got, svc.Root())
	}
}

func TestResolveDirAcceptsANestedDirectory(t *testing.T) {
	svc := newWorkspace(t)

	nested := filepath.Join(svc.Root(), "a", "b")

	err := os.MkdirAll(nested, 0o755)
	if err != nil {
		t.Fatal(err)
	}

	// Forward slashes, because that is what a caller on any platform will send.
	got, err := svc.resolveDir("a/b")
	if err != nil {
		t.Fatal(err)
	}

	if got != nested {
		t.Fatalf("resolveDir = %q, want %q", got, nested)
	}
}

func TestResolveDirRefusesEscapes(t *testing.T) {
	svc := newWorkspace(t)

	cases := []string{
		"..",
		"../sibling",
		"a/../../elsewhere",
	}

	for _, dir := range cases {
		_, err := svc.resolveDir(dir)
		if err == nil {
			t.Fatalf("resolveDir(%q) was accepted — it climbs out of the workspace", dir)
		}
	}
}

func TestResolveDirRefusesAbsolutePaths(t *testing.T) {
	svc := newWorkspace(t)

	// "/etc" is not absolute on Windows as far as filepath is concerned, which is exactly why
	// resolveDir checks the separator explicitly as well.
	cases := []string{
		"/etc",
		`\Windows`,
		`C:\Windows`,
		"C:build",
	}

	for _, dir := range cases {
		_, err := svc.resolveDir(dir)
		if err == nil {
			t.Fatalf("resolveDir(%q) was accepted — working_dir must be relative", dir)
		}
	}
}

// A sibling whose name merely STARTS with the root's would pass a strings.HasPrefix check. It
// must not pass this one.
func TestResolveDirRefusesAPrefixSibling(t *testing.T) {
	svc := newWorkspace(t)

	sibling := svc.Root() + "_old"

	err := os.MkdirAll(sibling, 0o755)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = os.RemoveAll(sibling) })

	_, err = svc.resolveDir(".." + string(filepath.Separator) + filepath.Base(sibling))
	if err == nil {
		t.Fatal("a sibling directory sharing the root's prefix was accepted")
	}
}

func TestResolveDirRefusesAMissingDirectory(t *testing.T) {
	svc := newWorkspace(t)

	_, err := svc.resolveDir("nope")
	if err == nil {
		t.Fatal("a working_dir that does not exist was accepted")
	}
}

func TestResolveDirRefusesAFile(t *testing.T) {
	svc := newWorkspace(t)

	file := filepath.Join(svc.Root(), "file.txt")

	err := os.WriteFile(file, []byte("x"), 0o600)
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.resolveDir("file.txt")
	if err == nil {
		t.Fatal("a file was accepted as a working_dir")
	}
}
