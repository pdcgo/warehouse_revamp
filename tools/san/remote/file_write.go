package remote

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// FileWrite replaces one file with exactly the bytes given.
//
// Not `Exec` with a heredoc: content written through a shell passes through a parser that has
// opinions about `$`, backticks and quoting, and PowerShell will happily interpolate a variable
// out of source code it was only supposed to store. This writes bytes.
func (s *Service) FileWrite(
	ctx context.Context,
	req *connect.Request[remotev1.FileWriteRequest],
) (*connect.Response[remotev1.FileWriteResponse], error) {
	msg := req.Msg

	if len(msg.GetContent()) > MaxFileBytes {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf(
			"content is %d bytes, over the %d byte limit", len(msg.GetContent()), MaxFileBytes))
	}

	path, err := s.resolveFile(msg.GetPath(), false)
	if err != nil {
		return nil, fileError(err)
	}

	// Recorded before the write, because afterwards there is no way to tell.
	_, statErr := os.Stat(path)
	replaced := statErr == nil

	if msg.GetCreateDirs() {
		err = os.MkdirAll(filepath.Dir(path), 0o755)
		if err != nil {
			return nil, fileError(err)
		}
	}

	err = writeAtomic(path, msg.GetContent())
	if err != nil {
		return nil, fileError(err)
	}

	s.audit.Info("file write", "path", path, "size", len(msg.GetContent()), "replaced", replaced)

	return connect.NewResponse(&remotev1.FileWriteResponse{
		Size:     int64(len(msg.GetContent())),
		Replaced: replaced,
	}), nil
}

// writeAtomic writes to a temporary file beside the target and renames it into place.
//
// The rename is what makes this safe: a connection dropped mid-write, or a server killed
// half-way, leaves the ORIGINAL file intact instead of a truncated one. Writing in place would
// mean an agent whose network blipped had silently corrupted a source file — and it would not
// find out until the next build.
//
// The temp file is deliberately in the SAME directory, because a rename across filesystems is a
// copy, and a copy is not atomic.
func writeAtomic(path string, content []byte) error {
	dir := filepath.Dir(path)

	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".san-*")
	if err != nil {
		return err
	}

	tmpName := tmp.Name()

	// Best-effort cleanup for every path out of here that is not the successful rename. Harmless
	// once the rename has happened — the name no longer exists.
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()

	_, err = tmp.Write(content)
	if err != nil {
		return err
	}

	// Flush to the device before the rename. Without it a crash can leave the rename applied and
	// the content not, which is the corruption this function exists to avoid.
	err = tmp.Sync()
	if err != nil {
		return err
	}

	err = tmp.Close()
	if err != nil {
		return err
	}

	// os.CreateTemp makes the file 0600. A source file the operator has to read afterwards should
	// look like the others in the tree.
	err = os.Chmod(tmpName, 0o644)
	if err != nil {
		return err
	}

	return os.Rename(tmpName, path)
}
