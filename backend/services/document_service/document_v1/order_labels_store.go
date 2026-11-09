package document_v1

import (
	"bytes"
	"context"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// StoreOrderLabels stores several orders' labels, merged into one PDF by the order service, as a private ORDER_LABELS
// document of the WAREHOUSE that prints them (a-warehouse-prints-the-labels-of-orders-it-ships), and signs its link. A
// Go method reached in-process through the composition root (order_label_linker.go), NOT an RPC: the file is the order
// service's answer, made from labels it has checked, so no browser can store one (RequestUpload refuses the type).
//
// The object is written straight to the asset prefix — there is no browser PUT to confirm — and then the row, ACTIVE;
// the creator is the person who asked, an override stamped as every upload's is. A row that fails to insert takes its
// object back out.
func (s *Service) StoreOrderLabels(
	ctx context.Context,
	teamID uint64,
	filename string,
	content []byte,
) (string, time.Time, error) {
	documentID, err := newID()
	if err != nil {
		return "", time.Time{}, connect.NewError(connect.CodeInternal, err)
	}

	key := objectKey(docstore.AssetPrefix, teamID, documentID, filename)

	err = s.store.Put(key, bytes.NewReader(content))
	if err != nil {
		return "", time.Time{}, connect.NewError(connect.CodeInternal, err)
	}

	var createdBy uint64

	identity, idErr := san_auth.GetIdentity(ctx)
	if idErr == nil {
		createdBy = identity.GetIdentityId()
	}

	doc := document_service_models.Document{
		ID:           documentID,
		TeamID:       teamID,
		ResourceType: resourceOrderLabels,
		ObjectKey:    key,
		MimeType:     "application/pdf",
		SizeBytes:    int64(len(content)),
		Filename:     filename,
		CreatedByID:  createdBy,
		IsOverride:   san_auth.IsOverride(ctx),
		Status:       statusActive,
	}

	err = s.db.
		WithContext(ctx).
		Create(&doc).
		Error
	if err != nil {
		_ = s.store.Delete(key)

		return "", time.Time{}, connect.NewError(connect.CodeInternal, err)
	}

	expiry := time.Now().Add(s.cfg.URLTTL)

	return s.signer.SignedGetURL(key, filename), expiry, nil
}
