CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  content_hash text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('indexing', 'ready', 'failed', 'deleted')),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS documents_workspace_status_idx
  ON documents (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS documents_created_by_user_id_idx
  ON documents (created_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS documents_workspace_content_hash_idx
  ON documents (workspace_id, content_hash)
  WHERE status IN ('indexing', 'ready');

CREATE TABLE IF NOT EXISTS document_vector_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL,
  vector vector,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, workspace_id)
    REFERENCES documents(id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS document_vector_chunks_workspace_idx
  ON document_vector_chunks (workspace_id, document_id);

CREATE INDEX IF NOT EXISTS document_vector_chunks_metadata_idx
  ON document_vector_chunks USING gin (metadata);

CREATE OR REPLACE FUNCTION set_document_vector_chunk_fields()
RETURNS trigger AS $$
BEGIN
  NEW.workspace_id = COALESCE(
    NEW.workspace_id,
    NULLIF(NEW.metadata ->> 'workspaceId', '')::uuid
  );
  NEW.document_id = COALESCE(
    NEW.document_id,
    NULLIF(NEW.metadata ->> 'documentId', '')::uuid
  );
  NEW.created_by_user_id = COALESCE(
    NEW.created_by_user_id,
    NULLIF(NEW.metadata ->> 'createdByUserId', '')::uuid
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_set_updated_at ON documents;
CREATE TRIGGER documents_set_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS document_vector_chunks_set_fields
  ON document_vector_chunks;
CREATE TRIGGER document_vector_chunks_set_fields
BEFORE INSERT OR UPDATE ON document_vector_chunks
FOR EACH ROW
EXECUTE FUNCTION set_document_vector_chunk_fields();
