package remote

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// workspaceInfoIn takes nothing. It is a named type rather than struct{} so the generated input
// schema is an object a client can send `{}` to, which is what every MCP client does.
type workspaceInfoIn struct{}

type workspaceInfoOut struct {
	Root string `json:"workspace_root" jsonschema:"absolute path of the workspace on the operator's machine; every path you send is relative to this"`

	Shell []string `json:"shell" jsonschema:"the argv your command is appended to, e.g. [\"sh\",\"-c\"] or [\"pwsh\",\"-NoProfile\",\"-Command\"] — write for THIS shell"`

	OS   string `json:"os" jsonschema:"the operating system, as Go names it: linux, darwin, windows"`
	Arch string `json:"arch" jsonschema:"the CPU architecture, as Go names it: amd64, arm64"`

	DefaultTimeoutSeconds uint32 `json:"default_timeout_seconds" jsonschema:"applied when run_command does not ask for one"`
	MaxTimeoutSeconds     uint32 `json:"max_timeout_seconds" jsonschema:"the ceiling; asking for more is capped, not refused"`

	MaxFileBytes int64 `json:"max_file_bytes" jsonschema:"the size limit on read_file and write_file; move anything bigger with run_command"`

	// A string rather than a timestamp type: this is read by a model, and RFC 3339 is the form it
	// can compare against the date it already knows. Empty means the token dies with the server.
	TokenExpiresAt string `json:"token_expires_at,omitempty" jsonschema:"RFC 3339 time this connection's token stops working; absent means it lasts as long as the server runs"`
}

// addWorkspaceInfoTool is the handshake, and the cheapest check that the token works.
//
// It calls the Info RPC rather than reading the Service's fields, so the two faces cannot come to
// disagree about what the workspace is — a second reader of the same private state is a second
// answer waiting to happen.
func addWorkspaceInfoTool(server *mcp.Server, service *Service) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "workspace_info",
		Title: "Workspace info",
		Description: "Where the workspace is, WHICH SHELL run_command will parse your command with, " +
			"the timeout ceiling, and when this connection's token expires. Call this first: the shell " +
			"is not guessable and `&&`, quoting and `$` mean different things in sh and PowerShell.",
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint: true,
			// Nothing here depends on when it is asked, so a client is free to cache it.
			IdempotentHint: true,
		},
	}, func(
		ctx context.Context,
		_ *mcp.CallToolRequest,
		_ workspaceInfoIn,
	) (*mcp.CallToolResult, workspaceInfoOut, error) {
		resp, err := service.Info(ctx, connect.NewRequest(&remotev1.InfoRequest{}))
		if err != nil {
			return nil, workspaceInfoOut{}, err
		}

		msg := resp.Msg

		out := workspaceInfoOut{
			Root:                  msg.GetWorkspaceRoot(),
			Shell:                 msg.GetShell(),
			OS:                    msg.GetOs(),
			Arch:                  msg.GetArch(),
			DefaultTimeoutSeconds: msg.GetDefaultTimeoutSeconds(),
			MaxTimeoutSeconds:     msg.GetMaxTimeoutSeconds(),
			MaxFileBytes:          MaxFileBytes,
		}

		if msg.GetTokenExpiresAt() != nil {
			out.TokenExpiresAt = msg.GetTokenExpiresAt().AsTime().Format(time.RFC3339)
		}

		return nil, out, nil
	})
}

// ptr is for the MCP annotation fields that are *bool because "unset" and "false" are different
// answers there — unset means the server did not say, and a client may assume the safer default.
func ptr[T any](v T) *T { return &v }
