// Package proctree starts a child so that it can be stopped WITH everything it spawned.
//
// Killing the process san started is not enough, because that process is rarely the one doing the
// work: `sh -c "go build"` is a shell around a compiler, `go run` is a go.exe around a toolchain
// go.exe around the built server, and `npm run dev` is cmd.exe around npm around vite. Kill the outer
// one and the inner one keeps running — still compiling, still holding :8080.
//
//	proctree.Configure(cmd)                                     // before Start
//	cmd.Cancel = func() error { return proctree.KillTree(cmd) } // what ctx cancellation does
//
// Shared by `san remote` (a command an agent runs) and `san dev run` (the dev servers).
package proctree
