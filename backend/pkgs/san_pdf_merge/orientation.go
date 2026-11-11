package san_pdf_merge

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
)

// A phone stores a photo the way its sensor reads it and writes HOW TO TURN IT into the JPEG's EXIF `Orientation` tag
// (0x0112). A viewer turns it; pdfcpu embeds the bytes as they are and ignores the tag — so a label photographed in
// portrait printed SIDEWAYS (backlog #39). upright turns such a photo before it is placed on its page.
//
// The eight values, by where the stored picture's first row and first column sit when it is seen the right way up:
//
//	1 top-left (as stored)   2 top-right (mirrored)   3 bottom-right (turned 180°)   4 bottom-left (flipped)
//	5 left-top (transposed)  6 right-top (turn 90° cw) 7 right-bottom (transverse)   8 left-bottom (turn 90° ccw)

// maxUprightPixels caps the picture upright decodes: 50 megapixels (a 48 MP phone's full-size photo) costs about
// 225 MB while it is turned. A bigger one — or a hostile file claiming 65535 × 65535 — is placed as it is, unturned,
// rather than risking the server's memory: a sideways label still prints, an out-of-memory crash prints nothing.
const maxUprightPixels = 50_000_000

// uprightQuality is the JPEG quality a turned photo is written back at — high enough that a barcode's bars stay sharp.
const uprightQuality = 92

// upright returns the JPEG turned the way its EXIF orientation says it is seen, re-encoded without the tag, and true;
// or the content unchanged and false when there is nothing to turn (not a JPEG, no tag, orientation 1, a value outside
// 1–8) or it cannot be turned (too big, undecodable). Never an error: an unturned label is still a label.
func upright(content []byte) ([]byte, bool) {
	orientation := jpegOrientation(content)
	if orientation < 2 || orientation > 8 {
		return content, false
	}

	conf, err := jpeg.DecodeConfig(bytes.NewReader(content))
	if err != nil || conf.Width <= 0 || conf.Height <= 0 || conf.Width*conf.Height > maxUprightPixels {
		return content, false
	}

	src, err := jpeg.Decode(bytes.NewReader(content))
	if err != nil {
		return content, false
	}

	turned := orient(src, orientation)

	var buf bytes.Buffer

	err = jpeg.Encode(&buf, turned, &jpeg.Options{Quality: uprightQuality})
	if err != nil {
		return content, false
	}

	return buf.Bytes(), true
}

// orient applies the turn or flip that shows src the right way up. Its bounds start at 0,0.
func orient(src image.Image, orientation int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()

	dw, dh := w, h
	if orientation >= 5 {
		dw, dh = h, w
	}

	// from maps a pixel of the turned picture to the stored pixel it shows (both relative to 0,0).
	from := func(x, y int) (int, int) {
		switch orientation {
		case 2:
			return w - 1 - x, y
		case 3:
			return w - 1 - x, h - 1 - y
		case 4:
			return x, h - 1 - y
		case 5:
			return y, x
		case 6:
			return y, h - 1 - x
		case 7:
			return w - 1 - y, h - 1 - x
		case 8:
			return w - 1 - y, x
		default:
			return x, y
		}
	}

	switch s := src.(type) {
	case *image.YCbCr:
		// Sample for sample, at full chroma resolution: no colour conversion, whatever the source's subsampling.
		dst := image.NewYCbCr(image.Rect(0, 0, dw, dh), image.YCbCrSubsampleRatio444)

		for y := range dh {
			for x := range dw {
				sx, sy := from(x, y)
				yi := s.YOffset(b.Min.X+sx, b.Min.Y+sy)
				ci := s.COffset(b.Min.X+sx, b.Min.Y+sy)
				di := dst.YOffset(x, y)

				dst.Y[di] = s.Y[yi]
				dst.Cb[di] = s.Cb[ci]
				dst.Cr[di] = s.Cr[ci]
			}
		}

		return dst
	case *image.Gray:
		dst := image.NewGray(image.Rect(0, 0, dw, dh))

		for y := range dh {
			for x := range dw {
				sx, sy := from(x, y)
				dst.Pix[dst.PixOffset(x, y)] = s.Pix[s.PixOffset(b.Min.X+sx, b.Min.Y+sy)]
			}
		}

		return dst
	default:
		// A CMYK JPEG: rare enough for the generic, slower path.
		dst := image.NewRGBA(image.Rect(0, 0, dw, dh))

		for y := range dh {
			for x := range dw {
				sx, sy := from(x, y)
				dst.Set(x, y, src.At(b.Min.X+sx, b.Min.Y+sy))
			}
		}

		return dst
	}
}

// jpegOrientation reads the EXIF Orientation tag of a JPEG: 1–8, or 0 when it is not a JPEG or carries none. A small
// reader of the APP1 segment's first image directory, bounds-checked at every step — a malformed segment reads as 0.
func jpegOrientation(content []byte) int {
	if len(content) < 4 || content[0] != 0xFF || content[1] != 0xD8 {
		return 0
	}

	i := 2

	for i+4 <= len(content) {
		if content[i] != 0xFF {
			return 0
		}

		marker := content[i+1]

		// Fill bytes before a marker.
		if marker == 0xFF {
			i++

			continue
		}

		// The image data starts (SOS) or ends (EOI): no EXIF came before it.
		if marker == 0xDA || marker == 0xD9 {
			return 0
		}

		// Markers without a length.
		if marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			i += 2

			continue
		}

		length := int(binary.BigEndian.Uint16(content[i+2 : i+4]))
		if length < 2 || i+2+length > len(content) {
			return 0
		}

		segment := content[i+4 : i+2+length]

		if marker == 0xE1 && len(segment) >= 6 && string(segment[:6]) == "Exif\x00\x00" {
			return exifOrientation(segment[6:])
		}

		i += 2 + length
	}

	return 0
}

// exifOrientation reads tag 0x0112 from the first image directory (IFD0) of an EXIF block's TIFF structure.
func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 0
	}

	var order binary.ByteOrder

	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}

	if order.Uint16(tiff[2:4]) != 42 {
		return 0
	}

	ifd := int(order.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 0
	}

	entries := int(order.Uint16(tiff[ifd : ifd+2]))

	for n := range entries {
		at := ifd + 2 + n*12
		if at+12 > len(tiff) {
			return 0
		}

		if order.Uint16(tiff[at:at+2]) != 0x0112 {
			continue
		}

		// SHORT (3), one value, stored in the first two bytes of the value field.
		if order.Uint16(tiff[at+2:at+4]) != 3 || order.Uint32(tiff[at+4:at+8]) != 1 {
			return 0
		}

		return int(order.Uint16(tiff[at+8 : at+10]))
	}

	return 0
}
