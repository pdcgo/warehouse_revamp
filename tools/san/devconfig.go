package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// development.yaml — the checkout's own, gitignored, settings for development tooling (backlog #154,
// docs/technical/development/workflow_decision.md#e2e-runs-locally-or-on-another-pc). Today it holds one section:
//
//	e2e_test:
//	  type: ssh        # 'ssh' or 'local' — names the section below that is used
//	  headless: false  # false: the browsers show on the screen of the machine that runs them
//	  ssh:
//	    worker_test: 4
//	    host: 192.168.1.100
//	    user: pdc
//	    password: …    # never printed, never put on a command line, a log or another file
//	  local:
//	    worker_test: 1
//
// No file, or `type: local`, is the run `san test` always made, on this machine. The file is read from the root of
// the checkout san runs in, so every checkout (the tester's included) has its own.

const devConfigFile = "development.yaml"

// e2e places: where `san test` runs its e2e.
const (
	e2eLocal = "local"
	e2eSSH   = "ssh"
)

// devConfig is development.yaml.
type devConfig struct {
	E2E e2eConfig `yaml:"e2e_test"`

	// Found is false when the checkout has no development.yaml (everything is the default).
	Found bool `yaml:"-"`
}

// e2eConfig is development.yaml's e2e_test section.
type e2eConfig struct {
	Type     string        `yaml:"type"`
	Headless *bool         `yaml:"headless"`
	SSH      e2eSSHPlace   `yaml:"ssh"`
	Local    e2eLocalPlace `yaml:"local"`
}

// e2eSSHPlace is e2e_test.ssh: the other PC the whole run moves to.
type e2eSSHPlace struct {
	WorkerTest int    `yaml:"worker_test"`
	Host       string `yaml:"host"`
	User       string `yaml:"user"`
	Password   string `yaml:"password"`
	// Port is the SSH port (default 22) — optional, not in the owner's file.
	Port int `yaml:"port"`
	// Display is the other PC's X display for headless: false (default ":0") — optional.
	Display string `yaml:"display"`
	// Dir is the folder on the other PC that holds its checkout, runs and caches (default
	// ~/warehouse_revamp_e2e) — optional.
	Dir string `yaml:"dir"`
}

// e2eLocalPlace is e2e_test.local: this machine.
type e2eLocalPlace struct {
	WorkerTest int `yaml:"worker_test"`
}

// String never shows the password — a config printed by mistake (a %v in an error) must not leak it.
func (p e2eSSHPlace) String() string {
	return fmt.Sprintf("%s@%s", p.User, p.Addr())
}

// GoString keeps %#v from printing the password too.
func (p e2eSSHPlace) GoString() string {
	return p.String()
}

// Addr is host:port.
func (p e2eSSHPlace) Addr() string {
	port := p.Port
	if port == 0 {
		port = 22
	}

	return fmt.Sprintf("%s:%d", p.Host, port)
}

// readDevConfig reads <root>/development.yaml. No file is not an error: it is the default config.
func readDevConfig(root string) (devConfig, error) {
	b, err := os.ReadFile(filepath.Join(root, devConfigFile))
	if errors.Is(err, fs.ErrNotExist) {
		return devConfig{}, nil
	}

	if err != nil {
		return devConfig{}, err
	}

	return parseDevConfig(b)
}

// parseDevConfig parses and checks development.yaml's text.
func parseDevConfig(b []byte) (devConfig, error) {
	var c devConfig

	err := yaml.Unmarshal(b, &c)
	if err != nil {
		// yaml's message quotes the offending line — which may be the password line. Say where, not what.
		return devConfig{}, fmt.Errorf("%s does not parse as YAML (check its indentation; the line is not repeated "+
			"here, it may hold the password)", devConfigFile)
	}

	c.Found = true
	c.E2E.Type = strings.ToLower(strings.TrimSpace(c.E2E.Type))

	switch c.E2E.Type {
	case "", e2eLocal:
		c.E2E.Type = e2eLocal
	case e2eSSH:
		var missing []string

		if c.E2E.SSH.Host == "" {
			missing = append(missing, "host")
		}

		if c.E2E.SSH.User == "" {
			missing = append(missing, "user")
		}

		if c.E2E.SSH.Password == "" {
			missing = append(missing, "password")
		}

		if len(missing) > 0 {
			return devConfig{}, fmt.Errorf("%s: e2e_test.type is ssh, but e2e_test.ssh has no %s",
				devConfigFile, strings.Join(missing, ", "))
		}
	default:
		return devConfig{}, fmt.Errorf("%s: e2e_test.type %q — want ssh or local", devConfigFile, c.E2E.Type)
	}

	for _, w := range []struct {
		name string
		n    int
	}{{"ssh", c.E2E.SSH.WorkerTest}, {"local", c.E2E.Local.WorkerTest}} {
		if w.n < 0 || w.n > maxWorkers {
			return devConfig{}, fmt.Errorf("%s: e2e_test.%s.worker_test %d — want 1 to %d", devConfigFile, w.name, w.n,
				maxWorkers)
		}
	}

	return c, nil
}

// Remote says the e2e runs on the other PC.
func (c devConfig) Remote() bool {
	return c.E2E.Type == e2eSSH
}

// Headless is e2e_test.headless; a file without the key, and no file, are headless — the run as it always was.
func (c devConfig) Headless() bool {
	if c.E2E.Headless == nil {
		return true
	}

	return *c.E2E.Headless
}

// Workers is the chosen place's worker_test — san test full's --workers N — 1 when unset.
func (c devConfig) Workers() int {
	n := c.E2E.Local.WorkerTest
	if c.Remote() {
		n = c.E2E.SSH.WorkerTest
	}

	if n == 0 {
		return defaultWorkers
	}

	return n
}

// Where names the place for a log line: "this machine" or "pdc@192.168.1.100:22".
func (c devConfig) Where() string {
	if c.Remote() {
		return c.E2E.SSH.String()
	}

	return "this machine"
}
