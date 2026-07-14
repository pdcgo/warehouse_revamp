package docstore

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// LocalMountPath is where the FileHandler is mounted; a Config.BaseURL should end with the same
// path (minus the trailing slash), so the signer's URLs and the handler agree.
const LocalMountPath = "/local-storage/"

// --- signer ---

// LocalSigner returns plain URLs at the file endpoint. Nothing is really signed and expiry is not
// enforced — this backend is for dev and tests, never production.
type LocalSigner struct {
	baseURL string
}

func NewLocalSigner(cfg Config) *LocalSigner {
	return &LocalSigner{baseURL: strings.TrimRight(cfg.BaseURL, "/")}
}

func (s *LocalSigner) url(key string) string {
	return s.baseURL + "/" + key
}

func (s *LocalSigner) SignedPutURL(key, _ string) string { return s.url(key) }
func (s *LocalSigner) SignedGetURL(key string) string    { return s.url(key) }
func (s *LocalSigner) PublicURL(key string) string       { return s.url(key) }

// --- object store ---

// LocalStore keeps objects on the filesystem under a root directory.
type LocalStore struct {
	dir string
}

func NewLocalStore(cfg Config) *LocalStore {
	return &LocalStore{dir: cfg.Dir}
}

func (l *LocalStore) Stat(key string) (int64, string, error) {
	path, err := safeJoin(l.dir, key)
	if err != nil {
		return 0, "", err
	}

	info, err := os.Stat(path)
	if err != nil {
		return 0, "", err
	}

	// The local backend does not persist the declared content type; "" tells the caller to skip
	// the type check.
	return info.Size(), "", nil
}

func (l *LocalStore) Move(srcKey, dstKey string) error {
	src, err := safeJoin(l.dir, srcKey)
	if err != nil {
		return err
	}

	dst, err := safeJoin(l.dir, dstKey)
	if err != nil {
		return err
	}

	err = os.MkdirAll(filepath.Dir(dst), 0o755)
	if err != nil {
		return err
	}

	return os.Rename(src, dst)
}

func (l *LocalStore) Delete(key string) error {
	path, err := safeJoin(l.dir, key)
	if err != nil {
		return err
	}

	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}

	return err
}

// --- file handler ---

// NewLocalFileHandler serves the object bytes: PUT writes an object, GET/HEAD reads it. It is
// deliberately UNAUTHENTICATED (a signed URL is the capability) and must never be mounted in
// production — only the local backend uses it.
func NewLocalFileHandler(cfg Config) http.Handler {
	dir := cfg.Dir

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, LocalMountPath)

		path, err := safeJoin(dir, key)
		if err != nil {
			http.Error(w, "bad key", http.StatusBadRequest)

			return
		}

		switch r.Method {
		case http.MethodPut:
			err = writeObject(path, r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)

				return
			}

			w.WriteHeader(http.StatusOK)

		case http.MethodGet, http.MethodHead:
			http.ServeFile(w, r, path)

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}

// writeObject writes bytes atomically: to a temp file in the destination directory, then rename, so
// a reader never sees a half-written object.
func writeObject(path string, body io.Reader) error {
	err := os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return err
	}

	tmpName := tmp.Name()

	_, err = io.Copy(tmp, body)
	closeErr := tmp.Close()

	if err != nil {
		os.Remove(tmpName)

		return err
	}

	if closeErr != nil {
		os.Remove(tmpName)

		return closeErr
	}

	return os.Rename(tmpName, path)
}

// safeJoin resolves key under dir and refuses anything that would escape it (path traversal).
func safeJoin(dir, key string) (string, error) {
	clean := filepath.Clean("/" + filepath.FromSlash(key))
	joined := filepath.Join(dir, clean)

	rel, err := filepath.Rel(dir, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("unsafe object key %q", key)
	}

	return joined, nil
}
