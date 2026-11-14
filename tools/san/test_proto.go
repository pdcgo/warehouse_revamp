package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Reading the two kinds of file whose CONTENT, not just their path, decides whether a change is wide
// (the-full-e2e-waits-for-a-measured-yes): a .proto (an existing field made required, a request_policy
// changed, an event's contents changed) and a goose migration (one that alters an existing table).
//
// The .proto reader is deliberately small — it is not a compiler. It knows messages (nested), oneofs,
// fields with their [options], message-level `option` statements, services and rpcs, and skips the
// rest. A file it cannot follow yields fewer facts, never an error: the measurement is a heuristic.

type protoField struct {
	Type    string
	Number  string
	Options string // the field's [ … ] options, normalised to single spaces
}

type protoMessage struct {
	Name    string // nested names joined with "."
	Options []string
	Fields  map[string]protoField
}

type protoRPC struct {
	Service string
	Name    string
	Request string
}

type protoFile struct {
	Package  string
	Messages map[string]*protoMessage
	RPCs     []protoRPC
}

var protoTokenRe = regexp.MustCompile(`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z0-9_.\-+]+|[{}\[\]()<>;=,:]`)

// stripProtoComments removes // and /* */ comments, leaving string literals alone.
func stripProtoComments(src string) string {
	var b strings.Builder

	for i := 0; i < len(src); i++ {
		c := src[i]

		switch {
		case c == '"' || c == '\'':
			j := i + 1
			for j < len(src) && src[j] != c {
				if src[j] == '\\' {
					j++
				}
				j++
			}

			if j >= len(src) {
				j = len(src) - 1
			}

			b.WriteString(src[i : j+1])
			i = j
		case c == '/' && i+1 < len(src) && src[i+1] == '/':
			for i < len(src) && src[i] != '\n' {
				i++
			}

			b.WriteByte('\n')
		case c == '/' && i+1 < len(src) && src[i+1] == '*':
			end := strings.Index(src[i+2:], "*/")
			if end < 0 {
				return b.String()
			}

			i += end + 3
		default:
			b.WriteByte(c)
		}
	}

	return b.String()
}

// parseProto reads the facts the measurement needs from one .proto file.
func parseProto(src string) *protoFile {
	toks := protoTokenRe.FindAllString(stripProtoComments(src), -1)
	pf := &protoFile{Messages: map[string]*protoMessage{}}

	type scope struct {
		kind string // message, enum, service, oneof, rpc, other
		name string
	}

	var stack []scope

	currentMessage := func() *protoMessage {
		for i := len(stack) - 1; i >= 0; i-- {
			if stack[i].kind == "message" {
				return pf.Messages[stack[i].name]
			}

			if stack[i].kind != "oneof" {
				return nil
			}
		}

		return nil
	}

	currentService := func() string {
		if len(stack) > 0 && stack[len(stack)-1].kind == "service" {
			return stack[len(stack)-1].name
		}

		return ""
	}

	// statement collects tokens from i up to the ';' that ends the statement, balancing brackets.
	statement := func(i int) ([]string, int) {
		depth := 0
		start := i

		for ; i < len(toks); i++ {
			switch toks[i] {
			case "{", "[", "(", "<":
				depth++
			case "}", "]", ")", ">":
				depth--
			case ";":
				if depth <= 0 {
					return toks[start:i], i
				}
			}
		}

		return toks[start:], len(toks)
	}

	for i := 0; i < len(toks); i++ {
		t := toks[i]

		switch {
		case t == "}":
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case t == ";":
		case t == "package":
			st, end := statement(i + 1)
			pf.Package = strings.Join(st, "")
			i = end
		case t == "message" && i+2 < len(toks) && toks[i+2] == "{":
			name := toks[i+1]

			for j := len(stack) - 1; j >= 0; j-- {
				if stack[j].kind == "message" {
					name = stack[j].name + "." + name

					break
				}
			}

			pf.Messages[name] = &protoMessage{Name: name, Fields: map[string]protoField{}}
			stack = append(stack, scope{kind: "message", name: name})
			i += 2
		case (t == "enum" || t == "extend" || t == "service" || t == "oneof") && i+2 < len(toks) && toks[i+2] == "{":
			stack = append(stack, scope{kind: t, name: toks[i+1]})
			i += 2
		case t == "rpc" && currentService() != "":
			st, end := statement(i + 1)
			rpc := protoRPC{Service: currentService()}

			if len(st) > 0 {
				rpc.Name = st[0]
			}

			if len(st) > 2 && st[1] == "(" {
				rpc.Request = strings.TrimPrefix(st[2], "stream")
				if rpc.Request == "" && len(st) > 3 {
					rpc.Request = st[3]
				}
			}

			pf.RPCs = append(pf.RPCs, rpc)

			// An rpc with an options body ends at its block, not at a ';'.
			k := i + 1
			for ; k < len(toks) && toks[k] != ";" && toks[k] != "{"; k++ {
			}

			if k < len(toks) && toks[k] == "{" {
				depth := 0
				for ; k < len(toks); k++ {
					if toks[k] == "{" {
						depth++
					}

					if toks[k] == "}" {
						depth--
						if depth == 0 {
							break
						}
					}
				}

				i = k
			} else {
				i = end
			}
		case t == "option":
			st, end := statement(i + 1)
			msg := currentMessage()

			if msg != nil && len(stack) > 0 && stack[len(stack)-1].kind == "message" {
				msg.Options = append(msg.Options, strings.Join(st, " "))
			}

			i = end
		case t == "reserved" || t == "syntax" || t == "import" || t == "extensions" || t == "edition":
			_, end := statement(i + 1)
			i = end
		default:
			msg := currentMessage()
			if msg == nil {
				// Inside an enum, a service body, an extend — or junk: skip the statement.
				_, end := statement(i)
				i = end

				continue
			}

			st, end := statement(i)
			i = end

			f, name, ok := parseProtoField(st)
			if ok {
				msg.Fields[name] = f
			}
		}
	}

	return pf
}

// parseProtoField reads `[repeated|optional] TYPE NAME = NUMBER [ [options] ]`.
func parseProtoField(st []string) (protoField, string, bool) {
	eq := -1

	for k, tok := range st {
		if tok == "=" {
			eq = k

			break
		}
	}

	if eq < 2 || eq+1 >= len(st) {
		return protoField{}, "", false
	}

	name := st[eq-1]
	typ := strings.Join(st[:eq-1], " ")
	f := protoField{Type: typ, Number: st[eq+1]}

	if eq+2 < len(st) && st[eq+2] == "[" {
		opts := st[eq+3:]
		if len(opts) > 0 && opts[len(opts)-1] == "]" {
			opts = opts[:len(opts)-1]
		}

		f.Options = strings.Join(opts, " ")
	}

	return f, name, true
}

var requiredMarkerRes = []*regexp.Regexp{
	regexp.MustCompile(`(^|[.\s{,])required\s*[:=]\s*true`),
	regexp.MustCompile(`(^|[.\s{,])gt\s*[:=]`),
	regexp.MustCompile(`(^|[.\s{,])min_len\s*[:=]\s*[1-9]`),
	regexp.MustCompile(`(^|[.\s{,])min_items\s*[:=]\s*[1-9]`),
	regexp.MustCompile(`(^|[.\s{,])min_bytes\s*[:=]\s*[1-9]`),
	regexp.MustCompile(`(^|[.\s{,])not_in\s*[:=]`),
}

// requiresValue says whether a field's options refuse an empty value.
func requiresValue(options string) bool {
	for _, re := range requiredMarkerRes {
		if re.MatchString(options) {
			return true
		}
	}

	return false
}

// policyText is a message's permission options — request_policy and every other role_base option.
func (m *protoMessage) policyText() string {
	var parts []string

	for _, o := range m.Options {
		if strings.Contains(o, "role_base") {
			parts = append(parts, o)
		}
	}

	return strings.Join(parts, " | ")
}

// eventsProto says whether a .proto path holds the event contract.
func eventsProto(path string) bool {
	return strings.Contains(path, "/events/")
}

// protoWideReasons compares one .proto file before and after and names every wide change in it.
// old is nil for a file the baseline did not have — a new file changes no existing contract.
func protoWideReasons(path string, old, cur *protoFile) []string {
	if old == nil {
		return nil
	}

	var reasons []string

	events := eventsProto(path)

	names := make([]string, 0, len(old.Messages))
	for name := range old.Messages {
		names = append(names, name)
	}

	sort.Strings(names)

	for _, name := range names {
		was := old.Messages[name]

		now, ok := cur.Messages[name]
		if !ok {
			if events {
				reasons = append(reasons, fmt.Sprintf("an event's contents: %s was removed", name))
			}

			continue
		}

		if was.policyText() != now.policyText() {
			reasons = append(reasons, fmt.Sprintf("permissions: %s's request_policy changed", name))
		}

		fields := make([]string, 0, len(now.Fields))
		for f := range now.Fields {
			fields = append(fields, f)
		}

		sort.Strings(fields)

		var eventChanges []string

		for _, f := range fields {
			nf := now.Fields[f]

			of, existed := was.Fields[f]
			if !existed {
				if requiresValue(nf.Options) {
					reasons = append(reasons, fmt.Sprintf("a new required field on an existing message: %s.%s", name, f))
				}

				if events && name != "Event" {
					eventChanges = append(eventChanges, f+" added")
				}

				continue
			}

			if requiresValue(nf.Options) && !requiresValue(of.Options) {
				reasons = append(reasons, fmt.Sprintf("an existing field made required: %s.%s", name, f))
			}

			if strings.Contains(nf.Options+of.Options, "role_base") && nf.Options != of.Options {
				reasons = append(reasons, fmt.Sprintf("permissions: %s.%s's scope option changed", name, f))
			}

			if events && (nf.Type != of.Type || nf.Number != of.Number) {
				eventChanges = append(eventChanges, f+" changed")
			}
		}

		if events {
			for f := range was.Fields {
				_, still := now.Fields[f]
				if !still {
					eventChanges = append(eventChanges, f+" removed")
				}
			}
		}

		if len(eventChanges) > 0 {
			sort.Strings(eventChanges)
			reasons = append(reasons, fmt.Sprintf("an event's contents: %s (%s)", name, strings.Join(eventChanges, ", ")))
		}
	}

	return reasons
}

// ── migrations ────────────────────────────────────────────────────────────────────────────────────

var (
	sqlCommentRe   = regexp.MustCompile(`(?m)--.*$`)
	sqlCreateRe    = regexp.MustCompile(`(?i)\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)`)
	sqlAlterRe     = regexp.MustCompile(`(?i)\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_."]+)`)
	sqlDropRe      = regexp.MustCompile(`(?i)\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_.", ]+)`)
	sqlTruncateRe  = regexp.MustCompile(`(?i)\bTRUNCATE\s+(?:TABLE\s+)?([A-Za-z0-9_."]+)`)
	sqlUniqueIdxRe = regexp.MustCompile(`(?i)\bCREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z0-9_."]*\s*ON\s+(?:ONLY\s+)?([A-Za-z0-9_."]+)`)
)

func sqlTableName(s string) string {
	s = strings.Trim(strings.TrimSpace(s), `"`)
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.TrimPrefix(s, "public.")

	return strings.ToLower(s)
}

// migrationUp is a goose file's Up half — the part that runs going forward.
func migrationUp(src string) string {
	lower := strings.ToLower(src)

	up := strings.Index(lower, "+goose up")
	if up >= 0 {
		src = src[up:]
		lower = lower[up:]
	}

	down := strings.Index(lower, "+goose down")
	if down >= 0 {
		src = src[:down]
	}

	return src
}

// migrationAltersExisting names the existing tables a migration alters: ALTER/DROP/TRUNCATE, or a
// UNIQUE index, on a table the same file does not create.
func migrationAltersExisting(src string) []string {
	body := sqlCommentRe.ReplaceAllString(migrationUp(src), "")

	created := map[string]bool{}
	for _, m := range sqlCreateRe.FindAllStringSubmatch(body, -1) {
		created[sqlTableName(m[1])] = true
	}

	seen := map[string]bool{}

	var tables []string

	note := func(name string) {
		name = sqlTableName(name)
		if name == "" || created[name] || seen[name] {
			return
		}

		seen[name] = true
		tables = append(tables, name)
	}

	for _, m := range sqlAlterRe.FindAllStringSubmatch(body, -1) {
		note(m[1])
	}

	for _, m := range sqlDropRe.FindAllStringSubmatch(body, -1) {
		for _, name := range strings.Split(m[1], ",") {
			fields := strings.Fields(name)
			if len(fields) > 0 && !strings.EqualFold(fields[0], "cascade") {
				note(fields[0])
			}
		}
	}

	for _, m := range sqlTruncateRe.FindAllStringSubmatch(body, -1) {
		note(m[1])
	}

	for _, m := range sqlUniqueIdxRe.FindAllStringSubmatch(body, -1) {
		note(m[1])
	}

	sort.Strings(tables)

	return tables
}
