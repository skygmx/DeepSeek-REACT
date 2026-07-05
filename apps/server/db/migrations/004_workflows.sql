CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (
      status IN (
        'queued',
        'running',
        'waiting_review',
        'needs_human',
        'completed',
        'failed',
        'cancelled'
      )
    ),
  current_step text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  branch_name text,
  pr_url text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_runs_type_status_idx
  ON workflow_runs (type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS workflow_runs_workspace_idx
  ON workflow_runs (workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_runs_input_idx
  ON workflow_runs USING gin (input);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL
    REFERENCES workflow_runs(id)
    ON DELETE CASCADE,
  step_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'running',
        'completed',
        'failed',
        'skipped',
        'needs_human'
      )
    ),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, step_name, attempt)
);

CREATE INDEX IF NOT EXISTS workflow_steps_run_idx
  ON workflow_steps (workflow_run_id, created_at ASC);

DROP TRIGGER IF EXISTS workflow_runs_set_updated_at ON workflow_runs;
CREATE TRIGGER workflow_runs_set_updated_at
BEFORE UPDATE ON workflow_runs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS workflow_steps_set_updated_at ON workflow_steps;
CREATE TRIGGER workflow_steps_set_updated_at
BEFORE UPDATE ON workflow_steps
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
