package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ⚠ These tests exist because the move from backend/cmd/tool into tools/san broke exactly this,
// twice, in ways nothing else caught.
//
// Both commands read a path that was relative to the WORKING DIRECTORY and happened to be correct
// only while the binary was run from ./backend: `migrate` looked for "services", and
// `seed categories` for "seed_asset/category.json". Moving the commands to a repo-root CLI changed
// the working directory and both started looking in the wrong place — `migrate` with a message
// that still told the operator to cd into a directory that no longer mattered.
//
// A default that depends on where the operator is standing works for exactly one cwd.

// repoRootIsFound proves the walk finds the checkout, which every other test here depends on.
func TestRepoRootIsFound(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Fatalf("findRepoRoot: %v", err)
	}

	// The two things the walk claims to look for must actually be there together.
	for _, want := range []string{"go.mod", filepath.FromSlash("backend/services")} {
		_, err = os.Stat(filepath.Join(root, want))
		if err != nil {
			t.Fatalf("repo root %q has no %s: %v", root, want, err)
		}
	}
}

// The walk must reach the same answer from a nested directory. The test binary already runs in
// tools/san, so a plain call proves the "not at the root" case — but a deeper start is the one
// that would break if the loop ever stopped climbing.
func TestRepoRootIsFoundFromANestedDirectory(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Fatalf("findRepoRoot: %v", err)
	}

	deep := filepath.Join(root, "backend", "services", "user_service", "user_v1")

	_, err = os.Stat(deep)
	if err != nil {
		t.Skipf("nested directory not present: %v", err)
	}

	restore := chdir(t, deep)
	defer restore()

	// findRepoRoot rather than the cached servicesRoot: the cache is per-process and would hand
	// back the answer computed before the chdir, testing nothing.
	got, err := findRepoRoot()
	if err != nil {
		t.Fatalf("findRepoRoot from %s: %v", deep, err)
	}

	if !sameDir(got, root) {
		t.Fatalf("from %s the root resolved to %q, want %q", deep, got, root)
	}
}

// Outside a checkout it must SAY SO. The failure mode being guarded is not the error — it is a
// silent fallback that reads some other directory's "services" and reports a service list that
// belongs to nothing.
func TestRepoRootFailsOutsideACheckout(t *testing.T) {
	restore := chdir(t, t.TempDir())
	defer restore()

	_, err := findRepoRoot()
	if err == nil {
		t.Fatal("a directory outside any checkout was accepted as the repo root")
	}

	if !strings.Contains(err.Error(), "backend/services") {
		t.Fatalf("the error does not say what was missing: %v", err)
	}
}

// Every path default must be ABSOLUTE, which is the property that makes it independent of cwd. A
// relative default here is the exact bug this file exists for, and it would still pass a test that
// only ran from the repo root.
func TestPathDefaultsAreAbsolute(t *testing.T) {
	cases := map[string]string{
		"category seed": defaultCategorySeedPath(),
		"region seed":   defaultRegionSeedPath(),
	}

	for name, path := range cases {
		if path == "" {
			t.Fatalf("%s default is empty — the checkout was not found", name)
		}

		if !filepath.IsAbs(path) {
			t.Fatalf("%s default %q is relative, so it depends on the operator's working directory", name, path)
		}

		_, err := os.Stat(path)
		if err != nil {
			t.Fatalf("%s default %q does not exist: %v", name, path, err)
		}
	}
}

// migrationsDir must land inside the service it names, not beside the working directory.
func TestMigrationsDirIsInsideTheService(t *testing.T) {
	dir, err := migrationsDir("user_service")
	if err != nil {
		t.Fatalf("migrationsDir: %v", err)
	}

	if !filepath.IsAbs(dir) {
		t.Fatalf("migrationsDir returned a relative path: %q", dir)
	}

	want := filepath.FromSlash("backend/services/user_service/db_migrations")
	if !strings.HasSuffix(dir, want) {
		t.Fatalf("migrationsDir = %q, want it to end in %q", dir, want)
	}

	_, err = os.Stat(dir)
	if err != nil {
		t.Fatalf("migrations dir %q does not exist: %v", dir, err)
	}
}

// discoverServices reads the filesystem rather than a hardcoded list, which is what stops it going
// stale when a service is born. It must therefore find the ones that exist right now.
func TestDiscoverServicesFindsTheRealServices(t *testing.T) {
	services, err := discoverServices()
	if err != nil {
		t.Fatalf("discoverServices: %v", err)
	}

	for _, want := range []string{"team_service", "user_service"} {
		found := false

		for _, service := range services {
			if service == want {
				found = true

				break
			}
		}

		if !found {
			t.Fatalf("%s missing from %v", want, services)
		}
	}
}

// chdir moves the process and hands back the undo. t.Chdir would be tidier, but these tests share
// a process with the rest of the package and an unrestored cwd would break whatever runs next.
func chdir(t *testing.T, dir string) func() {
	t.Helper()

	before, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}

	err = os.Chdir(dir)
	if err != nil {
		t.Fatalf("chdir %s: %v", dir, err)
	}

	return func() { _ = os.Chdir(before) }
}

// sameDir compares two paths after resolving symlinks — on macOS a temp dir is reached through
// /var, which is a link to /private/var, and a string compare would call the same directory two
// different places.
func sameDir(a, b string) bool {
	resolvedA, err := filepath.EvalSymlinks(a)
	if err != nil {
		resolvedA = a
	}

	resolvedB, err := filepath.EvalSymlinks(b)
	if err != nil {
		resolvedB = b
	}

	return strings.EqualFold(resolvedA, resolvedB)
}
