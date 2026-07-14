package document_v1

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"  // register decoders
	"image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"strings"

	"golang.org/x/image/draw"

	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
)

const thumbnailMaxPx = 256

func isImage(mimeType string) bool {
	return strings.HasPrefix(strings.ToLower(mimeType), "image/")
}

// thumbnailKey is where a document's thumbnail lives — always a .jpg beside the asset.
func thumbnailKey(teamID uint64, documentID string) string {
	return fmt.Sprintf("%s/teams/%d/%s_thumb.jpg", docstore.AssetPrefix, teamID, documentID)
}

// makeThumbnail generates a thumbnail for an already-stored image and returns its key and (for
// public types) its stable URL. BEST-EFFORT: any failure is logged and returns empty strings — a
// broken thumbnail must never fail the upload the user just completed.
func (s *Service) makeThumbnail(teamID uint64, documentID, assetKey string, public bool) (key, url string) {
	src, err := s.store.Open(assetKey)
	if err != nil {
		slog.Warn("thumbnail: open asset failed", slog.String("key", assetKey), slog.String("err", err.Error()))

		return "", ""
	}
	defer src.Close()

	data, err := generateThumbnail(src)
	if err != nil {
		// Not fatal — the bytes may not be a decodable image despite the declared mime type.
		slog.Warn("thumbnail: generate failed", slog.String("doc", documentID), slog.String("err", err.Error()))

		return "", ""
	}

	key = thumbnailKey(teamID, documentID)

	err = s.store.Put(key, bytes.NewReader(data))
	if err != nil {
		slog.Warn("thumbnail: store failed", slog.String("key", key), slog.String("err", err.Error()))

		return "", ""
	}

	if public {
		url = s.signer.PublicURL(key)
	}

	return key, url
}

// generateThumbnail decodes an image, scales it so its longest side is at most thumbnailMaxPx, and
// re-encodes it as JPEG — small enough for a fast preview.
func generateThumbnail(r io.Reader) ([]byte, error) {
	src, _, err := image.Decode(r)
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}

	thumb := scaleDown(src, thumbnailMaxPx)

	var buf bytes.Buffer

	err = jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 80})
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// scaleDown returns src shrunk so its longest side is at most max (preserving aspect ratio). It
// never enlarges.
func scaleDown(src image.Image, max int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()

	if w <= max && h <= max {
		return src
	}

	nw, nh := max, h*max/w
	if h > w {
		nw, nh = w*max/h, max
	}

	if nw < 1 {
		nw = 1
	}

	if nh < 1 {
		nh = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)

	return dst
}
