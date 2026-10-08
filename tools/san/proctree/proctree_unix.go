//go:build !windows

package proctree

import (
	"os/exec"
	"syscall"
)

// Configure puts the child and everything it spawns in one process group, so the group id can be
// used to kill the lot.
//
// It also takes the group out of the terminal's foreground group, so a Ctrl-C reaches only san —
// which then decides how the children stop, instead of every process racing its own handler.
func Configure(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// KillTree signals the whole group.
//
// The NEGATIVE pid is the point: kill(pid) reaches only the shell, and `sh -c "go build ./..."`
// is a shell whose child is doing all the work. Killing the shell alone on a timeout leaves the
// compiler running with nothing left to report to.
func KillTree(cmd *exec.Cmd) error {
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
