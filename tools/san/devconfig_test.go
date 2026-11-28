package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The owner's development.yaml shape (workflow_decision.md#e2e-runs-locally-or-on-another-pc), with a fake password.
const ownerShapeYAML = `e2e_test:
  type: ssh # can be 'ssh' 'local'
  headless: false

  ssh:
    worker_test: 4
    host: 192.168.1.100
    user: pdc
    password: not-the-real-one

  local:
    worker_test: 1
`

func TestDevConfigNoFileIsTheLocalRun(t *testing.T) {
	c, err := readDevConfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if c.Found || c.Remote() || !c.Headless() || c.Workers() != 1 || c.Where() != "this machine" {
		t.Fatalf("no file must be today's run (local, headless, 1 worker): %+v", c)
	}
}

func TestDevConfigOwnersFileIsTheOtherPC(t *testing.T) {
	root := t.TempDir()

	err := os.WriteFile(filepath.Join(root, devConfigFile), []byte(ownerShapeYAML), 0o600)
	if err != nil {
		t.Fatal(err)
	}

	c, err := readDevConfig(root)
	if err != nil {
		t.Fatal(err)
	}

	if !c.Found || !c.Remote() || c.Headless() || c.Workers() != 4 {
		t.Fatalf("type ssh: remote, headed, the ssh section's 4 workers — got remote=%v headless=%v workers=%d",
			c.Remote(), c.Headless(), c.Workers())
	}

	if c.E2E.SSH.Addr() != "192.168.1.100:22" || c.Where() != "pdc@192.168.1.100:22" {
		t.Fatalf("addr %q where %q", c.E2E.SSH.Addr(), c.Where())
	}
}

func TestDevConfigTypeLocalUsesTheLocalSection(t *testing.T) {
	c, err := parseDevConfig([]byte(strings.Replace(ownerShapeYAML, "type: ssh", "type: local", 1)))
	if err != nil {
		t.Fatal(err)
	}

	if c.Remote() || c.Workers() != 1 || c.Headless() {
		t.Fatalf("type local: this machine, local.worker_test 1, headless false as written — %+v", c.E2E.Local)
	}
}

func TestDevConfigHeadlessDefaultsToTrue(t *testing.T) {
	c, err := parseDevConfig([]byte("e2e_test:\n  type: local\n"))
	if err != nil {
		t.Fatal(err)
	}

	if !c.Headless() || c.Workers() != 1 {
		t.Fatalf("a file without headless/worker_test is headless on 1 worker: headless=%v workers=%d", c.Headless(),
			c.Workers())
	}
}

func TestDevConfigRefusesAnUnknownType(t *testing.T) {
	_, err := parseDevConfig([]byte("e2e_test:\n  type: docker\n"))
	if err == nil || !strings.Contains(err.Error(), "want ssh or local") {
		t.Fatalf("want a refusal naming ssh or local, got %v", err)
	}
}

func TestDevConfigSSHNeedsHostUserPassword(t *testing.T) {
	_, err := parseDevConfig([]byte("e2e_test:\n  type: ssh\n  ssh:\n    host: h\n"))
	if err == nil || !strings.Contains(err.Error(), "user, password") {
		t.Fatalf("want the missing keys named, got %v", err)
	}
}

func TestDevConfigNeverPrintsThePassword(t *testing.T) {
	c, err := parseDevConfig([]byte(ownerShapeYAML))
	if err != nil {
		t.Fatal(err)
	}

	for _, s := range []string{fmt.Sprintf("%v", c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c.E2E.SSH),
		fmt.Sprint(c.E2E.SSH)} {
		if strings.Contains(s, "not-the-real-one") {
			t.Fatalf("the password leaked into a formatted config: %s", s)
		}
	}

	_, err = parseDevConfig([]byte("e2e_test:\n  ssh:\n    password: not-the-real-one\n  bad: [\n"))
	if err == nil || strings.Contains(err.Error(), "not-the-real-one") {
		t.Fatalf("a parse error must not quote the file: %v", err)
	}
}
