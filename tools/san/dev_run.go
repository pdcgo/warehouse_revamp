package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/tools/san/proctree"
)

// devProc is one long-running child of `dev run`: the name its output is prefixed with, the
// directory it runs in, and its argv.
type devProc struct {
	name string
	dir  string
	argv []string
}

// devStack is what `dev run` starts, each in the directory a person would `cd` into to start it by
// hand. The API reads an optional config.yaml from its working directory, so that has to be
// backend/ — not the repo root san happens to be standing in.
func devStack(root string) []devProc {
	return []devProc{
		{name: "api", dir: filepath.Join(root, "backend"), argv: []string{"go", "run", "./cmd/app_development"}},
		{name: "ui", dir: filepath.Join(root, "frontend"), argv: []string{"npm", "run", "dev"}},
	}
}

// devRunCommand replaces the two terminals the dev stack used to need.
//
// It stops as ONE thing: Ctrl-C stops every server, and a server that exits on its own stops the
// rest. Half a stack is the confusing case — a UI on :5174 whose API died a minute ago shows every
// screen failing, and nothing on screen says the server is gone.
func devRunCommand() *cli.Command {
	return &cli.Command{
		Name: "run",
		Usage: "start postgres, redis and the Pub/Sub emulator, the API (:8080) and the UI (:5174) in one terminal — " +
			"Ctrl-C stops all of it",
		Flags: []cli.Flag{
			noDockerFlag(),
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			// A closed terminal is a Ctrl-C too. main stops on Interrupt and SIGTERM only, and on
			// Unix a hang-up would otherwise kill san and orphan the servers in their own groups.
			ctx, stop := signal.NotifyContext(ctx, syscall.SIGHUP)
			defer stop()

			root, err := repoRootOnce()
			if err != nil {
				return err
			}

			// Checked up front because the failure it prevents is unreadable: without node_modules,
			// npm reports "vite is not recognized" AFTER the API has started building.
			_, err = os.Stat(filepath.Join(root, "frontend", "node_modules"))
			if errors.Is(err, fs.ErrNotExist) {
				return errors.New(`frontend/node_modules is missing — run "cd frontend && npm install" first`)
			}

			if err != nil {
				return err
			}

			err = devDocker(ctx, root, os.Stdout, cmd.Bool("no-docker"))
			if err != nil {
				return err
			}

			return superviseDev(ctx, os.Stdout, devStack(root))
		},
	}
}

// devExit is one child having finished.
type devExit struct {
	name string
	err  error
}

// superviseDev runs every proc until the first one exits or ctx is cancelled, then stops ALL of them
// — each with its whole process tree, because `go run` and `npm run dev` are wrappers around the
// process that actually holds the port.
//
// It returns nil when ctx was cancelled (Ctrl-C: the person asked it to stop), and an error naming
// the proc when one exited by itself. A dev server never exits on its own, so even exit 0 is reported.
func superviseDev(ctx context.Context, out io.Writer, procs []devProc) error {
	parent := ctx

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	width := 0
	for _, p := range procs {
		width = max(width, len(p.name))
	}

	// One lock for every child's output, so a line from the API and a line from vite never
	// interleave mid-line.
	var mu sync.Mutex

	exited := make(chan devExit, len(procs))
	running := 0

	// waitAll drains whatever is still running. Every path out of here goes through it, so san
	// never returns while a child it started is alive.
	waitAll := func() {
		for ; running > 0; running-- {
			<-exited
		}
	}

	for _, p := range procs {
		w := &linePrefixer{out: out, mu: &mu, prefix: fmt.Sprintf("%-*s | ", width, p.name)}

		cmd := exec.CommandContext(ctx, p.argv[0], p.argv[1:]...)
		cmd.Dir = p.dir
		cmd.Stdout = w
		cmd.Stderr = w

		proctree.Configure(cmd)
		cmd.Cancel = func() error { return proctree.KillTree(cmd) }

		// A grandchild that outlives the kill must not hold its stdout pipe — and so Wait — forever.
		cmd.WaitDelay = 5 * time.Second

		// Under the lock: the procs started before this one are already writing.
		mu.Lock()
		fmt.Fprintf(out, "→ %-*s  %s   (in %s)\n", width, p.name, strings.Join(p.argv, " "), filepath.Base(p.dir))
		mu.Unlock()

		err := cmd.Start()
		if err != nil {
			cancel()
			waitAll()

			return fmt.Errorf("start %s: %w", p.name, err)
		}

		running++

		go func() {
			err := cmd.Wait()

			// After Wait the copier is done, so this cannot race a Write. It keeps a last line
			// that had no newline — often the one saying why the process died.
			_ = w.Flush()

			exited <- devExit{name: p.name, err: err}
		}()
	}

	var first *devExit

	select {
	case <-ctx.Done():
	case e := <-exited:
		running--
		first = &e
	}

	cancel()
	waitAll()

	// A child can lose the race with Ctrl-C; the person asked to stop either way.
	if first == nil || parent.Err() != nil {
		fmt.Fprintln(out, "✓ stopped")

		return nil
	}

	if first.err != nil {
		return fmt.Errorf("%s exited (%w) — stopped the rest", first.name, first.err)
	}

	return fmt.Errorf("%s exited — stopped the rest", first.name)
}

// linePrefixer writes each COMPLETE line of a child's output as one Write, prefixed with the child's
// name, under a lock shared by every child.
//
// It is not safe for concurrent Writes on its own — it relies on exec.Cmd, which calls Write from one
// goroutine at a time when Stdout and Stderr are the same writer.
type linePrefixer struct {
	out    io.Writer
	mu     *sync.Mutex
	prefix string
	buf    []byte
}

func (w *linePrefixer) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	start := 0

	for {
		i := bytes.IndexByte(w.buf[start:], '\n')
		if i < 0 {
			break
		}

		err := w.emit(w.buf[start : start+i+1])
		if err != nil {
			return 0, err
		}

		start += i + 1
	}

	// Keep only the unfinished tail, moved to the front so the buffer does not creep forward.
	w.buf = w.buf[:copy(w.buf, w.buf[start:])]

	return len(p), nil
}

// Flush writes a trailing line that never got its newline.
func (w *linePrefixer) Flush() error {
	if len(w.buf) == 0 {
		return nil
	}

	line := append(w.buf, '\n')
	w.buf = nil

	return w.emit(line)
}

func (w *linePrefixer) emit(line []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	_, err := w.out.Write(append([]byte(w.prefix), line...))

	return err
}
