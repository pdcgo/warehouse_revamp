package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// `san test smoke` on ANOTHER PC (backlog #154, docs/technical/development/workflow_decision.md
// #e2e-runs-locally-or-on-another-pc, docs/tools/san.md#test-on-another-pc). With development.yaml's e2e_test.type ssh the whole
// run — its server, its database, its browsers — happens on that PC, inside Docker Compose, so it takes none of this
// machine's CPU:
//
//  1. the COMMIT (default HEAD — never the uncommitted working tree) travels as a git bundle over the SSH connection
//     (only what the other PC lacks), the submodules' trees as tars, this checkout's san built for Linux, and the
//     runner's compose file and Dockerfile;
//  2. a job script starts there DETACHED (a dropped connection does not stop it) and does the rest behind a lock —
//     one run at a time on that PC (test_remote_job.go);
//  3. this side streams its log, and copies its report back into e2e_report/level2/<stamp>-<kind>/ — the same folder
//     a local run writes — with remote.json (where, which commit, how long) and the job's log in
//     e2e_report/remote/<run id>/.
//
// SSH logs in with the file's password (owner: "password is okay, i gitignored it"); the password goes only into the
// SSH handshake — never onto a command line, into a log or another file. The other PC's host key must match
// ~/.ssh/known_hosts or .san/known_hosts; an unknown host is trusted once and written to .san/known_hosts, a CHANGED
// key is refused.

// remoteRequest is one run to send.
type remoteRequest struct {
	Kind   string   // smoke
	Args   []string // san test arguments after the kind (--isolated)
	Commit string   // a git revision; "" is HEAD
}

// remoteRunFiles are the sender's files the job runs the runner from.
var remoteRunFiles = []string{"docker-compose.yaml", "docker/e2e-runner/Dockerfile"}

// remoteRecord is remote.json beside a report that came back.
type remoteRecord struct {
	Run       string    `json:"run"`
	Where     string    `json:"where"`
	Sender    string    `json:"sender"`
	Commit    string    `json:"commit"`
	Kind      string    `json:"kind"`
	Args      []string  `json:"args,omitempty"`
	RemoteDir string    `json:"remote_dir"`
	Headed    bool      `json:"headed"`
	Started   time.Time `json:"started"`
	Finished  time.Time `json:"finished"`
	Secs      int       `json:"secs"`
	Exit      int       `json:"exit"`
	Reports   []string  `json:"reports,omitempty"`
}

// sshRemote is one SSH connection to the other PC, redialled when it drops.
type sshRemote struct {
	addr string
	conf *ssh.ClientConfig
	c    *ssh.Client
}

// dialRemote opens the connection: password auth, host key checked.
func dialRemote(root string, p e2eSSHPlace, out io.Writer) (*sshRemote, error) {
	cb, err := hostKeyCallback(root, p.Addr(), out)
	if err != nil {
		return nil, err
	}

	r := &sshRemote{addr: p.Addr(), conf: &ssh.ClientConfig{
		User:            p.User,
		Auth:            []ssh.AuthMethod{ssh.Password(p.Password)},
		HostKeyCallback: cb,
		Timeout:         15 * time.Second,
	}}

	err = r.dial()
	if err != nil {
		return nil, err
	}

	return r, nil
}

func (r *sshRemote) dial() error {
	c, err := ssh.Dial("tcp", r.addr, r.conf)
	if err != nil {
		return fmt.Errorf("ssh %s@%s: %w", r.conf.User, r.addr, err)
	}

	r.c = c

	return nil
}

func (r *sshRemote) close() {
	if r.c != nil {
		_ = r.c.Close()
	}
}

// run runs one shell command there with stdin and stdout as given; stderr comes back in the error.
func (r *sshRemote) run(cmd string, stdin io.Reader, stdout io.Writer) error {
	s, err := r.c.NewSession()
	if err != nil {
		return err
	}

	defer func() { _ = s.Close() }()

	var stderr bytes.Buffer

	s.Stdin = stdin
	s.Stdout = stdout
	s.Stderr = &stderr

	err = s.Run(cmd)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return fmt.Errorf("%w: %s", err, clip(msg, 600))
		}

		return err
	}

	return nil
}

// output runs one command and returns its stdout.
func (r *sshRemote) output(cmd string) (string, error) {
	var b bytes.Buffer

	err := r.run(cmd, nil, &b)

	return b.String(), err
}

// upload writes stdin to path there, atomically (a .tmp renamed), and optionally makes it executable.
func (r *sshRemote) upload(path string, data io.Reader, executable bool) error {
	cmd := fmt.Sprintf("mkdir -p %s && cat > %s && ", shq(dirOf(path)), shq(path+".tmp"))
	if executable {
		cmd += fmt.Sprintf("chmod +x %s && ", shq(path+".tmp"))
	}

	cmd += fmt.Sprintf("mv %s %s", shq(path+".tmp"), shq(path))

	return r.run(cmd, data, io.Discard)
}

func dirOf(p string) string {
	i := strings.LastIndex(p, "/")
	if i <= 0 {
		return "."
	}

	return p[:i]
}

// hostKeyCallback checks the other PC's key against ~/.ssh/known_hosts and .san/known_hosts. An unknown host is
// trusted on first use and written to .san/known_hosts; a key that CHANGED is refused.
func hostKeyCallback(root, addr string, out io.Writer) (ssh.HostKeyCallback, error) {
	own := filepath.Join(root, ".san", "known_hosts")

	var files []string

	home, err := os.UserHomeDir()
	if err == nil {
		files = append(files, filepath.Join(home, ".ssh", "known_hosts"))
	}

	files = append(files, own)

	var existing []string

	for _, f := range files {
		_, err = os.Stat(f)
		if err == nil {
			existing = append(existing, f)
		}
	}

	if len(existing) == 0 {
		err = os.MkdirAll(filepath.Dir(own), 0o755)
		if err != nil {
			return nil, err
		}

		err = os.WriteFile(own, nil, 0o600)
		if err != nil {
			return nil, err
		}

		existing = []string{own}
	}

	known, err := knownhosts.New(existing...)
	if err != nil {
		return nil, err
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := known(hostname, remote, key)
		if err == nil {
			return nil
		}

		var ke *knownhosts.KeyError
		if !errors.As(err, &ke) {
			return err
		}

		if len(ke.Want) > 0 {
			return fmt.Errorf("the host key of %s CHANGED (now %s %s) — refusing; if the PC was reinstalled, remove "+
				"its old line from %s", addr, key.Type(), ssh.FingerprintSHA256(key), ke.Want[0].Filename)
		}

		line := knownhosts.Line([]string{knownhosts.Normalize(addr)}, key)

		err = appendLine(own, line)
		if err != nil {
			return err
		}

		fmt.Fprintf(out, "→ first contact with %s: trusting its key %s %s (kept in .san/known_hosts)\n", addr,
			key.Type(), ssh.FingerprintSHA256(key))

		return nil
	}, nil
}

func appendLine(path, line string) error {
	err := os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}

	_, err = fmt.Fprintln(f, line)
	if err != nil {
		_ = f.Close()

		return err
	}

	return f.Close()
}

// gitText runs git in root and returns its trimmed stdout.
func gitText(root string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)

	var stderr bytes.Buffer

	cmd.Stderr = &stderr

	b, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, clip(strings.TrimSpace(stderr.String()), 300))
	}

	return strings.TrimSpace(string(b)), nil
}

// localCommits says which of the commits this checkout has (git cat-file --batch-check).
func localCommits(root string, shas []string) (map[string]bool, error) {
	has := map[string]bool{}
	if len(shas) == 0 {
		return has, nil
	}

	cmd := exec.Command("git", "-C", root, "cat-file", "--batch-check")
	cmd.Stdin = strings.NewReader(strings.Join(shas, "\n") + "\n")

	b, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[1] == "commit" {
			has[f[0]] = true
		}
	}

	return has, nil
}

// buildLinuxSan builds THIS checkout's san for the runner (linux/amd64, no cgo) and returns its bytes' path and name.
func buildLinuxSan(ctx context.Context, root string) (string, string, error) {
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("san-linux-%d", os.Getpid()))

	cmd := exec.CommandContext(ctx, "go", "build", "-trimpath", "-ldflags=-s -w", "-o", tmp, "./tools/san")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH=amd64", "CGO_ENABLED=0")

	b, err := cmd.CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("building san for the runner (linux/amd64): %w\n%s", err, clip(string(b), 1500))
	}

	f, err := os.Open(tmp)
	if err != nil {
		return "", "", err
	}

	defer func() { _ = f.Close() }()

	h := sha256.New()

	_, err = io.Copy(h, f)
	if err != nil {
		return "", "", err
	}

	return tmp, "san-" + hex.EncodeToString(h.Sum(nil))[:16], nil
}

// remoteRunCap is how long the san step may take there: the kind's own cap, plus the template's.
func remoteRunCap(kind string) time.Duration {
	switch kind {
	case "smoke":
		return smokeCap + templateCost + 20*time.Minute // + a cold npm ci and Go build on the first run
	case "affected":
		return 3 * time.Hour
	default:
		return 24 * time.Hour
	}
}

// affectedRemoteArgs is `affected --run` for the other PC: the files measured HERE, as --files (the other PC has no
// last_green.json of this checkout). No changed file is "--files ," — an empty list, which still runs the smoke set.
func affectedRemoteArgs(changed []string, isolated bool) []string {
	files := strings.Join(changed, ",")
	if files == "" {
		files = ","
	}

	args := []string{"--run", "--files", files}
	if isolated {
		args = append(args, "--isolated")
	}

	return args
}

// runRemote sends one san test run to the other PC, waits for it, and brings its report back.
func runRemote(ctx context.Context, root string, cfg devConfig, req remoteRequest, out io.Writer) error {
	rev := req.Commit
	if rev == "" {
		rev = "HEAD"
	}

	sha, err := gitText(root, "rev-parse", "--verify", rev+"^{commit}")
	if err != nil {
		return err
	}

	subject, _ := gitText(root, "log", "-1", "--format=%h %s", sha)
	fmt.Fprintf(out, "→ %s on %s (development.yaml e2e_test.type: ssh) — commit %s\n", "san test "+req.Kind,
		cfg.Where(), clip(subject, 100))

	dirty, _ := gitText(root, "status", "--porcelain", "--untracked-files=no")
	if dirty != "" {
		fmt.Fprintf(out, "  ⚠ %d tracked files here differ from that commit — the other PC tests the COMMIT, not them\n",
			len(strings.Split(dirty, "\n")))
	}

	gomod, err := gitText(root, "show", sha+":go.mod")
	if err != nil {
		return err
	}

	goVersion, err := goVersionOf(gomod)
	if err != nil {
		return err
	}

	lock, err := gitText(root, "show", sha+":frontend/package-lock.json")
	if err != nil {
		return err
	}

	pw, err := playwrightVersionOf([]byte(lock))
	if err != nil {
		return err
	}

	tree, err := gitText(root, "ls-tree", "-r", sha)
	if err != nil {
		return err
	}

	subs := parseGitlinks(tree)

	dockerfile, err := os.ReadFile(filepath.Join(root, "docker", "e2e-runner", "Dockerfile"))
	if err != nil {
		return fmt.Errorf("the runner's Dockerfile: %w", err)
	}

	fmt.Fprintf(out, "→ building this checkout's san for the runner (linux/amd64)\n")

	sanPath, sanName, err := buildLinuxSan(ctx, root)
	if err != nil {
		return err
	}

	defer func() { _ = os.Remove(sanPath) }()

	r, err := dialRemote(root, cfg.E2E.SSH, out)
	if err != nil {
		return err
	}

	defer r.close()

	home, err := r.output(`printf %s "$HOME"`)
	if err != nil {
		return err
	}

	base := cfg.E2E.SSH.Dir
	switch {
	case base == "":
		base = home + "/" + remoteDirDefault
	case !strings.HasPrefix(base, "/"):
		base = home + "/" + strings.TrimPrefix(base, "~/")
	}

	hostname, _ := os.Hostname()
	sender := senderName(hostname, root)
	started := time.Now()
	L := remoteLayout{Base: base, Run: stamp(started) + "-" + req.Kind + "-" + sender}

	fmt.Fprintf(out, "→ run %s in %s:%s\n", L.Run, cfg.E2E.SSH.Host, L.RunDir())

	// The folders, the checkout (made once), and what the other PC holds of the commit.
	probe := fmt.Sprintf("set -e; mkdir -p %s %s %s %s %s %s; [ -d %s/.git ] || git init -q %s; cd %s; "+
		"if git cat-file -e %s 2>/dev/null; then echo HAVE; else echo MISSING; fi; "+
		"git for-each-ref --sort=-committerdate --count=50 --format='%%(objectname)' refs/san/commits",
		shq(L.Repo()), shq(L.Runner()), shq(dirOf(L.Bundle())), shq(L.Subs()), shq(L.Bin()), shq(L.Cache()),
		shq(L.Repo()), shq(L.Repo()), shq(L.Repo()), shq(sha+"^{commit}"))

	held, err := r.output(probe)
	if err != nil {
		return fmt.Errorf("preparing %s there: %w", base, err)
	}

	lines := strings.Split(strings.TrimSpace(held), "\n")
	remoteHas := len(lines) > 0 && lines[0] == "HAVE"

	var remoteCommits []string
	if len(lines) > 1 {
		remoteCommits = lines[1:]
	}

	known, err := localCommits(root, remoteCommits)
	if err != nil {
		return err
	}

	plan := planBundle(sha, remoteHas, remoteCommits, func(c string) bool { return known[c] })

	err = sendBundle(ctx, root, r, L, sha, plan, out)
	if err != nil {
		return err
	}

	err = sendSubmodules(root, r, L, subs, out)
	if err != nil {
		return err
	}

	err = sendSan(r, L, sanPath, sanName, out)
	if err != nil {
		return err
	}

	var runner bytes.Buffer

	err = tarFiles(&runner, root, remoteRunFiles)
	if err != nil {
		return err
	}

	err = r.run(fmt.Sprintf("mkdir -p %s && tar -xf - -C %s", shq(L.Runner()), shq(L.Runner())), &runner, io.Discard)
	if err != nil {
		return fmt.Errorf("sending the runner's compose file: %w", err)
	}

	p := jobParams{
		L: L, SHA: sha, Kind: req.Kind, Args: req.Args, San: sanName, Subs: subs, Headed: !cfg.Headless(),
		Display: cfg.E2E.SSH.Display, PWVersion: pw, GoVersion: goVersion,
		ImageTag: imageTag(dockerfile, pw, goVersion), Sender: sender, Cap: int(remoteRunCap(req.Kind).Seconds()),
	}

	if p.Display == "" {
		p.Display = ":0"
	}

	err = sendJob(r, L, p, runInfo{Run: L.Run, Sender: sender, Kind: req.Kind, Commit: sha,
		Started: started.Format(time.RFC3339)})
	if err != nil {
		return err
	}

	// setsid -f returns at once: the job is in a session of its own, holds none of this connection's streams (else the
	// SSH session stays open until the job ends), and writes its own pid — its process group — to the pid file.
	_, err = r.output(fmt.Sprintf("cd %s || exit 1; setsid -f nohup bash %s > %s 2>&1 < /dev/null",
		shq(base), shq(L.Script()), shq(L.Log())))
	if err != nil {
		return fmt.Errorf("starting the run there: %w", err)
	}

	local := filepath.Join(reportDir(root), "remote", L.Run)

	err = os.MkdirAll(local, 0o755)
	if err != nil {
		return err
	}

	code, err := followRemote(ctx, r, L, filepath.Join(local, "run.log"), out)
	if err != nil {
		return err
	}

	rec := remoteRecord{Run: L.Run, Where: cfg.Where(), Sender: sender, Commit: sha, Kind: req.Kind, Args: req.Args,
		RemoteDir: L.RunDir(), Started: started, Finished: time.Now(), Exit: code}
	rec.Secs = int(rec.Finished.Sub(started).Seconds())

	headed, _ := r.output("cat " + shq(L.RunDir()+"/headed") + " 2>/dev/null || true")
	rec.Headed = strings.TrimSpace(headed) == "1"

	rec.Reports, err = copyBack(r, L, root)
	if err != nil {
		fmt.Fprintf(out, "⚠ copying the report back: %v\n", err)
	}

	err = writeRemoteRecords(root, local, rec)
	if err != nil {
		return err
	}

	return remoteVerdict(root, rec, out)
}

// sendBundle sends the commit as a bundle, or nothing when the other PC has it.
func sendBundle(ctx context.Context, root string, r *sshRemote, L remoteLayout, sha string, plan bundlePlan,
	out io.Writer) error {
	if !plan.Needed {
		fmt.Fprintf(out, "→ the other PC has commit %.12s already — no bundle\n", sha)

		return nil
	}

	_, err := gitText(root, "update-ref", sendRef(sha), sha)
	if err != nil {
		return err
	}

	defer func() { _, _ = gitText(root, "update-ref", "-d", sendRef(sha)) }()

	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root}, bundleArgs(sha, plan)...)...)

	var stderr bytes.Buffer

	cmd.Stderr = &stderr

	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}

	err = cmd.Start()
	if err != nil {
		return err
	}

	counted := &countingReader{r: pipe}
	upErr := r.upload(L.Bundle(), counted, false)
	waitErr := cmd.Wait()

	if waitErr != nil {
		return fmt.Errorf("git bundle create: %w: %s", waitErr, clip(stderr.String(), 400))
	}

	if upErr != nil {
		return fmt.Errorf("sending the bundle: %w", upErr)
	}

	what := "the whole history (first run)"
	if len(plan.Exclude) > 0 {
		what = fmt.Sprintf("only what %d commits it holds lack", len(plan.Exclude))
	}

	fmt.Fprintf(out, "→ sent commit %.12s as a bundle, %s: %.1f MB\n", sha, what, float64(counted.n)/1e6)

	return nil
}

// countingReader counts what passes.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)

	return n, err
}

// sendSubmodules sends each gitlink's tree the other PC lacks (git archive of the commit it pins).
func sendSubmodules(root string, r *sshRemote, L remoteLayout, subs []submodule, out io.Writer) error {
	if len(subs) == 0 {
		return nil
	}

	var check []string
	for _, s := range subs {
		check = append(check, fmt.Sprintf("[ -s %s ] && echo %s", shq(L.Subs()+"/"+s.TarName()), shq(s.TarName())))
	}

	have, err := r.output(strings.Join(check, "; ") + "; true")
	if err != nil {
		return err
	}

	for _, s := range subs {
		if strings.Contains(have, s.TarName()) {
			continue
		}

		subRoot := filepath.Join(root, filepath.FromSlash(s.Path))

		cmd := exec.Command("git", "-C", subRoot, "archive", "--format=tar", s.SHA)

		var stderr bytes.Buffer

		cmd.Stderr = &stderr

		b, err := cmd.Output()
		if err != nil {
			return fmt.Errorf("submodule %s at %.12s: %w: %s (git submodule update --init?)", s.Path, s.SHA, err,
				clip(stderr.String(), 300))
		}

		err = r.upload(L.Subs()+"/"+s.TarName(), bytes.NewReader(b), false)
		if err != nil {
			return err
		}

		fmt.Fprintf(out, "→ sent submodule %s at %.12s (%.1f MB)\n", s.Path, s.SHA, float64(len(b))/1e6)
	}

	return nil
}

// sendSan sends this checkout's Linux san unless the other PC has that very build.
func sendSan(r *sshRemote, L remoteLayout, path, name string, out io.Writer) error {
	have, err := r.output(fmt.Sprintf("[ -x %s ] && echo yes || true", shq(L.Bin()+"/"+name)))
	if err != nil {
		return err
	}

	if strings.TrimSpace(have) == "yes" {
		return nil
	}

	f, err := os.Open(path)
	if err != nil {
		return err
	}

	defer func() { _ = f.Close() }()

	err = r.upload(L.Bin()+"/"+name, f, true)
	if err != nil {
		return fmt.Errorf("sending san: %w", err)
	}

	fmt.Fprintf(out, "→ sent this checkout's san (%s)\n", name)

	return nil
}

// sendJob writes run.sh, inner.sh and info.json into the run's folder.
func sendJob(r *sshRemote, L remoteLayout, p jobParams, info runInfo) error {
	job, err := render(jobScript, p)
	if err != nil {
		return err
	}

	inner, err := render(innerScript, p)
	if err != nil {
		return err
	}

	for _, f := range []struct{ path, text string }{
		{L.Script(), job}, {L.Inner(), inner}, {L.InfoPath(), info.json() + "\n"},
	} {
		err = r.upload(f.path, strings.NewReader(f.text), false)
		if err != nil {
			return fmt.Errorf("sending %s: %w", f.path, err)
		}
	}

	return nil
}

// followRemote streams the job's log until its exit file appears, and returns its exit code. A dropped connection
// is redialled (the job goes on there); an interrupt here stops the job there.
func followRemote(ctx context.Context, r *sshRemote, L remoteLayout, logPath string, out io.Writer) (int, error) {
	logFile, err := os.Create(logPath)
	if err != nil {
		return 0, err
	}

	defer func() { _ = logFile.Close() }()

	w := io.MultiWriter(logFile, out)
	offset := 0
	failures := 0

	for {
		if ctx.Err() != nil {
			// The job is its own session leader (setsid): its pid is its process group — the job and everything it
			// started. Its trap removes the runner container and writes the exit file.
			_ = r.run(fmt.Sprintf(`P=$(cat %s 2>/dev/null) && [ -n "$P" ] && kill -TERM -- "-$P" 2>/dev/null; true`,
				shq(L.Pid())), nil, io.Discard)

			return 0, fmt.Errorf("interrupted — the run on the other PC was told to stop (%s)", L.RunDir())
		}

		poll := fmt.Sprintf(`printf '%%s\n' "$(cat %s 2>/dev/null || echo -)"; tail -c +%d %s 2>/dev/null; true`,
			shq(L.Exit()), offset+1, shq(L.Log()))

		var b bytes.Buffer

		err = r.run(poll, nil, &b)
		if err != nil {
			failures++
			if failures > 10 {
				return 0, fmt.Errorf("lost the connection to the other PC (%v); the run goes on there: %s", err, L.Log())
			}

			fmt.Fprintf(out, "⚠ connection: %v — reconnecting (%d/10)\n", err, failures)
			time.Sleep(5 * time.Second)
			r.close()
			_ = r.dial()

			continue
		}

		failures = 0
		status, rest, _ := strings.Cut(b.String(), "\n")

		if rest != "" {
			_, _ = io.WriteString(w, rest)
			offset += len(rest)
		}

		status = strings.TrimSpace(status)
		if status != "-" && status != "" {
			code, err := strconv.Atoi(status)
			if err != nil {
				return 0, fmt.Errorf("the run's exit file reads %q", status)
			}

			return code, nil
		}

		select {
		case <-ctx.Done():
		case <-time.After(2 * time.Second):
		}
	}
}

// copyBack brings the run's level2 reports into this checkout's e2e_report/level2/ and returns their names.
func copyBack(r *sshRemote, L remoteLayout, root string) ([]string, error) {
	names, err := r.output(fmt.Sprintf("ls -1 %s 2>/dev/null; true", shq(L.Report()+"/level2")))
	if err != nil {
		return nil, err
	}

	var reports []string

	for _, n := range strings.Split(strings.TrimSpace(names), "\n") {
		n = strings.TrimSpace(n)
		if n != "" {
			reports = append(reports, n)
		}
	}

	if len(reports) == 0 {
		return nil, nil
	}

	pr, pw := io.Pipe()
	done := make(chan error, 1)

	go func() {
		_, err := extractTar(pr, reportDir(root))
		// tar pads its stream past the end-of-archive marker: read the padding too, or the sending side's last
		// writes meet a closed pipe and the copy reads as failed.
		_, _ = io.Copy(io.Discard, pr)
		_ = pr.CloseWithError(err)
		done <- err
	}()

	err = r.run(fmt.Sprintf("tar -C %s -cf - level2", shq(L.Report())), nil, pw)
	_ = pw.CloseWithError(err)

	exErr := <-done
	if err != nil {
		return reports, err
	}

	return reports, exErr
}

// writeRemoteRecords writes remote.json into e2e_report/remote/<run>/ and beside each report that came back.
func writeRemoteRecords(root, local string, rec remoteRecord) error {
	err := writeJSON(filepath.Join(local, "remote.json"), rec)
	if err != nil {
		return err
	}

	for _, rep := range rec.Reports {
		dir := filepath.Join(reportDir(root), "level2", rep)

		err = writeJSON(filepath.Join(dir, "remote.json"), rec)
		if err != nil {
			return err
		}

		err = copyFile(filepath.Join(local, "run.log"), filepath.Join(dir, "remote-run.log"))
		if err != nil {
			return err
		}
	}

	return nil
}

// remoteVerdict prints each returned report's verdict line; a red run, or a job that stopped before san could
// report, is an error (exit 1), as a local run's is.
func remoteVerdict(root string, rec remoteRecord, out io.Writer) error {
	where := fmt.Sprintf("on %s in %s", rec.Where, (time.Duration(rec.Secs) * time.Second).String())

	if len(rec.Reports) == 0 {
		return fmt.Errorf("the run on the other PC stopped before san reported (exit %d, %s) — its log: "+
			"e2e_report/remote/%s/run.log", rec.Exit, where, rec.Run)
	}

	green := rec.Exit == 0

	for _, rep := range rec.Reports {
		var run RunRecord

		b, err := os.ReadFile(filepath.Join(reportDir(root), "level2", rep, "run.json"))
		if err == nil {
			err = json.Unmarshal(b, &run)
		}

		if err != nil {
			green = false

			fmt.Fprintf(out, "\n%s: no run.json (%v)\n", rep, err)

			continue
		}

		fmt.Fprintf(out, "\n%s (%s)\n", runLine(&run), where)

		for _, bt := range run.E2E.Batches {
			for _, f := range bt.Failures {
				fmt.Fprintf(out, "  ✗ %s\n", f)
			}
		}

		if !run.Green {
			green = false
		}

		fmt.Fprintf(out, "report: e2e_report/level2/%s/summary.md\n", rep)
	}

	if !green {
		return fmt.Errorf("%s run on the other PC is not green — e2e_report/level2/%s/summary.md", rec.Kind,
			rec.Reports[len(rec.Reports)-1])
	}

	return nil
}

// remoteHere decides a run's place: the other PC when development.yaml says ssh — except inside the runner itself.
func remoteHere(root string) (devConfig, bool, error) {
	cfg, err := readDevConfig(root)
	if err != nil {
		return cfg, false, err
	}

	return cfg, cfg.Remote() && os.Getenv(inRunnerEnv) == "", nil
}

// refuseRemoteNotBuilt stops a command that does not run on the other PC yet when development.yaml says ssh —
// rather than running it on this machine against the file.
func refuseRemoteNotBuilt(root, what string) error {
	_, remote, err := remoteHere(root)
	if err != nil {
		return err
	}

	if remote {
		return fmt.Errorf("development.yaml says e2e_test.type: ssh, but `san test %s` does not run on the other PC "+
			"yet (backlog #154 phase 2: smoke and affected --run do) — set type: local in development.yaml to run it here",
			what)
	}

	return nil
}

// applyLocalHeadless makes a run on THIS machine headed when development.yaml says headless: false.
func applyLocalHeadless(cfg devConfig) {
	if !cfg.Remote() && !cfg.Headless() {
		_ = os.Setenv(headedEnv, "1")
	}
}
