function getErrorMessage(error) {
  return error instanceof Error ? error.message : '工作流执行失败'
}

function normalizeStepResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      output: result ?? {},
      status: 'completed',
    }
  }

  return {
    output: result.output ?? result,
    status: result.status ?? 'completed',
  }
}

function getRunStatusFromStep(status) {
  if (status === 'needs_human') return 'needs_human'
  if (status === 'waiting_review') return 'waiting_review'
  return null
}

export function createWorkflowRunner({ workflowRepository }) {
  async function runStep({ context, step }) {
    await workflowRepository.startStep({
      input: context,
      runId: context.run.id,
      stepName: step.name,
    })

    try {
      const result = normalizeStepResult(await step.execute(context))
      await workflowRepository.completeStep({
        output: result.output,
        runId: context.run.id,
        status: result.status === 'waiting_review' ? 'completed' : result.status,
        stepName: step.name,
      })

      return {
        ...context,
        lastStep: step.name,
        stepOutputs: {
          ...context.stepOutputs,
          [step.name]: result.output,
        },
        workflowStatus: getRunStatusFromStep(result.status),
      }
    } catch (error) {
      await workflowRepository.failStep({
        errorMessage: getErrorMessage(error),
        runId: context.run.id,
        stepName: step.name,
      })
      throw error
    }
  }

  async function executeRun({ run, workflow }) {
    await workflowRepository.startRun(run.id)

    try {
      let context = {
        input: run.input,
        run,
        stepOutputs: {},
      }

      for (const step of workflow.steps) {
        context = await runStep({ context, step })
        if (context.workflowStatus) {
          return workflowRepository.completeRun({
            id: run.id,
            output: context.stepOutputs,
            status: context.workflowStatus,
          })
        }
      }

      return workflowRepository.completeRun({
        id: run.id,
        output: context.stepOutputs,
      })
    } catch (error) {
      return workflowRepository.failRun({
        errorMessage: getErrorMessage(error),
        id: run.id,
      })
    }
  }

  async function runWorkflow({ createdByUserId, input, workflow, workspaceId }) {
    const run = await workflowRepository.createRun({
      createdByUserId,
      input,
      type: workflow.type,
      version: workflow.version,
      workspaceId,
    })

    return executeRun({ run, workflow })
  }

  return {
    executeRun,
    runWorkflow,
  }
}
