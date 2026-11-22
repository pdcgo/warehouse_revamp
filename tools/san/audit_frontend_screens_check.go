package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// THE SCREEN TABLE'S CHECK (backlog #126) — every audited screen must be a screen the app really has: its page
// directory exists under frontend/src/pages, its address is one of the routes router.tsx renders THAT page on (read
// by `san test affected`'s own route reader, parseRoutes — route components such as RestockRoute included), its role
// is one the seed signs in, its name is its own, and the test id its usable rule waits on is one the app draws. A
// route renamed in the app, a page directory moved or a ready id mistyped is a screen the audit can no longer open:
// the unit test (TestAuditScreenTableMatchesTheApp) names it before a run would read it as "never usable".

// auditPlaceholderRe is a {placeholder} of a screen's route.
var auditPlaceholderRe = regexp.MustCompile(`\{[a-z0-9_]+\}`)

// auditReadyTestIDRe is the test id a ready selector names.
var auditReadyTestIDRe = regexp.MustCompile(`data-testid="([^"]+)"`)

// auditScreenProblems lists what in screens does not match the app at root — nothing, when the table is right.
func auditScreenProblems(root string, screens []auditScreenDef) ([]string, error) {
	router, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(auditRouterFile)))
	if err != nil {
		return nil, err
	}

	routes := parseRoutes(string(router))

	drawn, err := appTestIDs(root)
	if err != nil {
		return nil, err
	}

	roles := map[string]bool{"root": true}
	for _, u := range auditRoleUsers {
		roles[u.Key] = true
	}

	var out []string

	seen := map[string]bool{}

	for _, s := range screens {
		if seen[s.Name] {
			out = append(out, fmt.Sprintf("%s: a second screen of that name", s.Name))
		}

		seen[s.Name] = true

		if !roles[s.Role] {
			out = append(out, fmt.Sprintf("%s: role %q is no role the seed signs in", s.Name, s.Role))
		}

		_, err = os.Stat(filepath.Join(root, "frontend", "src", "pages", s.Page, "index.tsx"))
		if err != nil {
			out = append(out, fmt.Sprintf("%s: no page frontend/src/pages/%s/index.tsx", s.Name, s.Page))

			continue
		}

		path, _, _ := strings.Cut(s.Route, "?")
		path = auditPlaceholderRe.ReplaceAllString(path, "1")

		matched := false

		for _, r := range routes[s.Page] {
			if pathMatches(r, path, false) {
				matched = true

				break
			}
		}

		if !matched {
			out = append(out, fmt.Sprintf("%s: route %s is none of the routes router.tsx renders pages/%s on (%s)",
				s.Name, s.Route, s.Page, strings.Join(routes[s.Page], ", ")))
		}

		ready := s.Ready
		if ready == "" {
			ready = fmt.Sprintf(`[data-testid="%s-page"]`, s.Name)
		}

		for _, m := range auditReadyTestIDRe.FindAllStringSubmatch(ready, -1) {
			if !drawn[m[1]] {
				out = append(out, fmt.Sprintf("%s: its usable rule waits on test id %q, which no file of "+
					"frontend/src draws", s.Name, m[1]))
			}
		}
	}

	return out, nil
}

// appTestIDTextRe is a test id written in the app's source: a literal (`data-testid="x"`), or an expression whose
// literals are the ids it can draw (`data-testid={isEdit ? "restock-edit-page" : "restock-create-page"}`).
var (
	appTestIDTextRe = regexp.MustCompile(`data-testid=(?:"([a-z0-9-]+)"|\{([^{}]*)\})`)
	appQuotedRe     = regexp.MustCompile(`"([a-z0-9-]+)"`)
)

// appTestIDs is every literal test id frontend/src draws — stories and tests left out (no screen loads them).
func appTestIDs(root string) (map[string]bool, error) {
	out := map[string]bool{}
	src := filepath.Join(root, "frontend", "src")

	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel := filepath.ToSlash(path)
		if d.IsDir() || !strings.HasSuffix(rel, ".tsx") || testOnly(rel) {
			return nil
		}

		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		for _, m := range appTestIDTextRe.FindAllStringSubmatch(string(b), -1) {
			if m[1] != "" {
				out[m[1]] = true
			}

			for _, q := range appQuotedRe.FindAllStringSubmatch(m[2], -1) {
				out[q[1]] = true
			}
		}

		return nil
	})

	return out, err
}
