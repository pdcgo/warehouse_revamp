package main

import (
	"bufio"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// The AFFECTED-SPEC FINDER (the-full-e2e-waits-for-a-measured-yes, level 2): the e2e specs that call
// an RPC the change reaches, open a page the change reaches, or use a component the change made —
// found by reading the code, not by a list someone keeps:
//
//	a Go file        → the RPC handlers that reach its functions (a name graph over the service's
//	                   packages) → the RPCs
//	an RPC           → specs naming it ("inventory.v1.RackService/RackCreate") + the frontend files
//	                   calling it (rackClient.rackCreate) → the pages importing those → their routes
//	a frontend file  → the pages importing it → their routes → specs visiting them; and its test ids
//	                   → specs using them
//	a .proto         → its RPCs; a migration → its service
//
// What reading cannot tell is in frontend/e2e/affected.txt, a checked-in mapping (glob -> specs).

// affectedResult is the finder's answer.
type affectedResult struct {
	Specs    map[string][]string // spec file → reasons, each "why ← the changed files"
	Untraced []string            // changed source files no spec was traced to
	TestOnly []string            // changed tests (stories, Go tests, story helpers) — no e2e spec runs them
	NotE2E   []string            // changed code no e2e path runs (tools/san beyond the e2e setup)

	reasons map[string]*specReasons
}

// specReasons keeps one spec's reasons in the order found, each with the changed files behind it.
type specReasons struct {
	keys  []string
	files map[string][]string
}

func (r *specReasons) add(key, file string) {
	if r.files[key] == nil {
		r.keys = append(r.keys, key)
	}

	if !contains(r.files[key], file) {
		r.files[key] = append(r.files[key], file)
	}
}

func (r *specReasons) render() []string {
	var out []string

	for i, k := range r.keys {
		if i == 4 {
			out = append(out, fmt.Sprintf("(+%d more reasons)", len(r.keys)-4))

			break
		}

		out = append(out, k+" ← "+shortFiles(r.files[k], 3))
	}

	return out
}

// frontendIndex is what the finder knows about frontend/src and frontend/e2e.
type frontendIndex struct {
	root      string
	imports   map[string][]string // file → files it imports statically (repo-relative)
	importers map[string][]string
	rpcCalls  map[string][]string                // file → full RPC names it calls
	callers   map[string][]rpcCaller             // full RPC name → where it is called
	texts     map[string]string                  // file → its text
	names     map[string]map[string][]importName // importer → imported file → the names it takes
	testids   map[string]testidSet
	routes    map[string][]string // page dir → route patterns
	specs     map[string]*specIndex
}

// importName is one name a file takes from another: the exported name and its local name. "*" is a
// namespace import or a re-export — every name.
type importName struct {
	orig  string
	local string
}

// parseImportClause reads `import a, { b, c as d } from`, `import * as ns from`, `export { … } from`.
func parseImportClause(m []string) []importName {
	var out []importName

	if m[1] == "export" {
		return []importName{{orig: "*", local: "*"}}
	}

	if m[2] != "" {
		out = append(out, importName{orig: "default", local: m[2]})
	}

	if m[4] != "" {
		out = append(out, importName{orig: "*", local: m[4]})
	}

	for _, part := range strings.Split(m[3], ",") {
		part = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(part), "type "))
		if part == "" {
			continue
		}

		orig, local, ok := strings.Cut(part, " as ")
		if !ok {
			local = orig
		}

		out = append(out, importName{orig: strings.TrimSpace(orig), local: strings.TrimSpace(local)})
	}

	return out
}

// rpcCaller is one call of an RPC: the file, and the top-level declaration it sits in.
type rpcCaller struct {
	file     string
	name     string
	exported bool
}

type testidSet struct {
	exact    []string
	prefixes []string
	suffixes []string
}

type specIndex struct {
	file    string
	rpcs    map[string]bool
	paths   []string // literal paths, ${…} as *
	prefixP []string // paths read from URL regexes: a prefix match
	ids     testidSet
	strs    map[string]bool // every quoted literal
	imports []string
}

var (
	importRe        = regexp.MustCompile(`(?m)(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^"'` + "`" + `;]*?\s+from\s+)?["']([^"']+)["']`)
	clientDeclRe    = regexp.MustCompile(`export const (\w+)\s*=\s*createClient\(\s*(\w+)\s*,`)
	clientImportRe  = regexp.MustCompile(`import\s*\{([^}]*)\}\s*from\s*"[./]*gen/warehouse/([a-z_]+)/v1/[a-z_]+_pb"`)
	clientCallRe    = regexp.MustCompile(`\b(\w+Client)\s*\.\s*(\w+)\s*\(`)
	srcTestidRe     = regexp.MustCompile(`(?i)\b(?:data-testid|[a-z]*testid[a-z]*)\s*[=:]\s*\{?\s*(["` + "`" + `])([^"` + "`" + `\n]*)["` + "`" + `]`)
	specRPCRe       = regexp.MustCompile(`["'` + "`" + `]([a-z_]+\.v1\.[A-Za-z]+/[A-Za-z]+)["'` + "`" + `]`)
	specByTestidRe  = regexp.MustCompile(`getByTestId\(\s*(["'` + "`" + `])([^"'` + "`" + `\n]*)["'` + "`" + `]`)
	specByTestidRx  = regexp.MustCompile(`getByTestId\(\s*/\^?([a-z0-9\-]+)`)
	specAttrRe      = regexp.MustCompile(`data-testid([\^$*]?)=\\?["']([^"'\\]+)\\?["']`)
	specLiteralRe   = regexp.MustCompile(`["'` + "`" + `]([^"'` + "`" + `\n]{4,120})["'` + "`" + `]`)
	specPathRe      = regexp.MustCompile(`["'` + "`" + `](/[A-Za-z0-9_\-/${}.:]*)(?:[?#][^"'` + "`" + `]*)?["'` + "`" + `]`)
	specURLRegexRe  = regexp.MustCompile(`(?:toHaveURL|waitForURL)\(\s*/(.+?)/[a-z]*\s*[,)]`)
	templateExprRe  = regexp.MustCompile(`\$\{[^}]*\}`)
	routeEntryRe    = regexp.MustCompile(`\{\s*(?:path:\s*"([^"]*)"|index:\s*true)[^{}]*?element:\s*((?:[^{}]|\{[^{}]*\})*?)\s*(?:,\s*children\b|,?\s*\})`)
	lazyPageRe      = regexp.MustCompile(`(?s)const (\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\("\./pages/([^"/]+)[^"]*"\)`)
	eagerPageRe     = regexp.MustCompile(`import\s*\{([^}]*)\}\s*from\s*"\./pages/([^"/]+)[^"]*"`)
	routerFuncRe    = regexp.MustCompile(`(?s)function (\w+)\([^)]*\)\s*\{(.*?)\n\}`)
	jsxTagRe        = regexp.MustCompile(`<([A-Z]\w*)`)
	routeParamRe    = regexp.MustCompile(`^:`)
	importClauseRe  = regexp.MustCompile(`(?m)\b(import|export)\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+)|\*)?\s*from\s*["']([^"']+)["']`)
	topDeclRe       = regexp.MustCompile(`(?m)^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|(?:const|let|class)\s+(\w+))`)
	regexDigitsRe   = regexp.MustCompile(`\\d\+|\\d\*|\\w\+|\[\^/\]\+|\.\+|\.\*|\(\?:[^)]*\)|\\d\{[0-9,]+\}`)
	protoRPCLineRe  = regexp.MustCompile(`(?m)^\s*rpc\s+(\w+)\s*\(`)
	protoServiceRe  = regexp.MustCompile(`(?m)^\s*service\s+(\w+)\s*\{`)
	goServiceImport = regexp.MustCompile(`backend/services/([a-z_]+_service)/`)
)

// indexFrontend reads frontend/src and frontend/e2e.
func indexFrontend(root string) (*frontendIndex, error) {
	ix := &frontendIndex{
		root:      root,
		imports:   map[string][]string{},
		importers: map[string][]string{},
		rpcCalls:  map[string][]string{},
		callers:   map[string][]rpcCaller{},
		texts:     map[string]string{},
		names:     map[string]map[string][]importName{},
		testids:   map[string]testidSet{},
		routes:    map[string][]string{},
		specs:     map[string]*specIndex{},
	}

	clients, err := readClients(filepath.Join(root, "frontend", "src", "api", "clients.ts"))
	if err != nil {
		return nil, err
	}

	src := filepath.Join(root, "frontend", "src")

	err = filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() {
			if d.Name() == "gen" || d.Name() == "node_modules" {
				return filepath.SkipDir
			}

			return nil
		}

		ext := filepath.Ext(p)
		if ext != ".ts" && ext != ".tsx" {
			return nil
		}

		rel := relSlash(root, p)

		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}

		text := string(b)
		ix.texts[rel] = text

		for _, m := range importRe.FindAllStringSubmatch(text, -1) {
			target := resolveImport(root, rel, m[1])
			if target == "" || contains(ix.imports[rel], target) {
				continue
			}

			ix.imports[rel] = append(ix.imports[rel], target)
			ix.importers[target] = append(ix.importers[target], rel)
		}

		for _, m := range importClauseRe.FindAllStringSubmatch(text, -1) {
			target := resolveImport(root, rel, m[5])
			if target == "" {
				continue
			}

			if ix.names[rel] == nil {
				ix.names[rel] = map[string][]importName{}
			}

			ix.names[rel][target] = append(ix.names[rel][target], parseImportClause(m)...)
		}

		seen := map[string]bool{}
		decls := topDeclRe.FindAllStringSubmatchIndex(text, -1)

		for _, m := range clientCallRe.FindAllStringSubmatchIndex(text, -1) {
			svc, ok := clients[text[m[2]:m[3]]]
			if !ok {
				continue
			}

			method := text[m[4]:m[5]]
			rpc := svc + "/" + strings.ToUpper(method[:1]) + method[1:]

			if !seen[rpc] {
				seen[rpc] = true
				ix.rpcCalls[rel] = append(ix.rpcCalls[rel], rpc)
			}

			ix.callers[rpc] = append(ix.callers[rpc], enclosingDecl(text, decls, m[0], rel))
		}

		ix.testids[rel] = sourceTestids(text)

		return nil
	})
	if err != nil {
		return nil, err
	}

	router, err := os.ReadFile(filepath.Join(src, "router.tsx"))
	if err == nil {
		ix.routes = parseRoutes(string(router))
	}

	e2e := filepath.Join(root, "frontend", "e2e")

	entries, err := os.ReadDir(e2e)
	if err != nil {
		return nil, err
	}

	// A spec's own helper module (restock_helpers.ts, since restock.spec.ts was split — backlog #51) holds RPCs, pages
	// and test ids the spec reaches through it, so it is read as part of each spec importing it. The suite-wide setup
	// every spec imports (global-setup, env, session, db, lock, pubsub) is not: it would make every spec reach Login.
	helpers := map[string]string{}

	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".ts") || strings.HasSuffix(n, ".spec.ts") || suiteSetupHelpers[n] {
			continue
		}

		b, err := os.ReadFile(filepath.Join(e2e, n))
		if err != nil {
			return nil, err
		}

		helpers[strings.TrimSuffix(n, ".ts")] = string(b)
	}

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".spec.ts") {
			continue
		}

		b, err := os.ReadFile(filepath.Join(e2e, e.Name()))
		if err != nil {
			return nil, err
		}

		text := string(b)

		for _, imp := range indexSpec(e.Name(), text).imports {
			if h, ok := helpers[strings.TrimSuffix(imp, ".ts")]; ok {
				text += "\n" + h
			}
		}

		ix.specs[e.Name()] = indexSpec(e.Name(), text)
	}

	return ix, nil
}

// suiteSetupHelpers are the e2e modules every spec imports for the run itself, not for what it tests.
var suiteSetupHelpers = map[string]bool{
	"global-setup.ts": true, "global-teardown.ts": true, "env.ts": true, "session.ts": true, "db.ts": true,
	"lock.ts": true, "pubsub.ts": true,
}

func relSlash(root, p string) string {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return filepath.ToSlash(p)
	}

	return filepath.ToSlash(rel)
}

// readClients maps each exported client to its RPC service's full name ("inventory.v1.RackService").
func readClients(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}

	if err != nil {
		return nil, err
	}

	text := string(b)
	pkgOf := map[string]string{}

	for _, m := range clientImportRe.FindAllStringSubmatch(text, -1) {
		for _, name := range strings.Split(m[1], ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				pkgOf[name] = m[2] + ".v1"
			}
		}
	}

	clients := map[string]string{}

	for _, m := range clientDeclRe.FindAllStringSubmatch(text, -1) {
		pkg, ok := pkgOf[m[2]]
		if ok {
			clients[m[1]] = pkg + "." + m[2]
		}
	}

	return clients, nil
}

// enclosingDecl is the top-level declaration a position sits in — the hook or function that makes the call.
func enclosingDecl(text string, decls [][]int, pos int, file string) rpcCaller {
	c := rpcCaller{file: file}

	for _, d := range decls {
		if d[0] > pos {
			break
		}

		c.exported = d[2] >= 0
		c.name = ""

		switch {
		case d[4] >= 0:
			c.name = text[d[4]:d[5]]
		case d[6] >= 0:
			c.name = text[d[6]:d[7]]
		}
	}

	return c
}

// resolveImport resolves a relative import from a repo-relative file; "" for packages and gen.
func resolveImport(root, from, spec string) string {
	if !strings.HasPrefix(spec, ".") {
		return ""
	}

	base := path.Join(path.Dir(from), spec)
	if strings.Contains(base, "/gen/") {
		return ""
	}

	for _, cand := range []string{base, base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"} {
		info, err := os.Stat(filepath.Join(root, filepath.FromSlash(cand)))
		if err == nil && !info.IsDir() {
			return cand
		}
	}

	return ""
}

// sourceTestids are the test ids a source file renders: a literal, or a template's fixed head/tail.
func sourceTestids(text string) testidSet {
	var s testidSet

	for _, m := range srcTestidRe.FindAllStringSubmatch(text, -1) {
		v := m[2]

		if m[1] != "`" || !strings.Contains(v, "${") {
			if v != "" {
				s.exact = append(s.exact, v)
			}

			continue
		}

		head := v[:strings.Index(v, "${")]
		if len(head) >= 4 {
			s.prefixes = append(s.prefixes, head)
		}

		tail := v[strings.LastIndex(v, "}")+1:]
		if len(tail) >= 4 {
			s.suffixes = append(s.suffixes, tail)
		}
	}

	return s
}

// indexSpec reads one spec's RPC names, paths and test ids.
func indexSpec(name, text string) *specIndex {
	sp := &specIndex{file: name, rpcs: map[string]bool{}, strs: map[string]bool{}}

	for _, m := range specRPCRe.FindAllStringSubmatch(text, -1) {
		sp.rpcs[m[1]] = true
	}

	for _, m := range specPathRe.FindAllStringSubmatch(text, -1) {
		p := templateExprRe.ReplaceAllString(m[1], "*")
		if len(p) > 1 && !strings.Contains(p, "//") && !strings.HasPrefix(p, "/event/") {
			sp.paths = append(sp.paths, p)
		}
	}

	for _, m := range specURLRegexRe.FindAllStringSubmatch(text, -1) {
		p := strings.ReplaceAll(m[1], `\/`, "/")
		p = regexDigitsRe.ReplaceAllString(p, "*")
		p = strings.Trim(p, "^$")

		if strings.HasPrefix(p, "/") && !strings.ContainsAny(p, `\[]()|+?`) {
			sp.prefixP = append(sp.prefixP, p)
		}
	}

	for _, m := range specByTestidRe.FindAllStringSubmatch(text, -1) {
		v := m[2]
		if m[1] == "`" && strings.Contains(v, "${") {
			if head := v[:strings.Index(v, "${")]; len(head) >= 4 {
				sp.ids.prefixes = append(sp.ids.prefixes, head)
			}

			continue
		}

		sp.ids.exact = append(sp.ids.exact, v)
	}

	for _, m := range specByTestidRx.FindAllStringSubmatch(text, -1) {
		if len(m[1]) >= 4 {
			sp.ids.prefixes = append(sp.ids.prefixes, m[1])
		}
	}

	for _, m := range specAttrRe.FindAllStringSubmatch(text, -1) {
		switch m[1] {
		case "":
			sp.ids.exact = append(sp.ids.exact, m[2])
		case "^":
			sp.ids.prefixes = append(sp.ids.prefixes, m[2])
		case "$":
			sp.ids.suffixes = append(sp.ids.suffixes, m[2])
		}
	}

	for _, m := range specLiteralRe.FindAllStringSubmatch(text, -1) {
		v := m[1]
		if strings.Contains(v, "-") && !strings.Contains(v, " ") {
			if i := strings.Index(v, "${"); i >= 0 {
				if i >= 4 {
					sp.ids.prefixes = append(sp.ids.prefixes, v[:i])
				}

				continue
			}

			sp.strs[v] = true
		}
	}

	for _, m := range importRe.FindAllStringSubmatch(text, -1) {
		if strings.HasPrefix(m[1], "./") {
			sp.imports = append(sp.imports, strings.TrimPrefix(m[1], "./"))
		}
	}

	return sp
}

// usesTestid says which of a source file's test ids a spec uses ("" when none).
func (sp *specIndex) usesTestid(src testidSet) string {
	for _, e := range src.exact {
		if len(e) < 3 {
			continue
		}

		for _, x := range sp.ids.exact {
			if x == e {
				return e
			}
		}

		if sp.strs[e] {
			return e
		}

		for _, p := range sp.ids.prefixes {
			if len(p) >= 4 && strings.HasPrefix(e, p) {
				return e
			}
		}

		for _, s := range sp.ids.suffixes {
			if len(s) >= 10 && strings.HasSuffix(e, s) {
				return e
			}
		}
	}

	for _, q := range src.prefixes {
		for _, x := range sp.ids.exact {
			if strings.HasPrefix(x, q) {
				return q + "…"
			}
		}

		for x := range sp.strs {
			if strings.HasPrefix(x, q) {
				return q + "…"
			}
		}

		for _, p := range sp.ids.prefixes {
			if len(p) >= 4 && (strings.HasPrefix(p, q) || strings.HasPrefix(q, p)) {
				return q + "…"
			}
		}
	}

	// A suffix alone ("-value") names too little: only a long one counts.
	for _, t := range src.suffixes {
		for _, s := range sp.ids.suffixes {
			if s == t && len(t) >= 10 {
				return "…" + t
			}
		}
	}

	return ""
}

// parseRoutes maps each page directory to the route patterns that render it.
func parseRoutes(text string) map[string][]string {
	compPages := map[string][]string{}

	for _, m := range lazyPageRe.FindAllStringSubmatch(text, -1) {
		compPages[m[1]] = append(compPages[m[1]], m[2])
	}

	for _, m := range eagerPageRe.FindAllStringSubmatch(text, -1) {
		for _, name := range strings.Split(m[1], ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				compPages[name] = append(compPages[name], m[2])
			}
		}
	}

	// A route component written in router.tsx (RestockRoute) renders the pages its JSX names.
	funcs := map[string][]string{}

	for _, m := range routerFuncRe.FindAllStringSubmatch(text, -1) {
		for _, t := range jsxTagRe.FindAllStringSubmatch(m[2], -1) {
			funcs[m[1]] = append(funcs[m[1]], t[1])
		}
	}

	var pagesOf func(comp string, depth int) []string

	pagesOf = func(comp string, depth int) []string {
		if depth > 4 {
			return nil
		}

		out := append([]string(nil), compPages[comp]...)

		for _, child := range funcs[comp] {
			out = append(out, pagesOf(child, depth+1)...)
		}

		return out
	}

	routes := map[string][]string{}

	for _, m := range routeEntryRe.FindAllStringSubmatch(text, -1) {
		route := "/" + strings.TrimPrefix(m[1], "/")

		for _, t := range jsxTagRe.FindAllStringSubmatch(m[2], -1) {
			for _, dir := range pagesOf(t[1], 0) {
				if !contains(routes[dir], route) {
					routes[dir] = append(routes[dir], route)
				}
			}
		}
	}

	return routes
}

// pathMatches says whether a spec's path visits a route pattern.
func pathMatches(route, visited string, prefix bool) bool {
	r := strings.Split(strings.Trim(route, "/"), "/")
	v := strings.Split(strings.Trim(visited, "/"), "/")

	if route == "/" {
		return visited == "/"
	}

	if prefix {
		if len(v) > len(r) {
			return false
		}
	} else if len(v) != len(r) {
		return false
	}

	for i := range v {
		if routeParamRe.MatchString(r[i]) {
			continue
		}

		if strings.Contains(v[i], "*") {
			continue
		}

		if r[i] != v[i] {
			return false
		}
	}

	return true
}

// staticImporters is every file importing f, directly or not, f included — tests and stories left out.
func (ix *frontendIndex) staticImporters(f string) []string {
	return ix.importersOf([]string{f})
}

// shellFile is a file every page renders through: the router, the entry, the layout and the menu.
func shellFile(f string) bool {
	return appShellFiles[f] || strings.HasPrefix(f, "frontend/src/layouts/")
}

// importersOf is every file importing any seed, directly or not, the seeds included. It does not
// climb past the app shell: a hook module the sidebar happens to import (a badge count) would
// otherwise make every route "affected" by every RPC that module calls. A change to the shell itself
// is a wide change — the full run is due for it anyway.
func (ix *frontendIndex) importersOf(seeds []string) []string {
	seen := map[string]bool{}

	var queue []string

	for _, f := range seeds {
		if !seen[f] {
			seen[f] = true
			queue = append(queue, f)
		}
	}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]

		if shellFile(cur) && !contains(seeds, cur) {
			continue
		}

		for _, imp := range ix.importers[cur] {
			if seen[imp] || testOnly(imp) {
				continue
			}

			seen[imp] = true
			queue = append(queue, imp)
		}
	}

	out := make([]string, 0, len(seen))
	for f := range seen {
		out = append(out, f)
	}

	sort.Strings(out)

	return out
}

// affectedNames is a file's exported names a change reaches; all == every one of them.
type affectedNames struct {
	all   bool
	names map[string]bool
}

func (a affectedNames) has(name string) bool {
	return a.all || a.names[name]
}

// declsMentioning is a file's top-level declarations whose text mentions any of the locals.
func declsMentioning(text string, locals []string) map[string]bool {
	out := map[string]bool{}
	decls := topDeclRe.FindAllStringSubmatchIndex(text, -1)

	for i, d := range decls {
		end := len(text)
		if i+1 < len(decls) {
			end = decls[i+1][0]
		}

		body := text[d[1]:end]

		name := ""

		switch {
		case d[4] >= 0:
			name = text[d[4]:d[5]]
		case d[6] >= 0:
			name = text[d[6]:d[7]]
		}

		if name == "" {
			continue
		}

		for _, l := range locals {
			if wordIn(body, l) {
				out[name] = true

				break
			}
		}
	}

	return out
}

// wordIn says whether name appears in text as a whole identifier.
func wordIn(text, name string) bool {
	for i := 0; ; {
		j := strings.Index(text[i:], name)
		if j < 0 {
			return false
		}

		j += i
		before := j == 0 || !isIdentByte(text[j-1])
		after := j+len(name) >= len(text) || !isIdentByte(text[j+len(name)])

		if before && after {
			return true
		}

		i = j + len(name)
	}
}

func isIdentByte(c byte) bool {
	return c == '_' || c == '$' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}

// reachedFiles follows a change up the import graph BY NAME: an importer is reached only when it takes
// a reached name, and then only its declarations that mention one are reached in turn. A hook module
// imported for another hook is not reached. It stops at the app shell (see importersOf).
func (ix *frontendIndex) reachedFiles(seeds map[string]affectedNames) []string {
	reached := map[string]affectedNames{}

	var queue []string

	for f, a := range seeds {
		reached[f] = a
		queue = append(queue, f)
	}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		curNames := reached[cur]

		if shellFile(cur) {
			if _, seed := seeds[cur]; !seed {
				continue
			}
		}

		for _, imp := range ix.importers[cur] {
			if testOnly(imp) {
				continue
			}

			var locals []string

			passAll := false

			for _, n := range ix.names[imp][cur] {
				if n.orig == "*" {
					passAll = true

					continue
				}

				if curNames.has(n.orig) {
					locals = append(locals, n.local)
				}
			}

			var next affectedNames

			switch {
			case passAll:
				next = affectedNames{all: true}
			case len(locals) == 0 && len(ix.names[imp][cur]) == 0:
				// An import this reader could not name (a side-effect import): every name.
				next = affectedNames{all: true}
			case len(locals) == 0:
				continue
			default:
				next = affectedNames{names: declsMentioning(ix.texts[imp], locals)}
				if len(next.names) == 0 {
					// Used outside any declaration (module scope): the whole module.
					next = affectedNames{all: true}
				}
			}

			prev, seen := reached[imp]
			if seen && (prev.all || !next.all && subset(next.names, prev.names)) {
				continue
			}

			if seen && !next.all && !prev.all {
				for n := range prev.names {
					next.names[n] = true
				}
			}

			reached[imp] = next
			queue = append(queue, imp)
		}
	}

	out := make([]string, 0, len(reached))
	for f := range reached {
		out = append(out, f)
	}

	sort.Strings(out)

	return out
}

func subset(a, b map[string]bool) bool {
	for k := range a {
		if !b[k] {
			return false
		}
	}

	return true
}

// pagesOf is the page directories a set of files belongs to; every routed page when the change IS the
// shell (shellSeed) — reaching the shell from below does not count (importersOf).
func (ix *frontendIndex) pagesOf(files []string, shellSeed bool) (pages []string, shell bool) {
	seen := map[string]bool{}
	shell = shellSeed

	for _, f := range files {

		seg := strings.Split(f, "/")
		if len(seg) >= 4 && seg[1] == "src" && seg[2] == "pages" && !seen[seg[3]] {
			seen[seg[3]] = true
			pages = append(pages, seg[3])
		}
	}

	if shell {
		pages = pages[:0]
		for dir := range ix.routes {
			pages = append(pages, dir)
		}
	}

	sort.Strings(pages)

	return pages, shell
}

// specsVisiting is the specs visiting a page's routes.
func (ix *frontendIndex) specsVisiting(page string) map[string]string {
	out := map[string]string{}

	for _, route := range ix.routes[page] {
		for name, sp := range ix.specs {
			if _, done := out[name]; done {
				continue
			}

			for _, p := range sp.paths {
				if pathMatches(route, p, false) {
					out[name] = route

					break
				}
			}

			if _, done := out[name]; done {
				continue
			}

			for _, p := range sp.prefixP {
				if pathMatches(route, p, true) {
					out[name] = route

					break
				}
			}
		}
	}

	return out
}

// ── the Go side ───────────────────────────────────────────────────────────────────────────────────

// goServiceIndex is one backend service's declarations and who refers to whom.
type goServiceIndex struct {
	service  string
	rpcs     map[string][]string // Go method name → full RPC names
	declsOf  map[string][]string // repo-relative file → names it declares
	refs     map[string][]string // name → names its body refers to
	handlers map[string]bool     // method names that are RPC handlers
}

// protoRPCs reads every rpc of every proto package: "inventory" → full names ("inventory.v1.RackService/RackCreate").
func protoRPCs(root string) (map[string][]string, map[string][]string, error) {
	byDomain := map[string][]string{}
	byFile := map[string][]string{}

	dir := filepath.Join(root, "proto", "warehouse")

	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() || filepath.Ext(p) != ".proto" {
			return nil
		}

		rel := relSlash(root, p)
		seg := strings.Split(rel, "/")

		if len(seg) < 4 {
			return nil
		}

		domain := seg[2]

		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}

		pf := parseProto(string(b))

		for _, r := range pf.RPCs {
			full := domain + ".v1." + r.Service + "/" + r.Name
			byDomain[domain] = append(byDomain[domain], full)
			byFile[rel] = append(byFile[rel], full)
		}

		return nil
	})
	if os.IsNotExist(err) {
		return byDomain, byFile, nil
	}

	return byDomain, byFile, err
}

// indexGoService parses a service's non-test Go files.
func indexGoService(root, service string, rpcs []string) (*goServiceIndex, error) {
	gx := &goServiceIndex{
		service:  service,
		rpcs:     map[string][]string{},
		declsOf:  map[string][]string{},
		refs:     map[string][]string{},
		handlers: map[string]bool{},
	}

	for _, full := range rpcs {
		_, method, _ := strings.Cut(full, "/")
		gx.rpcs[method] = append(gx.rpcs[method], full)
	}

	fset := token.NewFileSet()
	dir := filepath.Join(root, "backend", "services", service)

	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() || filepath.Ext(p) != ".go" || strings.HasSuffix(p, "_test.go") {
			return nil
		}

		f, err := parser.ParseFile(fset, p, nil, parser.SkipObjectResolution)
		if err != nil {
			return nil // a file that does not parse is reported by go build, not here
		}

		rel := relSlash(root, p)

		for _, decl := range f.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				name := d.Name.Name
				gx.declsOf[rel] = append(gx.declsOf[rel], name)

				if d.Recv != nil && gx.rpcs[name] != nil {
					gx.handlers[name] = true
				}

				gx.refs[name] = append(gx.refs[name], refsIn(d.Body, localsOf(d))...)
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch s := spec.(type) {
					case *ast.TypeSpec:
						gx.declsOf[rel] = append(gx.declsOf[rel], s.Name.Name)
						gx.refs[s.Name.Name] = append(gx.refs[s.Name.Name], refsIn(s.Type, nil)...)
					case *ast.ValueSpec:
						for _, n := range s.Names {
							gx.declsOf[rel] = append(gx.declsOf[rel], n.Name)

							for _, v := range s.Values {
								gx.refs[n.Name] = append(gx.refs[n.Name], refsIn(v, nil)...)
							}
						}
					}
				}
			}
		}

		return nil
	})

	return gx, err
}

// localsOf is the names a function declares for itself — receiver, parameters, results, and every
// variable it defines. A body's `rows := …` must not read as a reference to a package-level rows().
func localsOf(fn *ast.FuncDecl) map[string]bool {
	locals := map[string]bool{}

	fields := func(fl *ast.FieldList) {
		if fl == nil {
			return
		}

		for _, f := range fl.List {
			for _, n := range f.Names {
				locals[n.Name] = true
			}
		}
	}

	fields(fn.Recv)
	fields(fn.Type.Params)
	fields(fn.Type.Results)

	if fn.Body == nil {
		return locals
	}

	ast.Inspect(fn.Body, func(x ast.Node) bool {
		switch s := x.(type) {
		case *ast.AssignStmt:
			if s.Tok == token.DEFINE {
				for _, l := range s.Lhs {
					id, ok := l.(*ast.Ident)
					if ok {
						locals[id.Name] = true
					}
				}
			}
		case *ast.ValueSpec:
			for _, n := range s.Names {
				locals[n.Name] = true
			}
		case *ast.RangeStmt:
			if s.Tok == token.DEFINE {
				for _, e := range []ast.Expr{s.Key, s.Value} {
					id, ok := e.(*ast.Ident)
					if ok {
						locals[id.Name] = true
					}
				}
			}
		case *ast.FuncLit:
			fields(s.Type.Params)
			fields(s.Type.Results)
		}

		return true
	})

	return locals
}

// refsIn is the names a node refers to: plain identifiers that are not locals, a called method's
// name (x.foo()), and an exported name taken from a package (pkg.Thing). A field read (x.rows) is
// not a reference — it would tie every handler to every function sharing a field's name.
func refsIn(n ast.Node, locals map[string]bool) []string {
	if n == nil {
		return nil
	}

	seen := map[string]bool{}

	var out []string

	note := func(name string) {
		if len(name) > 1 && !seen[name] && !locals[name] {
			seen[name] = true
			out = append(out, name)
		}
	}

	var visit func(x ast.Node) bool

	visit = func(x ast.Node) bool {
		switch e := x.(type) {
		case *ast.Ident:
			note(e.Name)
		case *ast.CallExpr:
			sel, ok := e.Fun.(*ast.SelectorExpr)
			if ok {
				note(sel.Sel.Name)
			}
		case *ast.SelectorExpr:
			id, ok := e.X.(*ast.Ident)
			if ok && ast.IsExported(e.Sel.Name) && !ast.IsExported(id.Name) && !locals[id.Name] {
				note(e.Sel.Name)
			}

			ast.Inspect(e.X, visit)

			return false
		}

		return true
	}

	ast.Inspect(n, visit)

	return out
}

// reachedRPCs is the RPCs whose handlers reach any of names, through the name graph.
func (gx *goServiceIndex) reachedRPCs(names []string) []string {
	target := map[string]bool{}
	for _, n := range names {
		target[n] = true
	}

	var out []string

	seenRPC := map[string]bool{}

	for h := range gx.handlers {
		if !gx.reaches(h, target) {
			continue
		}

		for _, full := range gx.rpcs[h] {
			if !seenRPC[full] {
				seenRPC[full] = true
				out = append(out, full)
			}
		}
	}

	sort.Strings(out)

	return out
}

func (gx *goServiceIndex) reaches(from string, target map[string]bool) bool {
	seen := map[string]bool{}
	stack := []string{from}

	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if target[cur] {
			return true
		}

		if seen[cur] {
			continue
		}

		seen[cur] = true

		stack = append(stack, gx.refs[cur]...)
	}

	return false
}

// ── the mapping file ──────────────────────────────────────────────────────────────────────────────

type affectedMapping struct {
	glob  string
	specs []string
	why   string
}

// readAffectedMap reads frontend/e2e/affected.txt: `glob -> spec, spec  # why`.
func readAffectedMap(root string) ([]affectedMapping, error) {
	f, err := os.Open(filepath.Join(root, "frontend", "e2e", "affected.txt"))
	if os.IsNotExist(err) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	defer func() { _ = f.Close() }()

	var out []affectedMapping

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		why := ""
		if i := strings.Index(line, "#"); i >= 0 {
			why = strings.TrimSpace(line[i+1:])
			line = strings.TrimSpace(line[:i])
		}

		glob, specs, ok := strings.Cut(line, "->")
		if !ok {
			continue
		}

		m := affectedMapping{glob: strings.TrimSpace(glob), why: why}

		for _, s := range strings.Split(specs, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				m.specs = append(m.specs, s)
			}
		}

		out = append(out, m)
	}

	return out, sc.Err()
}

// globMatch matches a repo-relative path against a glob where ** crosses directories.
func globMatch(glob, p string) bool {
	re := regexp.QuoteMeta(glob)
	re = strings.ReplaceAll(re, `\*\*/`, `(?:.*/)?`)
	re = strings.ReplaceAll(re, `\*\*`, `.*`)
	re = strings.ReplaceAll(re, `\*`, `[^/]*`)
	re = strings.ReplaceAll(re, `\?`, `[^/]`)

	ok, err := regexp.MatchString("^"+re+"$", p)

	return err == nil && ok
}

// ── the finder ────────────────────────────────────────────────────────────────────────────────────

// findAffected traces changed files to the specs they reach.
func findAffected(root string, changed []string) (*affectedResult, error) {
	res := &affectedResult{Specs: map[string][]string{}, reasons: map[string]*specReasons{}}

	ix, err := indexFrontend(root)
	if err != nil {
		return nil, err
	}

	byDomain, byProtoFile, err := protoRPCs(root)
	if err != nil {
		return nil, err
	}

	mapping, err := readAffectedMap(root)
	if err != nil {
		return nil, err
	}

	goIndexes := map[string]*goServiceIndex{}

	goIndex := func(service string) *goServiceIndex {
		gx, ok := goIndexes[service]
		if ok {
			return gx
		}

		gx, err := indexGoService(root, service, byDomain[strings.TrimSuffix(service, "_service")])
		if err != nil {
			gx = &goServiceIndex{service: service}
		}

		goIndexes[service] = gx

		return gx
	}

	// current is the changed file being traced; every reason names it.
	current := ""

	add := func(spec, reason string) {
		if _, ok := ix.specs[spec]; !ok {
			return
		}

		r := res.reasons[spec]
		if r == nil {
			r = &specReasons{files: map[string][]string{}}
			res.reasons[spec] = r
		}

		r.add(reason, current)
	}

	// viaRPCs adds the specs an RPC set reaches: specs naming it, and the pages calling it.
	viaRPCs := func(rpcs []string, note string) int {
		hits := 0

		for _, rpc := range rpcs {
			short := rpc[strings.LastIndex(rpc, ".")+1:]

			for name, sp := range ix.specs {
				if sp.rpcs[rpc] {
					add(name, "calls "+short+note)
					hits++
				}
			}

			for _, call := range ix.callers[rpc] {
				if testOnly(call.file) {
					continue
				}

				// Up the imports BY NAME, from the hook or function making the call.
				seed := affectedNames{all: true}
				if call.exported && call.name != "" {
					seed = affectedNames{names: map[string]bool{call.name: true}}
				} else if call.name != "" {
					seed = affectedNames{names: declsMentioning(ix.texts[call.file], []string{call.name})}
					if len(seed.names) == 0 {
						seed = affectedNames{all: true}
					}
				}

				pages, _ := ix.pagesOf(ix.reachedFiles(map[string]affectedNames{call.file: seed}), false)
				for _, page := range pages {
					for spec, route := range ix.specsVisiting(page) {
						add(spec, fmt.Sprintf("opens %s, which calls %s%s", route, short, note))
						hits++
					}
				}
			}
		}

		return hits
	}

	serviceWide := func(service string) int {
		return viaRPCs(byDomain[strings.TrimSuffix(service, "_service")], " (no handler traced: every RPC of "+service+")")
	}

	for _, p := range changed {
		base := path.Base(p)
		seg := strings.Split(p, "/")
		hits := 0
		current = p

		for _, m := range mapping {
			if globMatch(m.glob, p) {
				for _, s := range m.specs {
					add(s, "affected.txt: "+m.why)
					hits++
				}
			}
		}

		switch {
		case strings.HasPrefix(p, "frontend/e2e/") && strings.HasSuffix(p, ".spec.ts"):
			if _, ok := ix.specs[base]; ok {
				add(base, "the spec itself changed")
				hits++
			}
		case strings.HasPrefix(p, "frontend/e2e/") && (strings.HasSuffix(p, ".ts")):
			helper := strings.TrimSuffix(base, ".ts")
			for name, sp := range ix.specs {
				if contains(sp.imports, helper) || contains(sp.imports, base) {
					add(name, "imports the changed helper")
					hits++
				}
			}
		case testOnly(p) || p == "frontend/e2e/smoke.txt" || p == "frontend/e2e/affected.txt" ||
			p == "frontend/e2e/coupled.txt":
			res.TestOnly = append(res.TestOnly, p)

			continue
		case strings.HasPrefix(p, "tools/") && !e2eSetupSanFiles[p]:
			res.NotE2E = append(res.NotE2E, p)

			continue
		case strings.HasPrefix(p, "frontend/src/"):
			importers := ix.reachedFiles(map[string]affectedNames{p: {all: true}})
			pages, shell := ix.pagesOf(importers, shellFile(p))

			// A helper only stories and tests import (a story's layout helper) is a test.
			if len(pages) == 0 && len(ix.importers[p]) > 0 && hits == 0 && allTests(ix.importers[p]) {
				res.TestOnly = append(res.TestOnly, p)

				continue
			}

			for _, page := range pages {
				for spec, route := range ix.specsVisiting(page) {
					reason := fmt.Sprintf("opens %s (page %s)", route, page)
					if shell {
						reason = fmt.Sprintf("opens %s (the app shell)", route)
					}

					add(spec, reason)
					hits++
				}
			}

			ids := ix.testids[p]
			for name, sp := range ix.specs {
				if id := sp.usesTestid(ids); id != "" {
					add(name, "uses test id "+id)
					hits++
				}
			}
		case len(seg) >= 3 && seg[0] == "backend" && seg[1] == "services":
			service := seg[2]
			gx := goIndex(service)

			if strings.HasSuffix(p, ".go") {
				names := gx.declsOf[p]
				if len(names) > 0 {
					hits += viaRPCs(gx.reachedRPCs(names), "")
				}
			}

			if hits == 0 {
				hits += serviceWide(service)
			}
		case len(seg) >= 3 && seg[0] == "backend" && seg[1] == "pkgs":
			for _, service := range servicesImporting(root, "backend/pkgs/"+seg[2]) {
				hits += serviceWide(service)
			}
		case len(seg) >= 3 && seg[0] == "backend" && seg[1] == "cmd":
			b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(p)))
			if err == nil {
				seen := map[string]bool{}
				for _, m := range goServiceImport.FindAllStringSubmatch(string(b), -1) {
					if !seen[m[1]] {
						seen[m[1]] = true
						hits += serviceWide(m[1])
					}
				}
			}
		case strings.HasPrefix(p, "proto/") && strings.HasSuffix(p, ".proto"):
			if rpcs := byProtoFile[p]; len(rpcs) > 0 {
				hits += viaRPCs(rpcs, "")
			} else if len(seg) >= 4 && seg[1] == "warehouse" {
				hits += serviceWide(seg[2] + "_service")
			}
		}

		if hits == 0 {
			res.Untraced = append(res.Untraced, p)
		}
	}

	for spec, r := range res.reasons {
		res.Specs[spec] = r.render()
	}

	return res, nil
}

func allTests(files []string) bool {
	for _, f := range files {
		if !testOnly(f) {
			return false
		}
	}

	return true
}

// servicesImporting lists the backend services whose non-test Go files import a package path.
func servicesImporting(root, pkgPath string) []string {
	var out []string

	entries, err := os.ReadDir(filepath.Join(root, "backend", "services"))
	if err != nil {
		return nil
	}

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}

		found := false

		_ = filepath.WalkDir(filepath.Join(root, "backend", "services", e.Name()), func(p string, d os.DirEntry, err error) error {
			if err != nil || found {
				return filepath.SkipDir
			}

			if d.IsDir() || filepath.Ext(p) != ".go" || strings.HasSuffix(p, "_test.go") {
				return nil
			}

			b, err := os.ReadFile(p)
			if err == nil && (strings.Contains(string(b), pkgPath+`"`) || strings.Contains(string(b), pkgPath+"/")) {
				found = true

				return filepath.SkipAll
			}

			return nil
		})

		if found {
			out = append(out, e.Name())
		}
	}

	return out
}

// printAffected writes the finder's answer and the smoke set.
func printAffected(out io.Writer, res *affectedResult, smoke []smokeFlow, changed int, source string) {
	fmt.Fprintf(out, "affected — %d changed files (%s)\n\n", changed, source)

	specs := make([]string, 0, len(res.Specs))
	for s := range res.Specs {
		specs = append(specs, s)
	}

	sort.Strings(specs)

	if len(specs) == 0 {
		fmt.Fprintln(out, "  no e2e spec is traced to these files")
	} else {
		fmt.Fprintf(out, "  %d affected specs:\n", len(specs))

		for _, s := range specs {
			fmt.Fprintf(out, "    %s\n", s)

			for _, r := range res.Specs[s] {
				fmt.Fprintf(out, "        %s\n", r)
			}
		}
	}

	if len(res.Untraced) > 0 {
		fmt.Fprintf(out, "\n  not traced to a spec (the smoke set covers them; add a line to frontend/e2e/affected.txt if one should):\n")

		for _, p := range res.Untraced {
			fmt.Fprintf(out, "    %s\n", p)
		}
	}

	if len(res.TestOnly) > 0 {
		fmt.Fprintf(out, "\n  tests only — run them where they live (go test, the story's vitest file): %s\n", shortFiles(res.TestOnly, 6))
	}

	if len(res.NotE2E) > 0 {
		fmt.Fprintf(out, "\n  no e2e path runs these (their own go tests do): %s\n", shortFiles(res.NotE2E, 6))
	}

	fmt.Fprintf(out, "\n  the smoke set (frontend/e2e/smoke.txt):\n")

	for _, f := range smoke {
		fmt.Fprintf(out, "    %s\n", f.Name)

		for _, e := range f.entryNames() {
			fmt.Fprintf(out, "        %s\n", e)
		}
	}
}
