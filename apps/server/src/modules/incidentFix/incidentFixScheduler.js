import { createWorkflowScheduler } from '../workflow/workflowScheduler.js'
import { createIncidentFingerprint } from './incidentFingerprint.js'

function normalizeErrors(errors) {
  return Array.isArray(errors) ? errors : []
}

export function createIncidentFixScheduler(options) {
  return createWorkflowScheduler({
    enabled: options.config.enabled,
    intervalMs: options.config.pollIntervalMs,
    async onTick() {
      const errors = normalizeErrors(
        await options.tools.error.listRecentErrors({
          windowMinutes: options.config.pollWindowMinutes,
        }),
      )

      for (const error of errors) {
        const fingerprint = createIncidentFingerprint(error)
        const activeRun =
          await options.workflowRepository.findActiveRunByFingerprint({
            fingerprint,
            type: options.workflow.type,
          })

        if (activeRun) continue

        await options.workflowRunner.runWorkflow({
          input: {
            error,
            fingerprint,
            source: 'incident_poll',
          },
          workflow: options.workflow,
        })
      }
    },
    onError(error) {
      console.error(
        error instanceof Error ? error.message : '事故修复轮询失败',
      )
    },
  })
}
