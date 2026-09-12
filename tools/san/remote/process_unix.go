//go:build !windows

package remote

import (
	"os/exec"
	"syscall"
)

// configureProcessGroup puts the shell and everything it spawns in one process group, so the
// group id can be used to kill the lot.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessTree signals the whole group.
//
// The NEGATIVE pid is the point: kill(pid) reaches only the shell, and `sh -c "go build ./..."`
// is a shell whose child is doing all the work. Killing the shell alone on a timeout leaves the
// compiler running with nothing left to report to.
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}

	err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	if err != nil {
		// The group may already be gone; fall back to the process itself rather than reporting a
		// failure for something that has finished on its own.
		return cmd.Process.Kill()
	}

	return nil
}
