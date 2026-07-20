function getErrorMessage(error) {
  return error instanceof Error ? error.message : '工作流执行失败'
}

function normalizeStepResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      nextStep: null,
      output: result ?? {},
      runArtifacts: null,
      runStatus: null,
      stepStatus: 'completed',
    }
  }

  return {
    nextStep: result.nextStep ?? null,
    output: result.output ?? result,
    runArtifacts: result.runArtifacts ?? null,
    runStatus: result.runStatus ?? null,
    stepStatus: result.stepStatus ?? 'completed',
  }
}

function createStepIndex(steps) {
  return new Map(steps.map((step, index) => [step.name, index]))
}

function getNextStepIndex({ currentIndex, nextStep, stepIndex }) {
  if (!nextStep) return currentIndex + 1
  const nextIndex = stepIndex.get(nextStep)
  if (nextIndex === undefined) {
    throw new Error(`工作流下一节点不存在：${nextStep}`)
  }
  return nextIndex
}

export function createWorkflowRunner({ workflowRepository }) {
  async function runStep({ context, step }) {
    const startedStep = await workflowRepository.startStep({
      input: context,
      runId: context.run.id,
      stepName: step.name,
    })
    const stepAttempt =
      startedStep?.attempt ?? (context.stepAttempts[step.name] ?? 0) + 1
    const stepContext = { ...context, stepAttempt }

    try {
      const result = normalizeStepResult(await step.execute(stepContext))
      await workflowRepository.completeStep({
        output: result.output,
        runId: context.run.id,
        status: result.stepStatus,
        stepName: step.name,
      })
      if (result.runArtifacts) {
        await workflowRepository.updateRunArtifacts({
          id: context.run.id,
          ...result.runArtifacts,
        })
      }

      return {
        ...context,
        lastStep: step.name,
        nextStep: result.nextStep,
        runStatus: result.runStatus,
        stepAttempts: {
          ...context.stepAttempts,
          [step.name]: stepAttempt,
        },
        stepOutputs: {
          ...context.stepOutputs,
          [step.name]: result.output,
        },
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
    const startedRun = await workflowRepository.startRun(run.id)
    if (!startedRun) throw new Error('工作流无法从当前状态启动')

    try {
      let context = {
        input: startedRun.input,
        run: startedRun,
        stepAttempts: {},
        stepOutputs: {},
      }
      const stepIndex = createStepIndex(workflow.steps)
      const maxStepExecutions = workflow.maxStepExecutions ?? workflow.steps.length
      let currentIndex = 0
      let executionCount = 0

      while (currentIndex < workflow.steps.length) {
        if (executionCount >= maxStepExecutions) {
          throw new Error('工作流节点执行次数超过限制')
        }
        const step = workflow.steps[currentIndex]
        context = await runStep({ context, step })
        executionCount += 1

        if (context.runStatus) {
          return workflowRepository.pauseRun({
            currentStep:
              context.runStatus === 'needs_human' ? context.lastStep : null,
            id: startedRun.id,
            output: context.stepOutputs,
            status: context.runStatus,
          })
        }

        currentIndex = getNextStepIndex({
          currentIndex,
          nextStep: context.nextStep,
          stepIndex,
        })
      }

      return workflowRepository.completeRun({
        id: startedRun.id,
        output: context.stepOutputs,
      })
    } catch (error) {
      return workflowRepository.failRun({
        errorMessage: getErrorMessage(error),
        id: startedRun.id,
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
