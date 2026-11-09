// Package san_pdf_merge puts several files — PDFs and pictures — into ONE PDF, page after page, in the order given.
//
// It is the merge behind a warehouse printing many shipping labels at once
// (a-warehouse-prints-the-labels-of-orders-it-ships): a label is the PDF a marketplace prints or a photo of the
// courier's slip, so a PDF adds its own pages and a picture becomes one page of its own size.
//
// ⚠ ONE FILE NEVER SPOILS THE REST. Each file is read on its own, and a file that cannot be read — not a PDF or a
// picture, truncated, malformed, or so hostile that the PDF library panics on it — is refused with ErrUnreadable while
// every other file still merges. A panic inside the library is recovered per file and never reaches the caller.
//
// The library is pdfcpu (pure Go, Apache-2.0), run with its config directory DISABLED (it would otherwise write a
// config.yml under the user's config dir on first use), offline (no certificate-revocation calls) and with its
// default resource limits on stream sizes.
package san_pdf_merge

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// ErrUnreadable is why a file was left out: it is not a PDF or a picture the merge can read.
var ErrUnreadable = errors.New("the file can't be read")

// ErrNothingToMerge is Merge's answer when no file was given.
var ErrNothingToMerge = errors.New("no file to merge")

// File is one input, in print order.
type File struct {
	Content []byte
	// MimeType as stored with the file ("application/pdf", "image/jpeg", …). Empty or generic
	// ("application/octet-stream") is sniffed from the bytes.
	MimeType string
}

// Result is what became of one File.
type Result struct {
	// Pages this file added to the merged PDF — 0 when it was refused.
	Pages int
	// Why it was refused (wraps ErrUnreadable); nil when it is in.
	Err error
}

var disableConfig sync.Once

// Merge returns the merged PDF and one Result per file, in the files' order. The PDF is nil when no file could be
// read. The error is only for a failure of the WHOLE merge (writing the result); a bad file is its own Result.
func Merge(files []File) ([]byte, []Result, error) {
	if len(files) == 0 {
		return nil, nil, ErrNothingToMerge
	}

	disableConfig.Do(api.DisableConfigDir)

	results := make([]Result, len(files))
	included := make([]int, 0, len(files))

	var dest *model.Context

	for i := range files {
		src, err := contextOf(files[i])
		if err != nil {
			results[i].Err = fmt.Errorf("%w: %w", ErrUnreadable, err)

			continue
		}

		if dest == nil {
			dest = src
			dest.EnsureVersionForWriting()
			results[i].Pages = src.PageCount
			included = append(included, i)

			continue
		}

		pages := src.PageCount

		err = appendTo(src, dest)
		if err != nil {
			// The append may have left dest half-written: refuse this file and rebuild dest from the files already in.
			results[i].Err = fmt.Errorf("%w: %w", ErrUnreadable, err)

			dest, err = rebuild(files, included)
			if err != nil {
				return nil, nil, fmt.Errorf("rebuilding the merge without file %d: %w", i, err)
			}

			continue
		}

		results[i].Pages = pages
		included = append(included, i)
	}

	if dest == nil {
		return nil, results, nil
	}

	out, err := write(dest)
	if err != nil {
		return nil, nil, err
	}

	return out, results, nil
}

// rebuild merges the already-included files again, from their bytes — each was read and appended once already.
func rebuild(files []File, included []int) (*model.Context, error) {
	var dest *model.Context

	for _, i := range included {
		src, err := contextOf(files[i])
		if err != nil {
			return nil, err
		}

		if dest == nil {
			dest = src
			dest.EnsureVersionForWriting()

			continue
		}

		err = appendTo(src, dest)
		if err != nil {
			return nil, err
		}
	}

	return dest, nil
}

func config() *model.Configuration {
	conf := model.NewDefaultConfiguration()
	conf.Cmd = model.MERGECREATE
	conf.ValidationMode = model.ValidationRelaxed
	conf.CreateBookmarks = false
	conf.Offline = true

	return conf
}

// contextOf reads one file as a PDF context: a PDF as it is, a picture as a one-page PDF of the picture's own size.
func contextOf(file File) (ctx *model.Context, err error) {
	defer recoverInto(&err)

	if len(file.Content) == 0 {
		return nil, errors.New("the file is empty")
	}

	kind := kindOf(file)

	var single []byte

	switch kind {
	case kindPDF:
		single, err = rewrite(file.Content)
	case kindImage:
		single, err = imagePDF(file.Content)
	default:
		return nil, fmt.Errorf("a %s is neither a PDF nor a picture", kind)
	}

	if err != nil {
		return nil, err
	}

	ctx, err = api.ReadAndValidate(bytes.NewReader(single), config())
	if err != nil {
		return nil, err
	}

	if ctx.PageCount < 1 {
		return nil, errors.New("the file has no page")
	}

	return ctx, nil
}

// rewrite reads a PDF and writes it out again on its own.
//
// ⚠ pdfcpu READS LAZILY: a broken stream passes the read and the validation, and is then written out broken — into
// the MERGED file, which no viewer can open then (a corrupted sample did exactly that). So each file is written once
// on its own and read back by the caller: only what pdfcpu can read after writing it reaches the merge.
func rewrite(content []byte) ([]byte, error) {
	ctx, err := api.ReadAndValidate(bytes.NewReader(content), config())
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer

	err = api.WriteContext(ctx, &buf)
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// imagePDF turns a picture into a one-page PDF, the page the picture's own size (pdfcpu's "full" import): JPEG is
// embedded as it is, PNG, WEBP and TIFF are decoded.
func imagePDF(content []byte) ([]byte, error) {
	var buf bytes.Buffer

	imp := pdfcpu.DefaultImportConfig()

	conf := config()
	conf.Cmd = model.IMPORTIMAGES

	err := api.ImportImages(nil, &buf, []io.Reader{bytes.NewReader(content)}, imp, conf)
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// appendTo appends src's pages to dest.
func appendTo(src, dest *model.Context) (err error) {
	defer recoverInto(&err)

	// A PDF 2.0 file appended to an older one lifts the result to 2.0, rather than being refused as pdfcpu's own merge
	// does — a label printed by a newer tool is still a label.
	if src.XRefTable.Version() == model.V20 && dest.XRefTable.Version() < model.V20 {
		v := model.V20
		dest.XRefTable.RootVersion = &v
	}

	return pdfcpu.MergeXRefTables("", src, dest, false, false)
}

// write writes the merged PDF in its plainest form — a classic cross-reference table and no object streams (PDF 1.4's
// shape), which every viewer and a label printer's own reader can open, at a few percent of size.
func write(dest *model.Context) (out []byte, err error) {
	defer recoverInto(&err)

	dest.WriteObjectStream = false
	dest.WriteXRefStream = false

	var buf bytes.Buffer

	err = api.WriteContext(dest, &buf)
	if err != nil {
		return nil, fmt.Errorf("writing the merged PDF: %w", err)
	}

	return buf.Bytes(), nil
}

// recoverInto turns a panic inside the PDF library into the file's error — a hostile file must not crash the service.
func recoverInto(err *error) {
	r := recover()
	if r == nil {
		return
	}

	*err = fmt.Errorf("the PDF library failed on the file: %v", r)
}

type kind string

const (
	kindPDF   kind = "pdf"
	kindImage kind = "picture"
)

// kindOf trusts a specific stored type and sniffs a missing or generic one from the bytes.
func kindOf(file File) kind {
	mime := strings.ToLower(strings.TrimSpace(file.MimeType))
	if mime == "" || mime == "application/octet-stream" || mime == "binary/octet-stream" {
		mime = http.DetectContentType(file.Content)
	}

	switch {
	case mime == "application/pdf" || strings.HasPrefix(mime, "application/pdf;"):
		return kindPDF
	case strings.HasPrefix(mime, "image/"):
		return kindImage
	default:
		return kind(mime)
	}
}
