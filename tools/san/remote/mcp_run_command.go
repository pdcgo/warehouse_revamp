package remote

import (
	"context"
	"errors"
	"fmt"

	"buf.build/go/protovalidate"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

type runCommandIn struct {
	Command string `json:"command" jsonschema:"the command line, handed to the workspace's shell — pipes, redirects and && behave as they do in a terminal; call workspace_info to learn WHICH shell"`

	WorkingDir string `json:"working_dir,omitempty" jsonschema:"where to run, RELATIVE to the workspace root; empty means the root itself. Absolute paths and paths climbing out with .. are refused"`

	Env map[string]string `json:"env,omitempty" jsonschema:"extra environment variables, on top of the server's own"`

	Stdin string `json:"stdin,omitempty" jsonschema:"written to the command's stdin, which is then closed; empty means a command that reads stdin sees EOF immediately rather than hanging"`

	TimeoutSeconds uint32 `json:"timeout_seconds,omitempty" jsonschema:"kill the command after this long; 0 uses the server default and the server's ceiling always wins"`
}

type runCommandOut struct {
	Output string `json:"output" jsonschema:"stdout and stderr, interleaved in the order the command produced them"`

	ExitCode int32 `json:"exit_code" jsonschema:"the command's exit status; -1 when it never started or was killed before reporting one"`

	TimedOut bool `json:"timed_out" jsonschema:"true when the timeout killed it — branch on THIS, not on a non-zero exit"`

	DurationMs int64 `json:"duration_ms" jsonschema:"how long the command ran, in milliseconds"`

	StderrBytes int `json:"stderr_bytes" jsonschema:"how much of the output came from stderr; 0 means the command wrote nothing to it"`

	Truncated    bool `json:"truncated" jsonschema:"true when the output was too large and the MIDDLE was dropped; the head and the tail are kept"`
	DroppedBytes int  `json:"dropped_bytes,omitempty" jsonschema:"how many bytes the truncation removed"`
}

// addRunCommandTool runs ONE command and hands back everything it printed.
//
// # Why this is buffered where the RPC streams
//
// Exec streams because a caller with a terminal wants to watch a build fail on line 40. A tool
// call has no such caller: its result lands in a model's context in one piece, once, at the end.
// Buffering is not a downgrade here — it is what the transport is.
//
// Both go through the same run() ([runner.go]), so the process-tree kill, the timeout ceiling and
// the UTF-8 repair are one implementation with two sinks.
func addRunCommandTool(server *mcp.Server, service *Service) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "run_command",
		Title: "Run a command",
		Description: "Run one shell command in the workspace and get back its output and exit code. " +
			"Use it to build, test, inspect and search. A NON-ZERO EXIT IS A NORMAL RESULT — read " +
			"exit_code and the output rather than treating the call as failed. Do NOT use it to read " +
			"or write source: read_file and write_file move exact bytes, a shell does not.",
		Annotations: &mcp.ToolAnnotations{
			// Everything true about this tool is a warning. A command can delete the tree, it is
			// not repeatable, and it can reach the network — so every hint says so, and none of
			// them is left to a client's default.
			ReadOnlyHint:    false,
			DestructiveHint: ptr(true),
			IdempotentHint:  false,
			OpenWorldHint:   ptr(true),
		},
	}, func(
		ctx context.Context,
		_ *mcp.CallToolRequest,
		in runCommandIn,
	) (*mcp.CallToolResult, runCommandOut, error) {
		// Built as the PROTO request and validated with protovalidate, so the command-length and
		// stdin-size limits are the ones in remote.proto. Re-typing them as an `if` here is how
		// the two faces of this service would start enforcing different contracts.
		req := &remotev1.ExecRequest{
			Command:        in.Command,
			WorkingDir:     in.WorkingDir,
			Env:            in.Env,
			Stdin:          in.Stdin,
			TimeoutSeconds: in.TimeoutSeconds,
		}

		err := protovalidate.Validate(req)
		if err != nil {
			return nil, runCommandOut{}, fmt.Errorf("invalid arguments: %w", err)
		}

		out := newTranscript(MaxTranscriptBytes)

		result, err := service.run(ctx, runParams{
			command:        req.GetCommand(),
			workingDir:     req.GetWorkingDir(),
			env:            req.GetEnv(),
			stdin:          req.GetStdin(),
			timeoutSeconds: req.GetTimeoutSeconds(),
			peer:           peerFrom(ctx),
		}, out)
		if err != nil {
			return nil, runCommandOut{}, runCommandError(err)
		}

		structured := runCommandOut{
			Output:       out.String(),
			ExitCode:     result.GetExitCode(),
			TimedOut:     result.GetTimedOut(),
			DurationMs:   result.GetDurationMs(),
			StderrBytes:  out.stderrSeen(),
			Truncated:    out.truncated(),
			DroppedBytes: out.droppedBytes(),
		}

		// The Content is written by hand rather than left to the SDK's JSON rendering of the
		// struct above. A model reading a build failure should see the compiler's output as text,
		// not the same output escaped inside a JSON string — and the status line has to be there
		// for a client that shows Content and ignores structured output entirely.
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: renderRun(structured)},
			},
		}, structured, nil
	})
}

// renderRun is the human- and model-readable view of a run.
func renderRun(out runCommandOut) string {
	status := fmt.Sprintf("exit %d in %dms", out.ExitCode, out.DurationMs)
	if out.TimedOut {
		status = fmt.Sprintf("TIMED OUT after %dms (exit %d)", out.DurationMs, out.ExitCode)
	}

	if out.Output == "" {
		return "(no output)\n\n" + status
	}

	return out.Output + "\n" + status
}

// runCommandError explains a run that produced no result at all.
//
// It stays a plain error, which the SDK turns into a tool result with IsError set — deliberately
// NOT an MCP protocol error. A protocol error is invisible to the model, so an agent that sent a
// bad working_dir would see the call vanish instead of being told what to fix.
func runCommandError(err error) error {
	switch {
	case errors.Is(err, errBadPath):
		return fmt.Errorf("bad working_dir: %w", err)

	case errors.Is(err, context.Canceled):
		return fmt.Errorf("the call was cancelled before the command finished: %w", err)

	case errors.Is(err, errNotStarted):
		return fmt.Errorf("the command never started — this is the server's shell, not your command: %w", err)

	default:
		return err
	}
}
