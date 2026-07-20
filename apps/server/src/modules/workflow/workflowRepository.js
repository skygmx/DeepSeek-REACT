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

const pauseStatuses = new Set(['needs_human', 'waiting_review'])
const reviewStatuses = new Set(['cancelled', 'completed', 'needs_human'])

function assertStatus(status, allowedStatuses, message) {
  if (!allowedStatuses.has(status)) throw new Error(message)
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
          AND status IN ('queued', 'needs_human')
        RETURNING *
      `,
      [id],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function completeRun({ id, output }) {
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET status = 'completed',
            output = $2::jsonb,
            current_step = NULL,
            completed_at = now()
        WHERE id = $1
          AND status = 'running'
        RETURNING *
      `,
      [id, JSON.stringify(output ?? {})],
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
          AND status = 'running'
        RETURNING *
      `,
      [id, errorMessage],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function pauseRun({ currentStep, id, output, status }) {
    assertStatus(status, pauseStatuses, '不支持的工作流暂停状态')
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET status = $2,
            output = $3::jsonb,
            current_step = $4,
            completed_at = NULL
        WHERE id = $1
          AND status = 'running'
        RETURNING *
      `,
      [id, status, JSON.stringify(output ?? {}), currentStep ?? null],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function updateReviewStatus({ id, status }) {
    assertStatus(status, reviewStatuses, '不支持的人工审核状态')
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET status = $2,
            current_step = CASE WHEN $2 = 'needs_human' THEN 'review_changes' END,
            completed_at = CASE
              WHEN $2 IN ('completed', 'cancelled') THEN now()
              ELSE NULL
            END
        WHERE id = $1
          AND status = 'waiting_review'
        RETURNING *
      `,
      [id, status],
    )

    return result.rows[0] ? toWorkflowRun(result.rows[0]) : null
  }

  async function updateRunArtifacts({ branchName, id, prUrl }) {
    const result = await pool.query(
      `
        UPDATE workflow_runs
        SET branch_name = COALESCE($2, branch_name),
            pr_url = COALESCE($3, pr_url)
        WHERE id = $1
          AND status = 'running'
        RETURNING *
      `,
      [id, branchName ?? null, prUrl ?? null],
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
    pauseRun,
    startRun,
    startStep,
    updateReviewStatus,
    updateRunArtifacts,
  }
}
