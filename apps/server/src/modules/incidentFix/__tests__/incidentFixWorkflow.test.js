/** @jest-environment node */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIncidentFixWorkflow,
  INCIDENT_FIX_WORKFLOW_VERSION,
} from '../incidentFixWorkflow.js'
import { createWorkflowRepository } from '../../workflow/workflowRepository.js'
import { createWorkflowRunner } from '../../workflow/workflowRunner.js'

const READY_PLAN = {
  confidence: 0.9,
  status: 'ready_to_patch',
  summary: '修复空值处理',
  suspectFiles: ['src/example.js'],
  verificationCommands: ['pnpm lint'],
}

const PATCH_RESULT = {
  changedFiles: ['src/example.js'],
  commitMessage: 'fix: 处理空值',
  prBody: '修复线上空值异常',
  prTitle: 'fix: 处理线上空值异常',
}

function countCalls(calls, name) {
  return calls.filter((call) => call.name === name).length
}

function createHarness({ diagnoseStatus, verificationResults = [true] } = {}) {
  const calls = []
  const stepAttempts = new Map()
  const artifacts = {}
  let runStatus = 'queued'
  let verificationIndex = 0

  const workflowRepository = {
    async completeRun({ id, output }) {
      runStatus = 'completed'
      return { id, output, status: runStatus }
    },
    async completeStep(options) {
      calls.push({ name: 'completeStep', options })
    },
    async createRun({ input, version }) {
      return { id: 'run-1', input, status: 'queued', version }
    },
    async failRun({ errorMessage, id }) {
      runStatus = 'failed'
      return { errorMessage, id, status: runStatus }
    },
    async failStep(options) {
      calls.push({ name: 'failStep', options })
    },
    async pauseRun({ currentStep, id, output, status }) {
      runStatus = status
      return { currentStep, id, output, status }
    },
    async startRun(id) {
      if (!['queued', 'needs_human'].includes(runStatus)) return null
      runStatus = 'running'
      return { id, input: { error: { id: 'error-1' } }, status: runStatus }
    },
    async startStep({ stepName }) {
      const attempt = (stepAttempts.get(stepName) ?? 0) + 1
      stepAttempts.set(stepName, attempt)
      return { attempt }
    },
    async updateRunArtifacts(options) {
      Object.assign(artifacts, options)
    },
  }

  const tools = {
    ai: {
      async applyFix(options) {
        calls.push({ name: 'applyFix', options })
        return PATCH_RESULT
      },
      async diagnoseAndPlan() {
        calls.push({ name: 'diagnoseAndPlan' })
        return diagnoseStatus
          ? { ...READY_PLAN, status: diagnoseStatus }
          : READY_PLAN
      },
    },
    error: {},
    git: {
      async commitChanges(options) {
        calls.push({ name: 'commitChanges', options })
        return { committed: true }
      },
      async createBranch(options) {
        calls.push({ name: 'createBranch', options })
      },
      async createPullRequest(options) {
        calls.push({ name: 'createPullRequest', options })
        return { id: 7, url: 'https://example.com/pr/7' }
      },
      async pushBranch(options) {
        calls.push({ name: 'pushBranch', options })
      },
      async runVerificationPlan(options) {
        const passed = verificationResults[verificationIndex] ?? false
        verificationIndex += 1
        calls.push({ name: 'runVerificationPlan', options })
        return { passed, results: [] }
      },
    },
    notify: {
      async notifyOwner(options) {
        calls.push({ name: 'notifyOwner', options })
        return { notified: true }
      },
    },
    repo: {},
  }

  const workflow = createIncidentFixWorkflow({
    config: { baseBranch: 'main', branchPrefix: 'codex/incident-' },
    services: {
      incidentContextService: {
        async collect(error) {
          return { error, logs: { available: true, data: [] } }
        },
      },
      ownerResolver: { resolve: () => 'frontend-owner' },
    },
    tools,
  })

  return {
    artifacts,
    calls,
    run: () =>
      createWorkflowRunner({ workflowRepository }).runWorkflow({
        input: { error: { id: 'error-1' } },
        workflow,
      }),
    workflow,
  }
}

test('工作流使用七个业务节点并升级为第二版', () => {
  const { workflow } = createHarness()

  assert.equal(INCIDENT_FIX_WORKFLOW_VERSION, 2)
  assert.deepEqual(
    workflow.steps.map((step) => step.name),
    [
      'ingest_incident',
      'collect_context',
      'diagnose_and_plan',
      'create_branch_and_fix',
      'verify_fix',
      'commit_fix',
      'create_pr_and_notify',
    ],
  )
})

test('验证通过后才提交并在创建合并请求后等待人工审核', async () => {
  const { artifacts, calls, run } = createHarness()
  const result = await run()

  assert.equal(result.status, 'waiting_review')
  assert.deepEqual(artifacts, {
    id: 'run-1',
    branchName: 'codex/incident-error-1',
    prUrl: 'https://example.com/pr/7',
  })
  assert.deepEqual(
    calls
      .filter((call) => !['completeStep'].includes(call.name))
      .map((call) => call.name),
    [
      'diagnoseAndPlan',
      'createBranch',
      'applyFix',
      'runVerificationPlan',
      'commitChanges',
      'pushBranch',
      'createPullRequest',
      'notifyOwner',
    ],
  )
})

test('验证失败后在原分支重新修复并携带失败结果', async () => {
  const { calls, run } = createHarness({ verificationResults: [false, true] })
  const result = await run()
  const applyCalls = calls.filter((call) => call.name === 'applyFix')

  assert.equal(result.status, 'waiting_review')
  assert.equal(countCalls(calls, 'createBranch'), 1)
  assert.equal(applyCalls.length, 2)
  assert.equal(countCalls(calls, 'runVerificationPlan'), 2)
  assert.equal(countCalls(calls, 'commitChanges'), 1)
  assert.equal(applyCalls[1].options.plan.previousVerification.passed, false)
})

test('连续三次验证未通过后转人工处理', async () => {
  const { calls, run } = createHarness({
    verificationResults: [false, false, false],
  })
  const result = await run()

  assert.equal(result.status, 'needs_human')
  assert.equal(result.currentStep, 'verify_fix')
  assert.equal(countCalls(calls, 'applyFix'), 3)
  assert.equal(countCalls(calls, 'commitChanges'), 0)
  assert.equal(countCalls(calls, 'createPullRequest'), 0)
})

test('诊断要求人工处理时不会创建修复分支', async () => {
  const { calls, run } = createHarness({ diagnoseStatus: 'needs_human' })
  const result = await run()

  assert.equal(result.status, 'needs_human')
  assert.equal(result.currentStep, 'diagnose_and_plan')
  assert.equal(countCalls(calls, 'createBranch'), 0)
})

test('人工审核结果只能从等待审核状态流转', async () => {
  const queries = []
  const repository = createWorkflowRepository({
    pool: {
      async query(sql, values) {
        queries.push({ sql, values })
        return { rows: [{ id: values[0], status: values[1] }] }
      },
    },
  })

  const result = await repository.updateReviewStatus({
    id: 'run-1',
    status: 'completed',
  })

  assert.equal(result.status, 'completed')
  assert.match(queries[0].sql, /status = 'waiting_review'/u)
  await assert.rejects(
    repository.updateReviewStatus({ id: 'run-1', status: 'running' }),
    /不支持的人工审核状态/u,
  )
})
