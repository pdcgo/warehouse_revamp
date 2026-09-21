//go:build windows

package remote

import (
	"os/exec"
	"strconv"
	"syscall"
)

// configureProcessGroup gives the shell its own console process group, so a Ctrl-C reaching this
// server does not race straight through to the child before the handler can kill it cleanly.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// killProcessTree kills the shell AND its descendants.
//
// Windows has no process group signal, so this is taskkill /T — without it, killing
// `pwsh -Command "go build ./..."` leaves go.exe running. taskkill is part of Windows, not an
// optional install, but the fallback is kept because it can fail on a process that has already
// exited.
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}

	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))

	err := kill.Run()
	if err != nil {
		return cmd.Process.Kill()
	}

	return nil
}
