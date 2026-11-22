package document_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

var errShareWithSelf = errors.New("a document is already readable by the team that owns it")

// ShareDocument lets ONE OTHER TEAM read one of this team's documents
// (a-payment-must-carry-proof).
//
// ⚠ THE GRANT IS MADE BY THE OWNER, IN THE OWNER'S SCOPE, and that is the whole design. A payment's
// proof is uploaded by the payer and must be read by the creditor; the alternative was an internal
// signing path that skipped the scope check and let `liability_service` decide who may read, which
// makes one bug in one service's relation check a leak of every private file in the system.
//
// So this service never asks another service anything, and never learns what a payment is. It learns
// "team X may read document D" — a fact the owner is entitled to assert about their own file.
func (s *Service) ShareDocument(
	ctx context.Context,
	req *connect.Request[documentv1.ShareDocumentRequest],
) (*connect.Response[documentv1.ShareDocumentResponse], error) {
	msg := req.Msg

	// Sharing with yourself is not a share. It would be a no-op row that makes "is this shared?" answer
	// yes for a document that never left its team.
	if msg.GetWithTeamId() == msg.GetTeamId() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errShareWithSelf)
	}

	// THE OWNERSHIP CHECK IS THE WHERE CLAUSE, not a comparison after loading. A document belonging to
	// another team must read as NOT FOUND, so a caller cannot probe ids to learn what another team
	// holds — the same rule GetDownloadUrl follows.
	var doc document_service_models.Document

	err := s.db.WithContext(ctx).
		Where("id = ? AND team_id = ? AND status = ?", msg.GetDocumentId(), msg.GetTeamId(), statusActive).
		First(&doc).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Best-effort granter audit — the same treatment `RequestUpload` gives the uploader. A share whose
	// granter is unknown is still a share; refusing it would trade a readable proof for a missing
	// audit field.
	var grantedBy uint64

	identity, idErr := san_auth.GetIdentity(ctx)
	if idErr == nil {
		grantedBy = identity.GetIdentityId()
	}

	share := document_service_models.DocumentShare{
		DocumentID: doc.ID,
		TeamID:     msg.GetWithTeamId(),
		GrantedBy:  grantedBy,
		IsOverride: san_auth.IsOverride(ctx),
	}

	// GRANTING TWICE IS THE SAME FACT, not two of them. A client that retries — or a payer who attaches
	// the same file to a second payment for the same creditor — must not double-write, and must not
	// fail either: the state it asked for is the state that exists.
	err = s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "document_id"}, {Name: "team_id"}},
			DoNothing: true,
		}).
		Create(&share).
		Error
	if err != nil {
		// THE DOCUMENT WENT BETWEEN THE READ AND THE WRITE — the generated-file sweep took it
		// (generated-files-are-kept-seven-days): the share's foreign-key check waited on the sweep's row lock and
		// found the row deleted. That is a document that is gone, so it answers what one already gone answers.
		if isForeignKeyViolation(err) {
			return nil, notFound()
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&documentv1.ShareDocumentResponse{}), nil
}

// isForeignKeyViolation detects a foreign-key violation in BOTH forms — GORM opened with TranslateError turns the
// driver's 23503 into gorm.ErrForeignKeyViolated, a raw Exec may not. On a `document_shares` insert it can only mean
// the document is gone: `document_id` is that table's one foreign key (team_id has none — teams are another service's).
func isForeignKeyViolation(err error) bool {
	if errors.Is(err, gorm.ErrForeignKeyViolated) {
		return true
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23503"
	}

	return false
}
