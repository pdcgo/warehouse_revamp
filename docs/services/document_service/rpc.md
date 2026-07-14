# document_service — complex RPC flows

The upload is a **two-phase** flow across three RPCs; it warrants a diagram even though it has no
cross-service dependency, because the bytes travel a path the API server never sees.

## Two-phase, presigned-PUT upload

```mermaid
sequenceDiagram
    participant UI as Browser
    participant API as document_service
    participant S as Object storage
    UI->>API: RequestUpload(team_id, resource_type, content_type, size, filename)
    API->>API: authorize team; INSERT document (status=pending)<br/>key = incoming/teams/{team}/{uuid}.{ext}
    API-->>UI: signed PUT url + upload_token (HMAC of id:expiry) + headers
    UI->>S: PUT raw bytes to the signed url (echo headers) — bytes SKIP the API
    UI->>API: ConfirmUpload(upload_token)
    API->>API: verify HMAC token → document id (reject if expired/forged)
    API->>S: Stat(incoming key) — the bytes must exist
    API->>S: Move incoming/ → assets/
    API->>API: status=active; set public_url for public types
    API-->>UI: Document (+ public_url for public resource types)
    Note over UI,API: later, on demand…
    UI->>API: GetDownloadUrl(team_id, document_id)
    API->>API: SELECT … WHERE id=? AND team_id=? AND status=active
    API-->>UI: public → stable url; private → fresh short-lived signed url
```

**Why these choices:**
- **Two phases (`pending` → `active`).** A metadata row is written before the bytes exist; it is
  only promoted once `ConfirmUpload` verifies the object is actually in storage. So a half-finished
  upload never leaves a row claiming a file that isn't there. Unconfirmed `incoming/` objects are
  reaped by a storage lifecycle TTL.
- **The `upload_token` is a server-signed HMAC** of `documentID:expiry`. It is how `ConfirmUpload`
  recovers *which* document to promote without trusting a client-supplied id, and it can't be forged
  without the server secret. Verified in constant time.
- **`GetDownloadUrl` is team-scoped** — the `team_id = ?` clause means another team's document reads
  as `NotFound`, closing a cross-team read gap. Public resource types (e.g. profile pictures) get a
  stable URL; private ones get a fresh short-lived signed URL each call.
- **Storage is behind a `Signer`/`ObjectStore` seam** (`docstore`). Dev/tests use a local
  filesystem backend with an unauthenticated `/local-storage` file endpoint (path-traversal
  guarded); a cloud backend implements the same two interfaces and changes nothing else.

Code: `backend/services/document_service/document_v1/{request_upload,confirm_upload,get_download_url}.go`,
`backend/services/document_service/docstore/`.
