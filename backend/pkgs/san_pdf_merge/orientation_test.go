package san_pdf_merge_test

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_pdf_merge"
)

// A label seen the right way up: 128 × 64, a colour per quarter, so every turn and every mirror puts a different colour
// in each corner. The quarters are 64 × 32 — whole JPEG blocks — so the colours survive two encodes.
const (
	uprightW = 128
	uprightH = 64
)

var (
	red    = color.RGBA{R: 230, A: 255}
	green  = color.RGBA{G: 200, A: 255}
	blue   = color.RGBA{B: 230, A: 255}
	yellow = color.RGBA{R: 230, G: 220, A: 255}
)

func uprightLabel() *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, uprightW, uprightH))

	for y := range uprightH {
		for x := range uprightW {
			c := red // top-left

			switch {
			case x >= uprightW/2 && y < uprightH/2:
				c = green // top-right
			case x < uprightW/2 && y >= uprightH/2:
				c = blue // bottom-left
			case x >= uprightW/2 && y >= uprightH/2:
				c = yellow // bottom-right
			}

			img.Set(x, y, c)
		}
	}

	return img
}

// Where the STORED picture's first row and first column sit when the picture is seen the right way up — the EXIF
// specification's own table for the Orientation tag, written out here so the fixture does not borrow the code under
// test's turns.
var (
	firstRowAt    = map[int]string{1: "top", 2: "top", 3: "bottom", 4: "bottom", 5: "left", 6: "right", 7: "right", 8: "left"}
	firstColumnAt = map[int]string{1: "left", 2: "right", 3: "right", 4: "left", 5: "top", 6: "top", 7: "bottom", 8: "bottom"}
)

// storedAs is what a camera writes for the upright picture under this orientation: each stored pixel is the upright
// pixel the table says it shows.
func storedAs(up *image.RGBA, orientation int) *image.RGBA {
	w, h := up.Bounds().Dx(), up.Bounds().Dy()

	sw, sh := w, h
	if orientation >= 5 {
		sw, sh = h, w // a stored row runs down the upright picture
	}

	out := image.NewRGBA(image.Rect(0, 0, sw, sh))

	for sy := range sh {
		for sx := range sw {
			var vx, vy int

			switch firstRowAt[orientation] {
			case "top", "bottom":
				vy = sy
				if firstRowAt[orientation] == "bottom" {
					vy = h - 1 - sy
				}

				vx = sx
				if firstColumnAt[orientation] == "right" {
					vx = w - 1 - sx
				}
			default: // the first row is the upright picture's left or right column
				vx = sy
				if firstRowAt[orientation] == "right" {
					vx = w - 1 - sy
				}

				vy = sx
				if firstColumnAt[orientation] == "bottom" {
					vy = h - 1 - sx
				}
			}

			out.Set(sx, sy, up.At(vx, vy))
		}
	}

	return out
}

func jpegBytes(t *testing.T, img image.Image) []byte {
	t.Helper()

	var buf bytes.Buffer

	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95})
	if err != nil {
		t.Fatal(err)
	}

	return buf.Bytes()
}

// withEXIF puts an APP1 EXIF segment right after the JPEG's SOI: a TIFF header in the given byte order and one image
// directory holding a camera make (so the orientation is not the first entry) and the Orientation tag.
func withEXIF(t *testing.T, jpg []byte, order binary.ByteOrder, orientation uint16) []byte {
	t.Helper()

	var tiff bytes.Buffer

	if order == binary.ByteOrder(binary.LittleEndian) {
		tiff.WriteString("II")
	} else {
		tiff.WriteString("MM")
	}

	put := func(v any) {
		err := binary.Write(&tiff, order, v)
		if err != nil {
			t.Fatal(err)
		}
	}

	put(uint16(42))
	put(uint32(8)) // the first directory follows the header

	put(uint16(2)) // two entries

	put(uint16(0x010F)) // Make, ASCII, 4 bytes inline
	put(uint16(2))
	put(uint32(4))
	tiff.WriteString("Pho\x00")

	put(uint16(0x0112)) // Orientation, SHORT, 1 value
	put(uint16(3))
	put(uint32(1))
	put(orientation)
	put(uint16(0))

	put(uint32(0)) // no next directory

	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	segment := []byte{0xFF, 0xE1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}

	out := append([]byte{}, jpg[:2]...)
	out = append(out, segment...)
	out = append(out, payload...)

	return append(out, jpg[2:]...)
}

// placed merges one picture behind a PDF label and returns the picture as it was placed on its page: the raw image
// stream and its type.
func placed(t *testing.T, picture []byte) ([]byte, string, *san_pdf_merge.Result) {
	t.Helper()

	files := []san_pdf_merge.File{
		{Content: read(t, samplePDFs(t)[0]), MimeType: "application/pdf"},
		{Content: picture, MimeType: "image/jpeg"},
	}

	out, results, err := san_pdf_merge.Merge(files)
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}

	if results[1].Err != nil || results[1].Pages != 1 {
		t.Fatalf("the photo: %+v, want one page", results[1])
	}

	page := pagesOf(t, out)

	images, err := api.ExtractImagesRaw(bytes.NewReader(out), []string{itoa(page)}, nil)
	if err != nil {
		t.Fatalf("extracting the photo's page: %v", err)
	}

	var raws [][]byte

	var kind string

	for _, byObj := range images {
		for _, img := range byObj {
			raw, err := io.ReadAll(img)
			if err != nil {
				t.Fatal(err)
			}

			raws = append(raws, raw)
			kind = img.FileType
		}
	}

	if len(raws) != 1 {
		t.Fatalf("the photo's page holds %d pictures, want 1", len(raws))
	}

	// The page is the picture's own size: as wide as the upright picture, never the stored one.
	dims, err := api.PageDims(bytes.NewReader(out), nil)
	if err != nil {
		t.Fatal(err)
	}

	last := dims[len(dims)-1]
	if last.Width <= last.Height {
		t.Errorf("the photo's page is %.0f × %.0f — upright it is wider than tall", last.Width, last.Height)
	}

	return raws[0], kind, &results[1]
}

func itoa(n int) string {
	return string(rune('0'+n/10%10)) + string(rune('0'+n%10))
}

// near reads one colour within a JPEG's tolerance.
func near(got color.Color, want color.RGBA) bool {
	r, g, b, _ := got.RGBA()

	d := func(a uint32, b uint8) int {
		v := int(a>>8) - int(b)
		if v < 0 {
			return -v
		}

		return v
	}

	return d(r, want.R) < 50 && d(g, want.G) < 50 && d(b, want.B) < 50
}

// backlog #39 — a label photographed in portrait prints UPRIGHT: whichever of the eight EXIF orientations the phone
// wrote, in either byte order, the picture placed on the page is the upright one — its width and height, and each
// colour in its own corner.
func TestMerge_AJPEGIsPlacedTheWayItsEXIFSaysItIsSeen(t *testing.T) {
	up := uprightLabel()

	orders := map[string]binary.ByteOrder{"II": binary.LittleEndian, "MM": binary.BigEndian}

	for name, order := range orders {
		for orientation := 1; orientation <= 8; orientation++ {
			stored := storedAs(up, orientation)
			photo := withEXIF(t, jpegBytes(t, stored), order, uint16(orientation))

			raw, kind, _ := placed(t, photo)
			if kind != "jpg" {
				t.Fatalf("%s orientation %d: placed as %q, want a JPEG", name, orientation, kind)
			}

			img, err := jpeg.Decode(bytes.NewReader(raw))
			if err != nil {
				t.Fatalf("%s orientation %d: the placed picture: %v", name, orientation, err)
			}

			b := img.Bounds()
			if b.Dx() != uprightW || b.Dy() != uprightH {
				t.Fatalf("%s orientation %d: placed %d × %d, want the upright %d × %d (stored %d × %d)",
					name, orientation, b.Dx(), b.Dy(), uprightW, uprightH, stored.Bounds().Dx(), stored.Bounds().Dy())
			}

			corners := []struct {
				where string
				x, y  int
				want  color.RGBA
			}{
				{"top-left", uprightW / 4, uprightH / 4, red},
				{"top-right", 3 * uprightW / 4, uprightH / 4, green},
				{"bottom-left", uprightW / 4, 3 * uprightH / 4, blue},
				{"bottom-right", 3 * uprightW / 4, 3 * uprightH / 4, yellow},
			}

			for _, c := range corners {
				got := color.RGBAModel.Convert(img.At(b.Min.X+c.x, b.Min.Y+c.y))
				if !near(got, c.want) {
					t.Errorf("%s orientation %d: %s is %v, want %v", name, orientation, c.where, got, c.want)
				}
			}

			// Orientation 1 is already upright: the photo is placed byte for byte, never re-encoded.
			if orientation == 1 && !bytes.Equal(raw, photo) {
				t.Errorf("%s orientation 1: the photo was re-encoded — an upright one is placed as it is", name)
			}

			if orientation > 1 && bytes.Equal(raw, photo) {
				t.Errorf("%s orientation %d: placed as stored", name, orientation)
			}
		}
	}
}

// A photo with no EXIF, or a tag the merge cannot read — out of range, cut short, not a TIFF — is placed as it is: an
// unturned label still prints, and the file is never refused for its metadata.
func TestMerge_AJPEGWithoutAReadableOrientationIsPlacedAsItIs(t *testing.T) {
	plain := jpegBytes(t, uprightLabel())

	// The TIFF header sits after SOI (2), the APP1 marker and length (4) and "Exif\0\0" (6).
	const tiffAt = 12

	pastTheSegment := withEXIF(t, plain, binary.LittleEndian, 6)
	binary.LittleEndian.PutUint32(pastTheSegment[tiffAt+4:], 0xFFFF) // the directory "starts" past the segment

	notTIFF := withEXIF(t, plain, binary.BigEndian, 6)
	copy(notTIFF[tiffAt:tiffAt+2], "XX")

	notEXIF := withEXIF(t, plain, binary.BigEndian, 6)
	copy(notEXIF[tiffAt-2:tiffAt], "!!") // "Exif\0\0" no longer

	cases := map[string][]byte{
		"no EXIF":                      plain,
		"orientation 0":                withEXIF(t, plain, binary.LittleEndian, 0),
		"orientation 9":                withEXIF(t, plain, binary.BigEndian, 9),
		"orientation 65535":            withEXIF(t, plain, binary.LittleEndian, 65535),
		"a directory past the segment": pastTheSegment,
		"not a TIFF header":            notTIFF,
		"an APP1 that is not EXIF":     notEXIF,
	}

	for name, photo := range cases {
		t.Run(name, func(t *testing.T) {
			raw, _, result := placed(t, photo)
			if result.Err != nil {
				t.Fatalf("refused: %v", result.Err)
			}

			if !bytes.Equal(raw, photo) {
				t.Error("the photo was changed — a photo without a readable turn is placed as it is")
			}
		})
	}
}

// A photo past the 50-megapixel cap is placed unturned rather than decoded — a file claiming 65535 × 65535 must not
// take the server's memory. The header is enough to tell: the picture is never decoded.
func TestMerge_AHugeJPEGIsNotDecodedToTurnIt(t *testing.T) {
	photo := withEXIF(t, jpegBytes(t, uprightLabel()), binary.LittleEndian, 6)

	// Claim 10 000 × 6 000 (60 MP) in the frame header.
	at := bytes.Index(photo, []byte{0xFF, 0xC0})
	if at < 0 {
		t.Fatal("no baseline frame header")
	}

	binary.BigEndian.PutUint16(photo[at+5:], 6_000)
	binary.BigEndian.PutUint16(photo[at+7:], 10_000)

	out, results, err := san_pdf_merge.Merge([]san_pdf_merge.File{{Content: photo, MimeType: "image/jpeg"}})
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}

	// Placed as it is — or refused as unreadable by the PDF library; never turned.
	if results[0].Err == nil {
		images, err := api.ExtractImagesRaw(bytes.NewReader(out), nil, nil)
		if err != nil {
			t.Fatal(err)
		}

		for _, byObj := range images {
			for _, img := range byObj {
				raw, _ := io.ReadAll(img)
				if !bytes.Equal(raw, photo) {
					t.Fatal("a photo past the cap was re-encoded")
				}
			}
		}
	}
}
