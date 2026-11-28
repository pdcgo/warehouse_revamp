package main

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
)

// The other PC's side of a remote e2e run (backlog #154) — the pure parts: where things live there, what the job
// script does, which commits a bundle leaves out, and unpacking the report that comes back. test_remote.go drives
// them over SSH.
//
// On the other PC, under ~/warehouse_revamp_e2e/ (development.yaml e2e_test.ssh.dir to move it):
//
//	repo/                 ONE git checkout, detached at the commit of the run in progress (never a branch)
//	runs/<run id>/        one folder per run: run.sh, inner.sh, info.json, run.log, exit, runner/ (the compose file and
//	                      the runner's Dockerfile as the SENDER has them), e2e_report/ (mounted over the checkout's)
//	bundles/              the run's incoming git bundle, deleted once fetched
//	subs/                 the submodules' trees, one tar per commit (<path>-<sha>.tar), and which one is unpacked
//	bin/                  the sender's san, built for Linux, one file per content hash
//	cache/                the runner's Go, npm and home folders, kept between runs
//	run.lock              flock: one run at a time on that PC; run.lock.json names the holder
//
// TWO SENDERS, ONE PC (owner, 2026-11-27 — the builder's checkout and the tester's both send runs here):
//   - one run at a time: the job holds flock on run.lock for its whole life; a second job waits and says so (every
//     5 min). The kernel drops the lock when its holder dies, so a lock with no live run never blocks, and the next
//     holder removes any san-e2e-* container a dead run left.
//   - commits never mix: a bundle carries ONE ref, named by its commit (refs/san-send/<sha>); the job fetches it to
//     refs/san/commits/<sha>, checks that ref IS the commit, and checks out --detach <sha>. No branch name is ever
//     fetched or checked out, so one sender can never move what another runs.
//   - each run's report lands in its own runs/<run id>/e2e_report/ first; only its level2/<stamp>-<kind>/ is copied
//     back, into the same e2e_report/level2/ path a local run writes.

const (
	remoteDirDefault = "warehouse_revamp_e2e"

	// inRunnerEnv is set inside the runner container: a san there never sends the run on again.
	inRunnerEnv = "SAN_E2E_IN_RUNNER"

	// headedEnv makes runPlaywrightBatch pass --headed (development.yaml headless: false).
	headedEnv = "SAN_E2E_HEADED"

	// bindHostEnv is the address the e2e's API binds for a worker (default localhost): the runner sets 0.0.0.0, since
	// on Linux the Pub/Sub emulator's container pushes to the host's bridge address, which a loopback-bound API never
	// answers (Docker Desktop's host.docker.internal reaches loopback; Linux's host-gateway does not).
	bindHostEnv = "SAN_E2E_BIND_HOST"

	remoteJobExitDocker = 3 // the job cannot reach docker
	remoteJobExitCommit = 4 // the commit did not arrive or could not be checked out
)

// remoteLayout is where a run's files live on the other PC.
type remoteLayout struct {
	Base string // absolute, e.g. /home/pdc/warehouse_revamp_e2e
	Run  string // the run id
}

func (l remoteLayout) Repo() string     { return l.Base + "/repo" }
func (l remoteLayout) RunDir() string   { return l.Base + "/runs/" + l.Run }
func (l remoteLayout) Bundle() string   { return l.Base + "/bundles/" + l.Run + ".bundle" }
func (l remoteLayout) Subs() string     { return l.Base + "/subs" }
func (l remoteLayout) Bin() string      { return l.Base + "/bin" }
func (l remoteLayout) Cache() string    { return l.Base + "/cache" }
func (l remoteLayout) Lock() string     { return l.Base + "/run.lock" }
func (l remoteLayout) Log() string      { return l.RunDir() + "/run.log" }
func (l remoteLayout) Exit() string     { return l.RunDir() + "/exit" }
func (l remoteLayout) Report() string   { return l.RunDir() + "/e2e_report" }
func (l remoteLayout) Runner() string   { return l.RunDir() + "/runner" }
func (l remoteLayout) Pid() string      { return l.RunDir() + "/pid" }
func (l remoteLayout) Inner() string    { return l.RunDir() + "/inner.sh" }
func (l remoteLayout) Script() string   { return l.RunDir() + "/run.sh" }
func (l remoteLayout) InfoPath() string { return l.RunDir() + "/info.json" }

// shq quotes s for a POSIX shell: one single-quoted word, whatever it holds.
func shq(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

var unsafeNameRe = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

// senderName names the checkout a run comes from — the machine and the checkout folder (warehouse_revamp,
// warehouse_revamp_e2e) — so the other PC's runs, lock and log say whose run each is.
func senderName(hostname, root string) string {
	h := unsafeNameRe.ReplaceAllString(hostname, "_")
	if h == "" {
		h = "host"
	}

	return h + "-" + unsafeNameRe.ReplaceAllString(filepath.Base(filepath.Clean(root)), "_")
}

// submodule is a gitlink in the commit's tree: its path and the commit it pins.
type submodule struct {
	Path string
	SHA  string
}

// Key is the file-safe name the other PC keeps its tar and stamp under.
func (s submodule) Key() string {
	return strings.Trim(unsafeNameRe.ReplaceAllString(s.Path, "_"), "_")
}

// TarName is the submodule tree's tar on the other PC — one per commit, so two senders' versions never overwrite.
func (s submodule) TarName() string {
	return s.Key() + "-" + s.SHA + ".tar"
}

// parseGitlinks reads `git ls-tree -r <commit>` and keeps the gitlinks (mode 160000).
func parseGitlinks(lsTree string) []submodule {
	var subs []submodule

	for _, line := range strings.Split(lsTree, "\n") {
		meta, p, ok := strings.Cut(strings.TrimRight(line, "\r"), "\t")
		if !ok {
			continue
		}

		f := strings.Fields(meta)
		if len(f) == 3 && f[0] == "160000" && f[1] == "commit" {
			subs = append(subs, submodule{Path: p, SHA: f[2]})
		}
	}

	return subs
}

// bundlePlan is what travels for one commit.
type bundlePlan struct {
	Needed  bool     // false: the other PC has the commit already — nothing travels
	Exclude []string // commits the other PC has and this checkout knows: the bundle leaves out their history
}

// planBundle decides the bundle: none when the other PC has the commit; else one that leaves out every commit the
// other PC holds (either sender's refs/san/commits/*) that this checkout also has — the first run sends the whole
// history, a later one only what changed.
func planBundle(commit string, remoteHasCommit bool, remoteCommits []string, localHas func(string) bool) bundlePlan {
	if remoteHasCommit {
		return bundlePlan{}
	}

	p := bundlePlan{Needed: true}
	seen := map[string]bool{}

	for _, c := range remoteCommits {
		c = strings.TrimSpace(c)
		if c == "" || c == commit || seen[c] || !localHas(c) {
			continue
		}

		seen[c] = true
		p.Exclude = append(p.Exclude, c)
	}

	return p
}

// sendRef is the one ref a bundle carries: named by its commit, so no sender's bundle names another's.
func sendRef(commit string) string {
	return "refs/san-send/" + commit
}

// keepRef is where the other PC keeps a commit it received.
func keepRef(commit string) string {
	return "refs/san/commits/" + commit
}

// bundleArgs is `git bundle create` for the plan, writing the bundle to stdout.
func bundleArgs(commit string, p bundlePlan) []string {
	args := []string{"bundle", "create", "-", sendRef(commit)}
	for _, c := range p.Exclude {
		args = append(args, "^"+c)
	}

	return args
}

// jobParams fills the job scripts.
type jobParams struct {
	L         remoteLayout
	SHA       string
	Kind      string   // smoke
	Args      []string // the san test arguments after the kind
	San       string   // the san binary's file name under bin/
	Subs      []submodule
	Headed    bool
	Display   string // ":0"
	PWVersion string // the commit's @playwright/test (package-lock.json) — the runner image's base
	GoVersion string // the commit's go.mod go line
	ImageTag  string
	Sender    string
	Cap       int // seconds the san step may take
}

// DisplayNum is the X display's number (":0" → "0").
func (p jobParams) DisplayNum() string {
	d := strings.TrimPrefix(p.Display, ":")
	d, _, _ = strings.Cut(d, ".")

	return d
}

// SanArgs is the san test command line inside the runner, each word quoted.
func (p jobParams) SanArgs() string {
	words := append([]string{"test", p.Kind}, p.Args...)
	for i, w := range words {
		words[i] = shq(w)
	}

	return strings.Join(words, " ")
}

var jobFuncs = template.FuncMap{"q": shq}

// jobScript is run.sh: the whole run on the other PC, started detached (setsid nohup) so a dropped SSH connection
// does not stop it; its output is run.log, its exit code the file exit (written last).
var jobScript = template.Must(template.New("run.sh").Funcs(jobFuncs).Parse(`#!/usr/bin/env bash
# One e2e run on this PC, written by ` + "`san test`" + ` on the sending machine (backlog #154, docs/tools/san.md#test-on-another-pc).
set -u
BASE={{q .L.Base}}
RUNDIR={{q .L.RunDir}}
REPO={{q .L.Repo}}
SHA={{q .SHA}}
CONTAINER={{q (printf "san-e2e-%s" .L.Run)}}
T0=$SECONDS
echo $$ > "$RUNDIR/pid"
say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
finish() {
  say "exit $1 after $((SECONDS - T0))s"
  echo "$1" > "$RUNDIR/exit.tmp" && mv "$RUNDIR/exit.tmp" "$RUNDIR/exit"
  exit "$1"
}
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1; say "✗ stopped by a signal"; finish 130' TERM INT HUP

say "→ run {{.L.Run}} — san test {{.Kind}} on commit ${SHA:0:12}, from {{.Sender}}"
if ! docker info >/dev/null 2>&1; then
  say "✗ $(id -un) cannot reach docker here: $(docker info 2>&1 | grep -i -m1 -E 'permission|denied|cannot|error')"
  say "  the owner's one-time step on this PC: sudo usermod -aG docker $(id -un)  (a new SSH login then has it)"
  finish {{.ExitDocker}}
fi

# 1. One run at a time on this PC. flock is the kernel's: it goes with its holder, so a dead run never blocks.
exec 9>"$BASE/run.lock"
if ! flock -n 9; then
  say "⏳ waiting: another e2e run holds this PC — $(cat "$BASE/run.lock.json" 2>/dev/null)"
  W=$SECONDS
  until flock -w 300 9; do say "⏳ still waiting ($(( (SECONDS - W) / 60 )) min) — $(cat "$BASE/run.lock.json" 2>/dev/null)"; done
  say "→ the other run ended after a $(( SECONDS - W ))s wait; this one starts"
fi
cp "$RUNDIR/info.json" "$BASE/run.lock.json"
for c in $(docker ps -aq --filter 'name=^san-e2e-' 2>/dev/null); do
  say "→ removing container $c, left by a run that is gone (this run holds the lock)"
  docker rm -f "$c" >/dev/null 2>&1
done

# 2. The commit, by its SHA — never a branch name.
cd "$REPO" || finish {{.ExitCommit}}
if ! git cat-file -e "$SHA^{commit}" 2>/dev/null; then
  B={{q .L.Bundle}}
  [ -s "$B" ] || { say "✗ the commit is not here and no bundle came"; finish {{.ExitCommit}}; }
  git bundle verify -q "$B" >/dev/null 2>"$RUNDIR/bundle.err" || { say "✗ bundle: $(cat "$RUNDIR/bundle.err")"; finish {{.ExitCommit}}; }
  git fetch -q --no-tags --no-write-fetch-head "$B" {{q (printf "%s:%s" .SendRef .KeepRef)}} || { say "✗ git fetch from the bundle failed"; finish {{.ExitCommit}}; }
  say "→ fetched the bundle ($(du -h "$B" | cut -f1))"
fi
rm -f {{q .L.Bundle}}
git update-ref {{q .KeepRef}} "$SHA" || finish {{.ExitCommit}}
[ "$(git rev-parse {{q (printf "%s^{commit}" .KeepRef)}})" = "$SHA" ] || { say "✗ {{.KeepRef}} is not the commit"; finish {{.ExitCommit}}; }
git checkout -q --force --detach "$SHA" || { say "✗ git checkout $SHA failed"; finish {{.ExitCommit}}; }
git clean -q -fd{{range .Subs}} -e {{q .Path}}{{end}} || true
[ "$(git rev-parse HEAD)" = "$SHA" ] || { say "✗ the checkout is not at $SHA"; finish {{.ExitCommit}}; }
{{range .Subs}}if [ "$(cat {{q (printf "%s/%s.sha" $.L.Subs .Key)}} 2>/dev/null)" != {{q .SHA}} ]; then
  rm -rf {{q .Path}} && mkdir -p {{q .Path}} && tar -xf {{q (printf "%s/%s" $.L.Subs .TarName)}} -C {{q .Path}} || { say "✗ submodule {{.Path}}"; finish {{$.ExitCommit}}; }
  echo {{q .SHA}} > {{q (printf "%s/%s.sha" $.L.Subs .Key)}}
  say "→ submodule {{.Path}} at {{printf "%.12s" .SHA}}"
fi
{{end}}say "→ checkout at $(git log -1 --format='%h %s' | cut -c1-100)"

# 3. The services the e2e uses — the commit's own docker-compose.yaml, its three services unchanged.
docker compose -p warehouse_revamp -f "$REPO/docker-compose.yaml" --profile pubsub up -d --wait postgres redis pubsub >"$RUNDIR/compose-up.log" 2>&1 \
  || { say "✗ docker compose up failed:"; tail -20 "$RUNDIR/compose-up.log"; finish 5; }
say "→ postgres, redis, pubsub up"

# 4. The runner image (the sender's docker/e2e-runner), built once per Dockerfile and versions.
export SAN_E2E_REPO="$REPO" SAN_E2E_CACHE={{q .L.Cache}} SAN_E2E_UID="$(id -u)" SAN_E2E_GID="$(id -g)"
export SAN_E2E_RUNNER_TAG={{q .ImageTag}} SAN_E2E_PLAYWRIGHT_VERSION={{q .PWVersion}} SAN_E2E_GO_VERSION={{q .GoVersion}}
mkdir -p "$SAN_E2E_CACHE/home"
RC=(docker compose -p san-e2e-runner -f {{q (printf "%s/docker-compose.yaml" .L.Runner)}} --profile e2e-remote)
if ! docker image inspect "warehouse-revamp-e2e-runner:$SAN_E2E_RUNNER_TAG" >/dev/null 2>&1; then
  say "→ building the runner image (playwright v{{.PWVersion}}, go {{.GoVersion}}) — the first time takes minutes"
  B0=$SECONDS
  timeout 3600 "${RC[@]}" build e2e-runner >"$RUNDIR/build.log" 2>&1 || { say "✗ image build failed:"; tail -30 "$RUNDIR/build.log"; finish 6; }
  say "→ image built in $((SECONDS - B0))s"
fi

# 5. The display: headless: false shows the browsers on this PC's own screen — the desktop's X display and its
#    cookie, mounted into the runner (no xhost change).
HEADED={{if .Headed}}1{{else}}0{{end}}
XMOUNT=()
if [ "$HEADED" = 1 ]; then
  XA=$(ls -t /run/user/"$(id -u)"/.mutter-Xwaylandauth.* 2>/dev/null | head -1)
  [ -z "$XA" ] && [ -f "$HOME/.Xauthority" ] && XA="$HOME/.Xauthority"
  if [ -n "$XA" ] && [ -S /tmp/.X11-unix/X{{.DisplayNum}} ] && { ! command -v xdpyinfo >/dev/null || DISPLAY={{q .Display}} XAUTHORITY="$XA" timeout 10 xdpyinfo >/dev/null 2>&1; }; then
    XMOUNT=(-v "$XA:/tmp/.san-xauth:ro" -e DISPLAY={{q .Display}} -e XAUTHORITY=/tmp/.san-xauth)
    say "→ headed: the browsers show on display {{.Display}}"
  else
    HEADED=0
    say "⚠ headless: no desktop session answers on display {{.Display}} (nobody logged in?) — the run goes on without a screen"
  fi
fi
echo "$HEADED" > "$RUNDIR/headed"

# 6. The run, in the runner — its report into this run's own folder.
mkdir -p "$RUNDIR/e2e_report"
rm -rf "$REPO/frontend/test-results"
say "→ san test {{.Kind}} in the runner"
R0=$SECONDS
timeout {{.Cap}} "${RC[@]}" run --rm --no-deps -T --name "$CONTAINER" \
  -v "$RUNDIR/e2e_report:/work/e2e_report" -v {{q .L.Bin}}:/san-bin:ro -v "$RUNDIR:/san-run:ro" "${XMOUNT[@]}" \
  -e {{.HeadedEnv}}="$HEADED" \
  e2e-runner bash /san-run/inner.sh
CODE=$?
docker rm -f "$CONTAINER" >/dev/null 2>&1
say "→ the runner ended (exit $CODE) after $((SECONDS - R0))s"

# 7. Traces and videos beside the report, as a local run leaves them.
for d in "$RUNDIR"/e2e_report/level2/*/; do
  [ -d "$d" ] || continue
  if [ -d "$REPO/frontend/test-results" ] && [ -n "$(ls -A "$REPO/frontend/test-results" 2>/dev/null)" ]; then
    cp -r "$REPO/frontend/test-results" "$d/test-results"
  fi
done
finish "$CODE"
`))

// innerScript is inner.sh, run inside the runner container: the commit's npm packages (only when its
// package-lock.json changed), a warm Go build cache (the e2e's web server is a `go run` with a 120 s start limit), then
// san test with the sender's san.
var innerScript = template.Must(template.New("inner.sh").Funcs(jobFuncs).Parse(`set -eu
say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
cd /work/frontend
want=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ "$(cat node_modules/.san-lock-sha256 2>/dev/null || true)" != "$want" ]; then
  say "→ npm ci (package-lock.json changed)"
  t=$SECONDS
  npm ci --no-audit --no-fund --loglevel=error
  echo "$want" > node_modules/.san-lock-sha256
  say "  npm ci took $((SECONDS - t))s"
fi
cd /work
say "→ go build (warms the cache the e2e's go run uses)"
t=$SECONDS
go build -o /dev/null ./backend/cmd/app_development
go build -o /dev/null ./tools/san
say "  took $((SECONDS - t))s"
exec /san-bin/{{.San}} {{.SanArgs}}
`))

// render fills one job template.
func render(t *template.Template, p jobParams) (string, error) {
	data := struct {
		jobParams
		SendRef, KeepRef, HeadedEnv string
		ExitDocker, ExitCommit      int
	}{p, sendRef(p.SHA), keepRef(p.SHA), headedEnv, remoteJobExitDocker, remoteJobExitCommit}

	var b bytes.Buffer

	err := t.Execute(&b, data)
	if err != nil {
		return "", err
	}

	return b.String(), nil
}

// runInfo is info.json: who runs what — shown to a run waiting for the lock.
type runInfo struct {
	Run     string `json:"run"`
	Sender  string `json:"sender"`
	Kind    string `json:"kind"`
	Commit  string `json:"commit"`
	Started string `json:"started"`
}

func (i runInfo) json() string {
	b, _ := json.Marshal(i)

	return string(b)
}

// imageTag names the runner image by what it is built from, so a changed Dockerfile or version builds anew.
func imageTag(dockerfile []byte, pw, goVersion string) string {
	h := sha256.Sum256(append(append(append([]byte{}, dockerfile...), pw...), goVersion...))

	return "pw" + pw + "-go" + goVersion + "-" + hex.EncodeToString(h[:])[:10]
}

var goLineRe = regexp.MustCompile(`(?m)^go\s+(\d+\.\d+(?:\.\d+)?)\s*$`)
var toolchainLineRe = regexp.MustCompile(`(?m)^toolchain\s+go(\d+\.\d+(?:\.\d+)?)\s*$`)

// goVersionOf is the Go a go.mod asks for: its toolchain line, else its go line.
func goVersionOf(gomod string) (string, error) {
	if m := toolchainLineRe.FindStringSubmatch(gomod); m != nil {
		return m[1], nil
	}

	m := goLineRe.FindStringSubmatch(gomod)
	if m == nil {
		return "", errors.New("go.mod has no go line")
	}

	v := m[1]
	if strings.Count(v, ".") == 1 {
		v += ".0"
	}

	return v, nil
}

// playwrightVersionOf is the @playwright/test a package-lock.json installs — the runner image must carry its browsers.
func playwrightVersionOf(lock []byte) (string, error) {
	var l struct {
		Packages map[string]struct {
			Version string `json:"version"`
		} `json:"packages"`
	}

	err := json.Unmarshal(lock, &l)
	if err != nil {
		return "", fmt.Errorf("package-lock.json: %w", err)
	}

	v := l.Packages["node_modules/@playwright/test"].Version
	if v == "" {
		return "", errors.New("package-lock.json installs no @playwright/test")
	}

	return v, nil
}

// extractTar unpacks a tar stream under dst and returns the top-level names it wrote. A name that would land
// outside dst (absolute, or climbing with ..) is refused — the stream comes from another machine.
func extractTar(r io.Reader, dst string) ([]string, error) {
	tr := tar.NewReader(r)
	top := map[string]bool{}

	var tops []string

	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return tops, nil
		}

		if err != nil {
			return tops, err
		}

		name := path.Clean(strings.TrimPrefix(h.Name, "./"))
		if name == "." {
			continue
		}

		if path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") || strings.Contains(name, ":") {
			return tops, fmt.Errorf("refusing %q in the report stream: it would land outside %s", h.Name, dst)
		}

		target := filepath.Join(dst, filepath.FromSlash(name))

		first, _, _ := strings.Cut(name, "/")
		if !top[first] {
			top[first] = true
			tops = append(tops, first)
		}

		switch h.Typeflag {
		case tar.TypeDir:
			err = os.MkdirAll(target, 0o755)
		case tar.TypeReg:
			err = writeTarFile(target, tr)
		default:
			// links, devices: a report has none worth keeping
			continue
		}

		if err != nil {
			return tops, err
		}
	}
}

func writeTarFile(target string, r io.Reader) error {
	err := os.MkdirAll(filepath.Dir(target), 0o755)
	if err != nil {
		return err
	}

	f, err := os.Create(target)
	if err != nil {
		return err
	}

	_, err = io.Copy(f, r)
	if err != nil {
		_ = f.Close()

		return err
	}

	return f.Close()
}

// tarFiles writes the named files (paths relative to root, forward slashes) as a tar — the runner's compose file and
// Dockerfile as the sender has them.
func tarFiles(w io.Writer, root string, files []string) error {
	tw := tar.NewWriter(w)

	for _, f := range files {
		b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(f)))
		if err != nil {
			return err
		}

		// The Windows checkout may hold CRLF; bash and compose on Linux want LF.
		b = bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))

		err = tw.WriteHeader(&tar.Header{Name: f, Mode: 0o644, Size: int64(len(b)), Typeflag: tar.TypeReg})
		if err != nil {
			return err
		}

		_, err = tw.Write(b)
		if err != nil {
			return err
		}
	}

	return tw.Close()
}
