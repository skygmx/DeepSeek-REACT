function toTimestamp(value) {
  return value ? new Date(value).getTime() : null
}

function toWorkflowRun(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdByUserId: row.created_by_user_id,
    type: row.type,
    version: row.version,
    status: row.status,
    currentStep: row.current_step,
    input: row.input,
    output: row.output,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    branchName: row.branch_name,
    prUrl: row.pr_url,
    startedAt: toTimestamp(row.started_at),
    completedAt: toTimestamp(row.completed_at),
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  }
}

function toWorkflowStep(row) {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepName: row.step_name,
    status: row.status,
    attempt: row.attempt,
    input: row.input,
    output: row.output,
    errorMessage: row.error_message,
    startedAt: toTimestamp(row.started_at),
    completedAt: toTimestamp(row.completed_at),
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  }
}

export function createWorkflowRepository({ pool }) {
  async function createRun(options) {
    const result = await pool.query(
      `
        INSERT INTO workflow_runs (
          workspace_id,
          created_by_user_id,
          type,
          version,
          input,
          status
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, 'queued')
        RETURNING *
      `,
      [
        options.workspaceId ?? null,
        options.createdByUserId ?? null,
        options.type,
        options.version ?? 1,
        JSON.stringify(options.input ?? {}),
      ],
    )

    return toWorkflowRun(result.rows[0])
  }

  async function findActiveRunByFingerprint({ fingerprint, type }) {
    const result = await pool.query(
      `
        SELECT *
        FROM workflow_runs
        WHERE type = $1
          AND input ->> 'fingerprint' = $2
          AND status IN ('queued', 'running', 'waiting_review', 'needs_human')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [type, fingerprint],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function startRun(id) {
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET status = 'running',
            started_at = COALESCE(started_at, now()),
            error_message = NULL
        WHERE id = $1
        RETURNING *
      `,
      [id],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function completeRun({ id, output, status = 'completed' }) {
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET status = $2,
            output = $3::jsonb,
            current_step = NULL,
            completed_at = CASE
              WHEN $2 IN ('completed', 'failed', 'cancelled') THEN now()
              ELSE completed_at
            END
        WHERE id = $1
        RETURNING *
      `,
      [id, status, JSON.stringify(output ?? {})],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function failRun({ errorMessage, id }) {
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET status = 'failed',
            error_message = $2,
            completed_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, errorMessage],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function startStep({ input, runId, stepName }) {
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const attemptResult = await client.query(
        `
          SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt
          FROM workflow_steps
          WHERE workflow_run_id = $1
            AND step_name = $2
        `,
        [runId, stepName],
      )
      const attempt = attemptResult.rows[0].next_attempt

      const stepResult = await client.query(
        `
          INSERT INTO workflow_steps (
            workflow_run_id,
            step_name,
            status,
            attempt,
            input,
            started_at
          )
          VALUES ($1, $2, 'running', $3, $4::jsonb, now())
          RETURNING *
        `,
        [runId, stepName, attempt, JSON.stringify(input ?? {})],
      )

      await client.query(
        `
          UPDATE workflow_runs
          SET current_step = $2
          WHERE id = $1
        `,
        [runId, stepName],
      )
      await client.query('COMMIT')

      return toWorkflowStep(stepResult.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function completeStep({ output, runId, status = 'completed', stepName }) {
    const result = await pool.query(
      `
        UPDATE workflow_steps
        SET status = $4,
            output = $3::jsonb,
            completed_at = now()
        WHERE id = (
          SELECT id
          FROM workflow_steps
          WHERE workflow_run_id = $1
            AND step_name = $2
          ORDER BY attempt DESC
          LIMIT 1
        )
        RETURNING *
      `,
      [runId, stepName, JSON.stringify(output ?? {}), status],
    )

    return result.rows[0] ? toWorkflowStep(result.rows[0]) : null
  }

  async function failStep({ errorMessage, runId, stepName }) {
    const result = await pool.query(
      `
        UPDATE workflow_steps
        SET status = 'failed',
            error_message = $3,
            completed_at = now()
        WHERE id = (
          SELECT id
          FROM workflow_steps
          WHERE workflow_run_id = $1
            AND step_name = $2
          ORDER BY attempt DESC
          LIMIT 1
        )
        RETURNING *
      `,
      [runId, stepName, errorMessage],
    )

    return result.rows[0] ? toWorkflowStep(result.rows[0]) : null
  }

  return {
    completeRun,
    completeStep,
    createRun,
    failRun,
    failStep,
    findActiveRunByFingerprint,
    startRun,
    startStep,
  }
}
