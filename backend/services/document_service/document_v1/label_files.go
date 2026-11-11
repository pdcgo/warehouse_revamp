package document_v1

import (
	"context"
	"io"
	"log/slog"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// LabelRef names one label the order service has the right to read: the document and the team that owns it — the
// order's selling team.
type LabelRef struct {
	OwnerTeamID uint64
	DocumentID  string
}

// LabelFile is one label's bytes and stored type.
//
// Content is nil when the row is there but its bytes are not readable — gone from storage, or over the upload limit —
// which the order service reports as "the file can't be read", never as "no label".
type LabelFile struct {
	Content  []byte
	MimeType string
	Filename string
}

// LabelFiles reads the bytes of the labels the order service asks for, after it has checked each order ships from the
// caller's warehouse (a-warehouse-prints-the-labels-of-orders-it-ships) — the merge of several labels into one PDF needs
// the files, not their links. It is LabelURL's door, for the bytes: a Go method reached in-process through the
// composition root (order_label_linker.go), NOT an RPC, and as narrow —
//
//   - only an ORDER RECEIPT, of the team the order service names as its owner, and only an ACTIVE one;
//   - anything else is simply absent from the answer, exactly as LabelURL answers NotFound for it.
//
// One query for every asked label, then one read per file. The answer is keyed by document id.
func (s *Service) LabelFiles(ctx context.Context, labels []LabelRef) (map[string]LabelFile, error) {
	out := make(map[string]LabelFile, len(labels))
	if len(labels) == 0 {
		return out, nil
	}

	ids := make([]string, 0, len(labels))
	for _, label := range labels {
		ids = append(ids, label.DocumentID)
	}

	var docs []document_service_models.Document

	err := s.db.
		WithContext(ctx).
		Select("id", "team_id", "object_key", "mime_type", "filename").
		Where("id IN ? AND resource_type = ? AND status = ?", ids, resourceOrderReceipt, statusActive).
		Find(&docs).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	byID := make(map[string]*document_service_models.Document, len(docs))
	for i := range docs {
		byID[docs[i].ID] = &docs[i]
	}

	for _, label := range labels {
		doc := byID[label.DocumentID]

		// The id alone opens nothing: the row must be the named owner's.
		if doc == nil || doc.TeamID != label.OwnerTeamID {
			continue
		}

		if _, done := out[doc.ID]; done {
			continue
		}

		out[doc.ID] = LabelFile{
			Content:  s.readObject(ctx, doc),
			MimeType: doc.MimeType,
			Filename: doc.Filename,
		}
	}

	return out, nil
}

// readObject is the stored bytes, or nil when they cannot be read — logged, since an active row whose file is gone is a
// storage fault worth seeing.
func (s *Service) readObject(ctx context.Context, doc *document_service_models.Document) []byte {
	r, err := s.store.Open(doc.ObjectKey)
	if err != nil {
		slog.WarnContext(ctx, "label files: an active label's file cannot be opened", "document_id", doc.ID, "err", err)

		return nil
	}

	defer func() { _ = r.Close() }()

	// Never more than an upload may be: a file that grew past it in storage is not read whole into memory.
	content, err := io.ReadAll(io.LimitReader(r, s.cfg.MaxSizeBytes+1))
	if err != nil || int64(len(content)) > s.cfg.MaxSizeBytes {
		slog.WarnContext(ctx, "label files: an active label's file cannot be read", "document_id", doc.ID, "err", err,
			"bytes", len(content))

		return nil
	}

	return content
}
