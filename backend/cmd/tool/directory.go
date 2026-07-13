package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/manifoldco/promptui"
)

const servicesRoot = "services"

// migrationsDir is where a service's goose migrations live (HARD RULE 3 — per-service
// migrations, no global set).
func migrationsDir(service string) string {
	return filepath.Join(servicesRoot, service, "db_migrations")
}

// discoverServices lists the services from the filesystem rather than a hardcoded list —
// a hardcoded list silently goes stale the first time someone adds a service.
func discoverServices() ([]string, error) {
	entries, err := os.ReadDir(servicesRoot)
	if err != nil {
		return nil, fmt.Errorf("reading %q (run this from ./backend): %w", servicesRoot, err)
	}

	services := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			services = append(services, entry.Name())
		}
	}

	if len(services) == 0 {
		return nil, fmt.Errorf("no services found under %q", servicesRoot)
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
