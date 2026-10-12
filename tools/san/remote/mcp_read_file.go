package remote

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// encodingText and encodingBase64 name how the content field is carried.
//
// MCP is JSON, and JSON has no bytes. A source file is usually UTF-8 but a fixture, an image or a
// file mid-edit is not obliged to be — and silently replacing the bad bytes would hand an agent a
// file it could then write back CORRUPTED, having been told nothing. So the encoding is stated,
// and a non-UTF-8 file comes back as base64 rather than as a lie.
const (
	encodingText   = "text"
	encodingBase64 = "base64"
)

type readFileIn struct {
	Path string `json:"path" jsonschema:"path RELATIVE to the workspace root, forward slashes are fine; absolute paths and paths climbing out with .. are refused"`
}

type readFileOut struct {
	Content string `json:"content" jsonschema:"the file; base64-encoded when encoding is base64"`

	Encoding string `json:"encoding" jsonschema:"text when the file is valid UTF-8, base64 when it is not — check this before editing"`

	Size int64 `json:"size" jsonschema:"the file size in bytes, before any encoding"`

	ModifiedAt string `json:"modified_at" jsonschema:"RFC 3339 last-modification time; compare it before write_file to notice the file moved under you"`
}

// addReadFileTool reads one file, byte for byte.
func addReadFileTool(server *mcp.Server, service *Service) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "read_file",
		Title: "Read a file",
		Description: "Read one file from the workspace exactly as it is on disk. Prefer this over " +
			"run_command with cat/Get-Content: a shell re-encodes line endings and mangles what it " +
			"passes. Note modified_at — write_file replaces the WHOLE file, so an edit is read, change, " +
			"write, and a file that moved in between means your copy is stale.",
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint: true,
			// NOT idempotent: the file can change between two identical calls, and a client that
			// cached this would serve an agent its own pre-edit copy.
			IdempotentHint: false,
			OpenWorldHint:  ptr(false),
		},
	}, func(
		ctx context.Context,
		_ *mcp.CallToolRequest,
		in readFileIn,
	) (*mcp.CallToolResult, readFileOut, error) {
		req := &remotev1.FileReadRequest{Path: in.Path}

		// The path-length limit lives in remote.proto and is enforced here by the same validator
		// the RPC gets from its interceptor — a handler called directly has no interceptor.
		err := protovalidate.Validate(req)
		if err != nil {
			return nil, readFileOut{}, fmt.Errorf("invalid arguments: %w", err)
		}

		resp, err := service.FileRead(ctx, connect.NewRequest(req))
		if err != nil {
			return nil, readFileOut{}, fileToolError(err)
		}

		msg := resp.Msg
		content := msg.GetContent()

		out := readFileOut{
			Size:     msg.GetSize(),
			Encoding: encodingText,
			Content:  string(content),
		}

		if !utf8.Valid(content) {
			out.Encoding = encodingBase64
			out.Content = base64.StdEncoding.EncodeToString(content)
		}

		if msg.GetModifiedAt() != nil {
			out.ModifiedAt = msg.GetModifiedAt().AsTime().Format(time.RFC3339)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: out.Content}},
		}, out, nil
	})
}

// fileToolError unwraps a connect error into the sentence a model can act on.
//
// The connect status code is meaningless to an agent on the far side of MCP — what it needs is
// the message, and it needs it as a TOOL error (visible, self-correctable) rather than a protocol
// error (invisible to the model).
func fileToolError(err error) error {
	var connectErr *connect.Error

	if errors.As(err, &connectErr) {
		return fmt.Errorf("%s: %s", connectErr.Code(), connectErr.Message())
	}

	return err
}
