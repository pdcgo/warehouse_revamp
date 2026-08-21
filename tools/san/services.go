package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/manifoldco/promptui"
)

// servicesFromRoot is where the services live, RELATIVE TO THE REPOSITORY ROOT.
//
// It is a path from the repo and not from the working directory on purpose. When these commands
// lived in backend/cmd/tool they read plain "services", which silently required the operator to be
// standing in ./backend — and the error message for getting it wrong had to say so out loud
// ("run this from ./backend"). Anchoring to the repo root instead means `san migrate` works from
// the root, from backend/, from frontend/, from anywhere in the checkout.
const servicesFromRoot = "backend/services"

// repoRootOnce caches the walk. Every migrate/seed command asks for it at least twice, and the
// answer cannot change while one command runs.
var repoRootOnce = sync.OnceValues(findRepoRoot)

// findRepoRoot walks up from the working directory looking for the checkout.
//
// It looks for go.mod BESIDE backend/services rather than for go.mod alone: this module is rooted
// at the repository (HARD RULE 3b), so go.mod alone would also match if somebody nested a second
// module, and the pair is what actually identifies this checkout.
func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for {
		_, modErr := os.Stat(filepath.Join(dir, "go.mod"))
		info, svcErr := os.Stat(filepath.Join(dir, filepath.FromSlash(servicesFromRoot)))

		if modErr == nil && svcErr == nil && info.IsDir() {
			return dir, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			// The loop terminates at the filesystem root, where Dir(x) == x.
			return "", fmt.Errorf(
				"not inside a warehouse_revamp checkout: no go.mod beside %s in this directory or any parent",
				servicesFromRoot)
		}

		dir = parent
	}
}

// servicesRoot is the absolute path to backend/services.
func servicesRoot() (string, error) {
	root, err := repoRootOnce()
	if err != nil {
		return "", err
	}

	return filepath.Join(root, filepath.FromSlash(servicesFromRoot)), nil
}

// migrationsDir is where a service's goose migrations live (HARD RULE 3 — per-service
// migrations, no global set).
//
// It returns an error now rather than a string, because the repo root has to be found first and a
// silent "" would send goose at the working directory.
func migrationsDir(service string) (string, error) {
	root, err := servicesRoot()
	if err != nil {
		return "", err
	}

	return filepath.Join(root, service, "db_migrations"), nil
}

// repoPath resolves a repo-relative path (forward slashes) to an absolute one.
//
// It returns "" when the checkout cannot be found rather than an error, because its callers are
// flag DEFAULTS, evaluated while the command tree is being built. An error there would make
// `san --help` fail outside a checkout, and the empty string turns into an ordinary "open : no
// such file" at the moment somebody actually runs the command.
func repoPath(relative string) string {
	root, err := repoRootOnce()
	if err != nil {
		return ""
	}

	return filepath.Join(root, filepath.FromSlash(relative))
}

// defaultCategorySeedPath is the checked-in product taxonomy.
func defaultCategorySeedPath() string {
	return repoPath("backend/seed_asset/category.json")
}

// discoverServices lists the services from the filesystem rather than a hardcoded list —
// a hardcoded list silently goes stale the first time someone adds a service.
func discoverServices() ([]string, error) {
	root, err := servicesRoot()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("reading %q: %w", root, err)
	}

	services := make([]string, 0, len(entries))

	for _, entry := range entries {
		if entry.IsDir() {
			services = append(services, entry.Name())
		}
	}

	if len(services) == 0 {
		return nil, fmt.Errorf("no services found under %q", root)
	}

	slices.Sort(services)

	return services, nil
}

// resolveService takes the --service flag when given, otherwise prompts.
func resolveService(flag string) (string, error) {
	services, err := discoverServices()
	if err != nil {
		return "", err
	}

	if flag != "" {
		if !slices.Contains(services, flag) {
			return "", fmt.Errorf("unknown service %q — have: %v", flag, services)
		}

		return flag, nil
	}

	prompt := promptui.Select{
		Label: "Service",
		Items: services,
	}

	index, _, err := prompt.Run()
	if err != nil {
		return "", errors.New("no service selected (use --service to run non-interactively)")
	}

	return services[index], nil
}
