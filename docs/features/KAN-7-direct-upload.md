# KAN-7 — Direct-to-storage uploads (fix 413 on large files)

## Summary

Large files (e.g. a PDF book) failed with `413 Content Too Large` because the
entire file was POSTed through the backend as one request body, hitting the
proxy/body-size limit (and the backend's 20 MB cap, which also loaded the whole
file into memory). Uploads now go **directly to Supabase Storage** via a
backend-issued **signed upload URL** — the bytes never pass through the backend,
so proxy/body limits don't apply. The client then sends only the resulting
public URL to `/messages`, and the existing RAG ingest pipeline runs unchanged.

## Why this (not chunking)

Chunking/indexing operates on file content *after* it's stored — it can't shrink
the upload request. The 413 happened at the **upload** stage, before any RAG ran.
The fix has to be at the transport layer: stop routing big bytes through the API.

## How it works

1. **Sign** — frontend `apiUpload` calls `POST /uploads/sign` with `{filename,
   content_type, size}`. Backend (`api/uploads.py::sign_upload`) generates a
   storage path and returns a signed upload token + the eventual public URL
   (`create_signed_upload_url` on the `chat-uploads` bucket). Tiny JSON request —
   no body-limit issue.
2. **Upload direct** — frontend uploads the bytes straight to the bucket with
   `supabase.storage.from('chat-uploads').uploadToSignedUrl(path, token, file)`.
   The backend is not in the data path; its memory and the proxy body cap are
   irrelevant.
3. **Send URL** — `apiUpload` returns `{url, mime_type, filename, size}` (same
   shape as before), which flows into `POST /messages` → the RAG
   `ingest_attachment` background task (unchanged).

## Limits

- New cap `MAX_SIGNED_SIZE = 50 MB` (`api/uploads.py`) and `MAX_UPLOAD_BYTES =
  50 MB` (frontend) with a **fast client-side check** — the user gets a friendly
  "too large" message instead of a failed round-trip + raw 413.
- The real hard ceiling is the **Supabase project/bucket file-size limit**
  (**50 MB on the free plan**). To allow larger files, raise the bucket limit in
  the Supabase dashboard (Storage → `chat-uploads` → settings) and bump these two
  constants together. Pro plan supports much larger (resumable) uploads.

## Files

- **Modified:** `glyph-backend/api/uploads.py` (new `POST /uploads/sign`;
  legacy `POST /uploads` kept as a fallback), `glyph-frontend/src/services/supabase.js`
  (`apiUpload` rewritten to sign + `uploadToSignedUrl` + size check; exports
  `MAX_UPLOAD_BYTES`).
- No DB migration. No change to message-create or the RAG pipeline.

## How to test

1. Restart backend; build/run frontend.
2. Upload a file **between** the old failing size and 50 MB (e.g. a 30 MB PDF) →
   should succeed (previously 413). Confirm a `documents` row count > 0 after the
   message is sent (RAG ingest still runs).
3. Upload a small file → still works (regression check).
4. Upload a file **> 50 MB** → fails fast client-side with "too large (max 50 MB)",
   no network round-trip.
5. Confirm in Supabase Storage that the object exists under `chat-uploads/` and is
   publicly readable at the returned URL.

## Prerequisite

Ensure the `chat-uploads` bucket's file-size limit in Supabase is ≥ the cap you
want (default free-plan ceiling is 50 MB).

## Follow-up (separate task)

Parallel-batch the RAG ingest so indexing a large book's many chunks is fast —
tracked separately by the user.
