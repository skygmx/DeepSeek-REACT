import { createIncidentFingerprint } from './incidentFingerprint.js'
import {
  validateIncidentPlan,
  validatePatchResult,
} from './incidentFixSchemas.js'

export const INCIDENT_FIX_WORKFLOW_TYPE = 'incident_fix'
export const INCIDENT_FIX_WORKFLOW_VERSION = 2

const MAX_FIX_ATTEMPTS = 3

async function ingestIncident(context, tools) {
  const input = context.input
  const error = input.error ?? (await tools.error.getErrorDetail({
    errorId: input.errorId,
  }))
  const fingerprint = input.fingerprint ?? createIncidentFingerprint(error)

  return {
    output: {
      error,
      fingerprint,
    },
  }
}

async function collectContext(context, services) {
  const incident = context.stepOutputs.ingest_incident
  const collectedContext = await services.incidentContextService.collect(
    incident.error,
  )

  return {
    output: {
      ...collectedContext,
      fingerprint: incident.fingerprint,
    },
  }
}

async function diagnoseAndPlan(context, tools) {
  const incidentContext = context.stepOutputs.collect_context
  const rawPlan = await tools.ai.diagnoseAndPlan({
    context: incidentContext,
    repo: tools.repo,
  })
  const plan = validateIncidentPlan(rawPlan)

  if (plan.status === 'needs_human') {
    return {
      output: plan,
      runStatus: 'needs_human',
      stepStatus: 'needs_human',
    }
  }

  return {
    output: plan,
  }
}

async function createBranchAndFix(context, tools, config) {
  const incident = context.stepOutputs.ingest_incident
  const plan = context.stepOutputs.diagnose_and_plan
  const branchName = `${config.branchPrefix}${incident.fingerprint.slice(0, 12)}`

  if (context.stepAttempt === 1) {
    await tools.git.createBranch({
      baseBranch: config.baseBranch,
      branchName,
    })
  }

  const previousVerification = context.stepOutputs.verify_fix
  const patchResult = await tools.ai.applyFix({
    branchName,
    git: tools.git,
    incidentContext: context.stepOutputs.collect_context,
    plan: previousVerification
      ? { ...plan, previousVerification }
      : plan,
    repo: tools.repo,
  })
  const validatedPatchResult = validatePatchResult(patchResult)

  return {
    output: {
      branchName,
      patchResult: validatedPatchResult,
    },
    runArtifacts: { branchName },
  }
}

async function verifyFix(context, tools) {
  const plan = context.stepOutputs.diagnose_and_plan
  const verification = await tools.git.runVerificationPlan({
    commands: plan.verificationCommands,
  })

  if (verification.passed) {
    return { output: verification }
  }

  const fixAttempts = context.stepAttempts.create_branch_and_fix ?? 1
  return {
    nextStep:
      fixAttempts < MAX_FIX_ATTEMPTS ? 'create_branch_and_fix' : undefined,
    output: verification,
    runStatus:
      fixAttempts >= MAX_FIX_ATTEMPTS ? 'needs_human' : undefined,
  }
}

async function commitFix(context, tools) {
  const patch = context.stepOutputs.create_branch_and_fix
  const commit = await tools.git.commitChanges({
    message: patch.patchResult.commitMessage,
  })

  return {
    output: { commit },
  }
}

async function createPrAndNotify(context, tools, services) {
  const plan = context.stepOutputs.diagnose_and_plan
  const patch = context.stepOutputs.create_branch_and_fix

  await tools.git.pushBranch({
    branchName: patch.branchName,
  })
  const pullRequest = await tools.git.createPullRequest({
    body: patch.patchResult.prBody,
    branchName: patch.branchName,
    title: patch.patchResult.prTitle,
  })
  const owner = services.ownerResolver.resolve({
    context: context.stepOutputs.collect_context,
    plan,
  })
  const notification = await tools.notify.notifyOwner({
    message: `线上报错已生成修复 PR：${pullRequest.url ?? pullRequest.id}`,
    owner,
    pullRequest,
  })

  return {
    output: {
      notification,
      owner,
      pullRequest,
    },
    runArtifacts: { prUrl: pullRequest.url },
    runStatus: 'waiting_review',
  }
}

export function createIncidentFixWorkflow({ config, services, tools }) {
  return {
    steps: [
      {
        execute: (context) => ingestIncident(context, tools),
        name: 'ingest_incident',
      },
      {
        execute: (context) => collectContext(context, services),
        name: 'collect_context',
      },
      {
        execute: (context) => diagnoseAndPlan(context, tools),
        name: 'diagnose_and_plan',
      },
      {
        execute: (context) => createBranchAndFix(context, tools, config),
        name: 'create_branch_and_fix',
      },
      {
        execute: (context) => verifyFix(context, tools),
        name: 'verify_fix',
      },
      {
        execute: (context) => commitFix(context, tools),
        name: 'commit_fix',
      },
      {
        execute: (context) => createPrAndNotify(context, tools, services),
        name: 'create_pr_and_notify',
      },
    ],
    maxStepExecutions: 11,
    type: INCIDENT_FIX_WORKFLOW_TYPE,
    version: INCIDENT_FIX_WORKFLOW_VERSION,
  }
}
