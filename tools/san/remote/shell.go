package remote

import (
	"os/exec"
	"runtime"
	"strings"
)

// DefaultShell is the argv a command is appended to.
//
// It is the shell a person on this machine would type into, because that is what an agent will
// write for. On Windows that means PowerShell — this project's documented primary shell — with
// the profile off (a personal profile is a different environment on every machine, and a
// prompt-customising profile can hang a non-interactive run) and -NonInteractive so a command
// that decides to ask a question fails instead of blocking until the timeout.
func DefaultShell() []string {
	if runtime.GOOS != "windows" {
		return []string{"sh", "-c"}
	}

	// pwsh (PowerShell 7+) when it is installed, powershell (5.1, always present on Windows)
	// otherwise — so the server starts on a bare machine and uses the better shell on a
	// developer's.
	exe := "powershell"

	_, err := exec.LookPath("pwsh")
	if err == nil {
		exe = "pwsh"
	}

	return []string{exe, "-NoProfile", "-NonInteractive", "-Command"}
}

// ParseShell reads a --shell string such as "sh -c" or "bash -lc".
//
// Split on whitespace and nothing cleverer: this is an operator naming a program, not a place to
// re-implement shell quoting. A shell whose path contains a space is given as its own flag words
// or not at all.
func ParseShell(spec string) []string {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return DefaultShell()
	}

	return strings.Fields(spec)
}
