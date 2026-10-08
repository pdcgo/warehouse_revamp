package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// The children here are THIS TEST BINARY, re-run as TestDevHelperProcess — so the tests need no go,
// npm or docker, and a kill that misses a process shows up as a test that never returns, on Windows
// and Unix alike.

// TestDevHelperProcess is not a test: it is the child process the tests below start. Run by
// `go test` with no arguments after `--`, it skips.
func TestDevHelperProcess(t *testing.T) {
	args := flag.Args()
	if len(args) == 0 {
		t.Skip("a child process for the dev run tests, not a test")
	}

	switch args[0] {
	case "sleep":
		// One write: once "ready" is visible, the unterminated "partial" is already in the pipe.
		fmt.Print("ready\npartial")
		time.Sleep(2 * time.Minute)
		os.Exit(0)
	case "fail":
		fmt.Println("boom")
		os.Exit(3)
	}

	os.Exit(2)
}

func helperProc(name, mode string) devProc {
	return devProc{name: name, argv: []string{os.Args[0], "-test.run=^TestDevHelperProcess$", "--", mode}}
}

// syncBuffer is the terminal: superviseDev writes to it from several goroutines, the test reads it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.buf.String()
}

// returned waits for superviseDev, well short of the sleeper's two minutes — so a child that was
// not killed fails the test instead of passing slowly.
func returned(t *testing.T, done <-chan error) error {
	t.Helper()

	select {
	case err := <-done:
		return err
	case <-time.After(30 * time.Second):
		t.Fatal("superviseDev did not return: a child it should have stopped is still running")

		return nil
	}
}

// The half-a-stack case: the API dies, so the UI must not keep serving screens that all fail.
func TestDevRunStopsTheRestWhenOneExits(t *testing.T) {
	out := &syncBuffer{}
	done := make(chan error, 1)

	go func() {
		done <- superviseDev(context.Background(), out, []devProc{
			helperProc("api", "sleep"),
			helperProc("ui", "fail"),
		})
	}()

	err := returned(t, done)
	if err == nil || !strings.Contains(err.Error(), "ui exited") {
		t.Fatalf("want an error naming ui, got %v", err)
	}

	if !strings.Contains(out.String(), "ui  | boom\n") {
		t.Fatalf("the failing child's output was not passed through, prefixed:\n%s", out.String())
	}
}

// Ctrl-C: everything stops, it is not an error, and a last line with no newline is not lost.
func TestDevRunStopsEverythingWhenCancelled(t *testing.T) {
	out := &syncBuffer{}
	done := make(chan error, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		done <- superviseDev(ctx, out, []devProc{
			helperProc("api", "sleep"),
			helperProc("ui", "sleep"),
		})
	}()

	deadline := time.Now().Add(30 * time.Second)
	for !strings.Contains(out.String(), "api | ready\n") || !strings.Contains(out.String(), "ui  | ready\n") {
		if time.Now().After(deadline) {
			t.Fatalf("the children never started:\n%s", out.String())
		}

		time.Sleep(20 * time.Millisecond)
	}

	cancel()

	err := returned(t, done)
	if err != nil {
		t.Fatalf("a cancelled run is a normal stop, got %v", err)
	}

	if !strings.Contains(out.String(), "api | partial\n") {
		t.Fatalf("the unterminated last line was dropped:\n%s", out.String())
	}
}

// A proc that cannot start must not leave the ones before it running.
func TestDevRunStopsTheStartedOnesWhenOneCannotStart(t *testing.T) {
	out := &syncBuffer{}
	done := make(chan error, 1)

	go func() {
		done <- superviseDev(context.Background(), out, []devProc{
			helperProc("api", "sleep"),
			{name: "ui", argv: []string{"san-dev-run-test-no-such-command"}},
		})
	}()

	err := returned(t, done)
	if err == nil || !strings.Contains(err.Error(), "start ui") {
		t.Fatalf("want a start error naming ui, got %v", err)
	}
}

// Lines are only ever written whole, so two children cannot interleave inside one.
func TestLinePrefixerWritesWholeLines(t *testing.T) {
	var out bytes.Buffer

	w := &linePrefixer{out: &out, mu: &sync.Mutex{}, prefix: "api | "}

	_, _ = w.Write([]byte("one\ntw"))
	_, _ = w.Write([]byte("o"))

	if out.String() != "api | one\n" {
		t.Fatalf("an unfinished line was written early: %q", out.String())
	}

	_, _ = w.Write([]byte("\nthree\r\nfour"))
	_ = w.Flush()

	want := "api | one\napi | two\napi | three\r\napi | four\n"
	if out.String() != want {
		t.Fatalf("got %q, want %q", out.String(), want)
	}
}
