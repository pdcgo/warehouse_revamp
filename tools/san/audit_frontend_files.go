package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// THE LEVEL 2 HOOK (backlog #124, a-slice-fixes-the-speed-regression-it-caused) — `san audit frontend --files a,b`
// measures only the audited screens a slice's changed files reach, compares them with audits/frontend/baseline.json
// (never writing it) and prints the owner's verdict (audit_frontend_verdict.go).
//
// Which screens a file reaches is `san test affected`'s page mapping, CALLED here, not copied (test_affected.go):
//
//	a frontend file   reachedFiles (up the imports by name, stopping at the shell) → pagesOf → the page directories →
//	                  the screens whose Page is one of them (two screens can share one: restock-form)
//	the app shell     router.tsx, main.tsx, theme.ts, transport.ts, layouts/, api/ — or a file one of them takes: the
//	                  layout's (the sidebar's badge hooks), or one the router mounts outside any page (AuthGate,
//	                  TeamContext) → EVERY audited screen. The router reached only through a page it imports is that
//	                  page, not the shell
//	the build         index.html, vite.config.ts, package.json, package-lock.json, and the audit's own build config
//	                  (frontend/scripts/speed-audit/vite.audit.config.mjs — what the audit serves) → every audited screen
//	a backend file    its service's RPCs whose handlers reach it (indexGoService → reachedRPCs; nothing traced: every
//	                  RPC of the service), a .proto's RPCs, a pkg's or the dev server's services (every RPC of each) →
//	                  the screens whose MEASURED requests call one: the baseline's lists (the screen's, the shell's,
//	                  after the save, the probes') and the screen's own save
//	anything else     tests and stories, tools/, docs/, frontend/e2e/, another binary's cmd/ → no audited screen

// auditRouterFile is the router: it imports pages, so reaching it through a page is that page — not the shell.
const auditRouterFile = "frontend/src/router.tsx"

// auditBuildFiles change the production bundle of every screen — the app's build, and the audit's own config over it
// (keepNames, P2: its proof is `--files` over this file reading every screen's requests unchanged).
var auditBuildFiles = map[string]bool{
	"frontend/index.html":                                true,
	"frontend/vite.config.ts":                            true,
	"frontend/package.json":                              true,
	"frontend/package-lock.json":                         true,
	"frontend/scripts/speed-audit/vite.audit.config.mjs": true,
}

// auditReachedFile is one changed file and the audited screens it reaches.
type auditReachedFile struct {
	File    string
	Screens []string // the audited screens it reaches; empty — none
	How     string
}

// auditReach is what a --files list reaches.
type auditReach struct {
	Files   []auditReachedFile
	Screens []auditScreenDef // what the run measures, in the table's order
}

// auditFileIndex maps changed files to audited screens.
type auditFileIndex struct {
	root     string
	ix       *frontendIndex
	byDomain map[string][]string // "inventory" → its RPCs ("inventory.v1.RackService/RackCreate")
	byProto  map[string][]string // proto file → its RPCs
	goIdx    map[string]*goServiceIndex
	screens  []auditScreenDef
	base     map[string]auditMeasure
}

// newAuditFileIndex reads the frontend and the protos once — the same readers `san test affected` uses.
func newAuditFileIndex(root string, screens []auditScreenDef, base map[string]auditMeasure) (*auditFileIndex, error) {
	ix, err := indexFrontend(root)
	if err != nil {
		return nil, err
	}

	byDomain, byProto, err := protoRPCs(root)
	if err != nil {
		return nil, err
	}

	return &auditFileIndex{root: root, ix: ix, byDomain: byDomain, byProto: byProto,
		goIdx: map[string]*goServiceIndex{}, screens: screens, base: base}, nil
}

// reach maps every file, and gathers the screens a run measures.
func (fx *auditFileIndex) reach(files []string) *auditReach {
	out := &auditReach{}
	want := map[string]bool{}

	for _, f := range files {
		r := fx.file(filepath.ToSlash(strings.TrimSpace(f)))
		out.Files = append(out.Files, r)

		for _, s := range r.Screens {
			want[s] = true
		}
	}

	for _, s := range fx.screens {
		if want[s.Name] {
			out.Screens = append(out.Screens, s)
		}
	}

	return out
}

// file is one changed file's reach.
func (fx *auditFileIndex) file(p string) auditReachedFile {
	seg := strings.Split(p, "/")

	switch {
	case testOnly(p):
		return auditReachedFile{File: p, How: "a test or a story — no screen loads it"}
	case auditBuildFiles[p]:
		return fx.every(p, "the production build")
	case strings.HasPrefix(p, "frontend/src/"):
		return fx.frontendFile(p)
	case len(seg) >= 4 && seg[0] == "backend" && seg[1] == "services":
		rpcs, how := fx.serviceRPCs(p, seg[2])

		return fx.byRPCs(p, rpcs, how)
	case len(seg) >= 4 && seg[0] == "backend" && seg[1] == "pkgs":
		var rpcs []string

		services := servicesImporting(fx.root, "backend/pkgs/"+seg[2])
		for _, svc := range services {
			rpcs = append(rpcs, fx.byDomain[strings.TrimSuffix(svc, "_service")]...)
		}

		return fx.byRPCs(p, rpcs, fmt.Sprintf("every RPC of the %d service(s) importing backend/pkgs/%s", len(services),
			seg[2]))
	case strings.HasPrefix(p, "backend/cmd/app_development/") && strings.HasSuffix(p, ".go"):
		return fx.devServerFile(p)
	case strings.HasPrefix(p, "proto/warehouse/") && strings.HasSuffix(p, ".proto"):
		rpcs := fx.byProto[p]
		how := "its RPCs"

		if len(rpcs) == 0 && len(seg) >= 4 {
			rpcs = fx.byDomain[seg[2]]
			how = "no RPC of its own: every RPC of " + seg[2] + "_service"
		}

		return fx.byRPCs(p, rpcs, how)
	case strings.HasPrefix(p, "backend/cmd/"):
		return auditReachedFile{File: p, How: "another binary — the audit serves backend/cmd/app_development"}
	}

	return auditReachedFile{File: p, How: "no audited screen runs it"}
}

// every is a file reaching every audited screen.
func (fx *auditFileIndex) every(p, why string) auditReachedFile {
	names := make([]string, 0, len(fx.screens))
	for _, s := range fx.screens {
		names = append(names, s.Name)
	}

	return auditReachedFile{File: p, Screens: names, How: why + " — every audited screen"}
}

// frontendFile follows a frontend file up the imports to its pages — or to the shell.
func (fx *auditFileIndex) frontendFile(p string) auditReachedFile {
	if shellFile(p) || strings.HasPrefix(p, "frontend/src/api/") {
		return fx.every(p, "the app shell")
	}

	reached := fx.ix.reachedFiles(map[string]affectedNames{p: {all: true}})
	routerTakes := fx.ix.imports[auditRouterFile]

	for _, r := range reached {
		if strings.HasPrefix(r, "frontend/src/pages/") || r == auditRouterFile {
			continue
		}

		if shellFile(r) || strings.HasPrefix(r, "frontend/src/api/") {
			return fx.every(p, "reaches the app shell ("+r+")")
		}

		if contains(routerTakes, r) {
			return fx.every(p, "the router mounts "+r+" outside any page")
		}
	}

	pages, _ := fx.ix.pagesOf(reached, false)

	var screens, audited []string

	for _, s := range fx.screens {
		if contains(pages, s.Page) {
			screens = append(screens, s.Name)

			if !contains(audited, s.Page) {
				audited = append(audited, s.Page)
			}
		}
	}

	if len(screens) == 0 {
		how := "no page imports it"
		if len(pages) > 0 {
			how = "reaches page(s) " + strings.Join(pages, ", ") + " — none audited"
		}

		return auditReachedFile{File: p, How: how}
	}

	return auditReachedFile{File: p, Screens: screens, How: "page(s) " + strings.Join(audited, ", ")}
}

// serviceRPCs is the RPCs a backend service file reaches: the handlers reaching its declarations, else every RPC of
// the service (a migration, a file no handler reaches — what `san test affected` does too).
func (fx *auditFileIndex) serviceRPCs(p, service string) ([]string, string) {
	gx, ok := fx.goIdx[service]
	if !ok {
		var err error

		gx, err = indexGoService(fx.root, service, fx.byDomain[strings.TrimSuffix(service, "_service")])
		if err != nil {
			gx = &goServiceIndex{service: service}
		}

		fx.goIdx[service] = gx
	}

	if strings.HasSuffix(p, ".go") {
		names := gx.declsOf[p]
		if len(names) > 0 {
			rpcs := gx.reachedRPCs(names)
			if len(rpcs) > 0 {
				return rpcs, "the RPCs whose handlers reach it"
			}
		}
	}

	return fx.byDomain[strings.TrimSuffix(service, "_service")], "no handler traced: every RPC of " + service
}

// devServerFile is a dev-server file: every RPC of each service it imports (service_api.go imports them all).
func (fx *auditFileIndex) devServerFile(p string) auditReachedFile {
	b, err := os.ReadFile(filepath.Join(fx.root, filepath.FromSlash(p)))
	if err != nil {
		return auditReachedFile{File: p, How: "not readable: " + err.Error()}
	}

	var services, rpcs []string

	for _, m := range goServiceImport.FindAllStringSubmatch(string(b), -1) {
		if !contains(services, m[1]) {
			services = append(services, m[1])
			rpcs = append(rpcs, fx.byDomain[strings.TrimSuffix(m[1], "_service")]...)
		}
	}

	if len(services) == 0 {
		return auditReachedFile{File: p, How: "the dev server, importing no service — no audited screen"}
	}

	return fx.byRPCs(p, rpcs, fmt.Sprintf("every RPC of the %d service(s) it imports", len(services)))
}

// byRPCs is the screens whose measured requests call one of rpcs.
func (fx *auditFileIndex) byRPCs(p string, rpcs []string, how string) auditReachedFile {
	want := map[string]bool{}
	for _, r := range rpcs {
		want[shortRPC(r)] = true
	}

	var screens, called []string

	for _, s := range fx.screens {
		hit := false

		for _, m := range fx.measuredRPCs(s) {
			if want[m] {
				hit = true

				if !contains(called, shortMethod(m)) {
					called = append(called, shortMethod(m))
				}
			}
		}

		if hit {
			screens = append(screens, s.Name)
		}
	}

	sort.Strings(called)

	if len(screens) == 0 {
		return auditReachedFile{File: p, How: fmt.Sprintf("%s: %d RPC(s), no audited screen calls one", how, len(rpcs))}
	}

	shown := called
	if len(shown) > 6 {
		shown = append(append([]string(nil), shown[:6]...), fmt.Sprintf("+%d more", len(called)-6))
	}

	return auditReachedFile{File: p, Screens: screens, How: fmt.Sprintf("%s: %d RPC(s), the screens call %s", how,
		len(rpcs), strings.Join(shown, ", "))}
}

// measuredRPCs is every RPC a screen was measured calling ("Service/Method"): the baseline's screen, shell, after-save
// and probe requests, and the screen's own save.
func (fx *auditFileIndex) measuredRPCs(s auditScreenDef) []string {
	var out []string

	add := func(m map[string]int) {
		for k := range m {
			out = append(out, k)
		}
	}

	b, ok := fx.base[s.Name]
	if ok {
		add(b.ByMethod)
		add(b.ShellByMethod)

		if b.AfterSave != nil {
			add(b.AfterSave.ByMethod)
		}

		for _, p := range b.Probes {
			add(p.ByMethod)
		}
	}

	if s.Save != nil && s.Save.RPC != "" {
		out = append(out, s.Save.RPC)
	}

	return out
}

// shortRPC is a full RPC name as the audit records it: "inventory.v1.RackService/RackStock" → "RackService/RackStock".
func shortRPC(full string) string {
	svc, method, ok := strings.Cut(full, "/")
	if !ok {
		return full
	}

	return svc[strings.LastIndex(svc, ".")+1:] + "/" + method
}

// printAuditReach writes the reach: one line for the list, one per file.
func printAuditReach(out io.Writer, r *auditReach) {
	if len(r.Screens) == 0 {
		fmt.Fprintf(out, "audit --files: %d file(s) reach no audited screen — nothing measured\n", len(r.Files))
	} else {
		names := make([]string, 0, len(r.Screens))
		for _, s := range r.Screens {
			names = append(names, s.Name)
		}

		fmt.Fprintf(out, "audit --files: %d file(s) reach %d audited screen(s): %s\n", len(r.Files), len(names),
			strings.Join(names, ", "))
	}

	for _, f := range r.Files {
		reached := "no audited screen"
		if len(f.Screens) > 0 {
			reached = strings.Join(f.Screens, ", ")
		}

		fmt.Fprintf(out, "  %s → %s (%s)\n", f.File, reached, f.How)
	}
}
