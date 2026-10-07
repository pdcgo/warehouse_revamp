package remote

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCPServerName is what an agent's tool list calls this server. It is deliberately not the
// project's name: what is on the other end is ONE developer's checkout, not "the warehouse".
const MCPServerName = "san-remote"

// MCPVersion is this server's own version, reported at initialize. It moves when the TOOL SET
// changes shape, not when the warehouse does.
const MCPVersion = "0.1.0"

// mcpInstructions is what the model reads before it calls anything.
//
// It is the same handshake `workspace_info` returns, written for a reader rather than a parser —
// a model that has to spend a tool call learning the shell is a model that will write `&&` for
// PowerShell first and find out afterwards. The rules here are the ones that are expensive to
// discover by getting them wrong.
const mcpInstructions = `You are connected to a developer's LOCAL CHECKOUT of a project, over a tunnel.

Call workspace_info FIRST. It tells you the workspace root, which shell run_command uses, and the
timeout ceiling. The shell matters: sh and PowerShell disagree about ` + "`&&`" + `, quoting and ` + "`$`" + `.

Every path you send is RELATIVE to the workspace root. Absolute paths and paths climbing out with
".." are refused.

Use read_file and write_file for source, NOT run_command with cat/heredoc. Those two move exact
bytes; a shell in the middle re-encodes line endings and interpolates ` + "`$`" + ` and backticks out of
code you only meant to store. write_file REPLACES the whole file — read it, change it, write it
back.

run_command is for building, testing and inspecting. A non-zero exit is a normal result, not a
failure of the call: read exit_code and the output. Output over the cap is truncated in the
MIDDLE, and truncated is set when that happened.

⚠ This is NOT a sandbox. Every command runs as the operator, on their machine, against their real
working tree. Destructive or irreversible actions — deleting files, resetting git state, dropping
databases, pushing, touching anything outside the checkout — need the operator to ask for them
first. When you are unsure, say what you would run and ask.`

// NewMCPServer builds the MCP face of a remote Service.
//
// # Why MCP as well as Connect RPC
//
// The Connect API is what a client we write talks to. MCP is what clients we DID NOT write talk
// to — Claude on the web, a browser agent, somebody else's harness — and none of those will grow
// a hand-written client for a proto contract that lives in this repo. MCP is the transport that
// makes the same four capabilities reachable from outside the machine, over a tunnel, with no
// integration work on the far side.
//
// # Why it wraps the SAME service
//
// Every tool here builds the SAME proto request the Connect RPC takes, validates it with
// protovalidate, and calls the SAME handler or the same runner. The limits (max command length,
// max file bytes, the timeout ceiling, the containment rule) therefore cannot differ between the
// two faces — they are read from one contract, not re-typed as an `if` per transport. A second
// copy of a limit is a copy free to drift.
func NewMCPServer(service *Service) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:        MCPServerName,
		Title:       "san remote — " + service.Root(),
		Version:     MCPVersion,
		Description: "Run commands and read and write files in a developer's local checkout.",
	}, &mcp.ServerOptions{
		Instructions: mcpInstructions,
	})

	addWorkspaceInfoTool(server, service)
	addRunCommandTool(server, service)
	addReadFileTool(server, service)
	addWriteFileTool(server, service)

	return server
}
