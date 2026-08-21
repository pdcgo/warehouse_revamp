package remote

import (
	"context"
	"encoding/base64"
	"fmt"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

type writeFileIn struct {
	Path string `json:"path" jsonschema:"path RELATIVE to the workspace root; absolute paths and paths climbing out with .. are refused"`

	Content string `json:"content" jsonschema:"the WHOLE file — a write replaces, it never appends. Read the file first, change it, send all of it back"`

	Encoding string `json:"encoding,omitempty" jsonschema:"how content is carried: text (the default) or base64 for a file that is not valid UTF-8"`

	CreateDirs bool `json:"create_dirs,omitempty" jsonschema:"create missing parent directories; off by default so a typo in a path fails loudly instead of quietly building a tree"`
}

type writeFileOut struct {
	Size int64 `json:"size" jsonschema:"bytes written"`

	Replaced bool `json:"replaced" jsonschema:"true when the write replaced an existing file rather than creating one — check it when you meant to create"`
}

// addWriteFileTool replaces one file with exactly the bytes given.
func addWriteFileTool(server *mcp.Server, service *Service) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "write_file",
		Title: "Write a file",
		Description: "Replace one file in the workspace with exactly these bytes. Prefer this over " +
			"run_command with a heredoc or Set-Content: a shell interpolates $ and backticks out of " +
			"code you only meant to store. THE WRITE REPLACES THE WHOLE FILE — there is no append and " +
			"no partial write, so read the file first unless you are creating it.",
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint: false,
			// Destructive because a write over an existing file is not recoverable from here —
			// replaced in the result is how an agent finds out, and by then it has happened.
			DestructiveHint: ptr(true),
			// Writing the same bytes twice leaves the same file, so this one genuinely is safe to
			// retry — which matters when a tunnel drops a response the server already applied.
			IdempotentHint: true,
			OpenWorldHint:  ptr(false),
		},
	}, func(
		ctx context.Context,
		_ *mcp.CallToolRequest,
		in writeFileIn,
	) (*mcp.CallToolResult, writeFileOut, error) {
		content, err := decodeContent(in.Content, in.Encoding)
		if err != nil {
			return nil, writeFileOut{}, err
		}

		req := &remotev1.FileWriteRequest{
			Path:       in.Path,
			Content:    content,
			CreateDirs: in.CreateDirs,
		}

		err = protovalidate.Validate(req)
		if err != nil {
			return nil, writeFileOut{}, fmt.Errorf("invalid arguments: %w", err)
		}

		resp, err := service.FileWrite(ctx, connect.NewRequest(req))
		if err != nil {
			return nil, writeFileOut{}, fileToolError(err)
		}

		out := writeFileOut{
			Size:     resp.Msg.GetSize(),
			Replaced: resp.Msg.GetReplaced(),
		}

		verb := "wrote"
		if out.Replaced {
			verb = "replaced"
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: fmt.Sprintf("%s %s (%d bytes)", verb, in.Path, out.Size)},
			},
		}, out, nil
	})
}

// decodeContent turns the JSON-carried content back into bytes.
//
// An UNRECOGNISED encoding is refused rather than treated as text. A caller that sent base64 and
// had it stored verbatim would find its file full of base64 and no error to explain it — and
// would most likely write it again the same way.
func decodeContent(content, encoding string) ([]byte, error) {
	switch encoding {
	case "", encodingText:
		return []byte(content), nil

	case encodingBase64:
		raw, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return nil, fmt.Errorf("encoding is %q but content is not valid base64: %w", encodingBase64, err)
		}

		return raw, nil

	default:
		return nil, fmt.Errorf("unknown encoding %q — use %q or %q", encoding, encodingText, encodingBase64)
	}
}
