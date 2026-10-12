//go:build windows

package proctree

import (
	"os/exec"
	"strconv"
	"syscall"
)

// Configure gives the child its own console process group, so a Ctrl-C reaching san does not race
// straight through to the child before san can kill it cleanly.
//
// For `npm run dev` it is also what keeps cmd.exe from stopping at "Terminate batch job (Y/N)?" —
// a prompt nobody can answer, because the child has no stdin.
func Configure(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// KillTree kills the child AND its descendants.
//
// Windows has no process group signal, so this is taskkill /T — without it, killing
// `pwsh -Command "go build ./..."` leaves go.exe running, and killing `go run` leaves the server it
// built still holding its port. taskkill is part of Windows, not an optional install, but the
// fallback is kept because it can fail on a process that has already exited.
func KillTree(cmd *exec.Cmd) error {
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
