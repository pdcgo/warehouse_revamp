package remote

import (
	"context"
	"errors"
	"fmt"
	"os"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// MaxFileBytes caps both FileRead and FileWrite.
//
// It is a size, not a policy: these two exist to move SOURCE, and a source file that is 8MB is a
// build artefact or a dump. Moving one of those is a job for Exec and a shell — which is what the
// error says, rather than making the caller guess.
const MaxFileBytes = 8 << 20

// FileRead returns one file, byte for byte.
//
// Not `Exec("cat …")`: reading through a shell hands the bytes to a program with opinions about
// line endings and encoding, and on Windows redirection will re-encode the content on the way
// past. A file read this way is the file.
func (s *Service) FileRead(
	ctx context.Context,
	req *connect.Request[remotev1.FileReadRequest],
) (*connect.Response[remotev1.FileReadResponse], error) {
	path, err := s.resolveFile(req.Msg.GetPath(), true)
	if err != nil {
		return nil, fileError(err)
	}

	info, err := os.Stat(path)
	if err != nil {
		return nil, fileError(err)
	}

	// Checked BEFORE reading, not after: the point of a cap is to avoid pulling a gigabyte into
	// memory, and a check on the result would have already done it.
	if info.Size() > MaxFileBytes {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf(
			"%s is %d bytes, over the %d byte limit — move it with Exec and a shell instead",
			req.Msg.GetPath(), info.Size(), MaxFileBytes))
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fileError(err)
	}

	s.audit.Info("file read", "path", path, "size", len(content))

	return connect.NewResponse(&remotev1.FileReadResponse{
		Content:    content,
		Size:       int64(len(content)),
		ModifiedAt: timestamppb.New(info.ModTime()),
	}), nil
}

// fileError maps an os error to the code a caller can act on.
//
// NotFound and PermissionDenied are the two an agent should handle differently — one means "make
// it", the other means "stop and tell the operator" — and collapsing both into Internal would
// make them indistinguishable without parsing the message.
func fileError(err error) error {
	switch {
	// The caller's own mistake, and the most common error here — a path built by concatenation
	// somewhere upstream. Checked FIRST, because a bad path can also carry an os sentinel.
	case errors.Is(err, errBadPath):
		return connect.NewError(connect.CodeInvalidArgument, err)

	case errors.Is(err, os.ErrNotExist):
		return connect.NewError(connect.CodeNotFound, err)

	case errors.Is(err, os.ErrPermission):
		return connect.NewError(connect.CodePermissionDenied, err)

	default:
		// A real filesystem failure — a full disk, a broken mount. NOT the caller's fault, and
		// reporting it as InvalidArgument would send an agent off rewriting a path that was fine.
		return connect.NewError(connect.CodeInternal, err)
	}
}
