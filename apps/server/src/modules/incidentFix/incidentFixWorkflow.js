import { createIncidentFingerprint } from './incidentFingerprint.js'
import {
  validateIncidentPlan,
  validatePatchResult,
} from './incidentFixSchemas.js'

export const INCIDENT_FIX_WORKFLOW_TYPE = 'incident_fix'
export const INCIDENT_FIX_WORKFLOW_VERSION = 1

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
      status: 'needs_human',
    }
  }

  return {
    output: plan,
  }
}

async function patchOnBranch(context, tools, config) {
  const incident = context.stepOutputs.ingest_incident
  const plan = context.stepOutputs.diagnose_and_plan
  const branchName = `${config.branchPrefix}${incident.fingerprint.slice(0, 12)}`

  await tools.git.createBranch({
    baseBranch: config.baseBranch,
    branchName,
  })
  const patchResult = await tools.ai.applyFix({
    branchName,
    git: tools.git,
    incidentContext: context.stepOutputs.collect_context,
    plan,
    repo: tools.repo,
  })
  const validatedPatchResult = validatePatchResult(patchResult)
  await tools.git.commitChanges({
    message: validatedPatchResult.commitMessage,
  })

  return {
    output: {
      branchName,
      patchResult: validatedPatchResult,
    },
  }
}

async function verifyAndOpenPr(context, tools) {
  const plan = context.stepOutputs.diagnose_and_plan
  const patch = context.stepOutputs.patch_on_branch
  const verification = await tools.git.runVerificationPlan({
    commands: plan.verificationCommands,
  })

  if (!verification.passed) {
    throw new Error('修复验证未通过')
  }

  await tools.git.pushBranch({
    branchName: patch.branchName,
  })
  const pullRequest = await tools.git.createPullRequest({
    body: patch.patchResult.prBody,
    branchName: patch.branchName,
    title: patch.patchResult.prTitle,
  })

  return {
    output: {
      pullRequest,
      verification,
    },
  }
}

async function notifyAndWait(context, tools, services) {
  const plan = context.stepOutputs.diagnose_and_plan
  const pullRequest = context.stepOutputs.verify_and_open_pr.pullRequest
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
    status: 'waiting_review',
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
        execute: (context) => patchOnBranch(context, tools, config),
        name: 'patch_on_branch',
      },
      {
        execute: (context) => verifyAndOpenPr(context, tools),
        name: 'verify_and_open_pr',
      },
      {
        execute: (context) => notifyAndWait(context, tools, services),
        name: 'notify_and_wait',
      },
    ],
    type: INCIDENT_FIX_WORKFLOW_TYPE,
    version: INCIDENT_FIX_WORKFLOW_VERSION,
  }
}
