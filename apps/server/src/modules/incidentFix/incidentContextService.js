async function optionalCall(call) {
  try {
    return {
      available: true,
      data: await call(),
    }
  } catch (error) {
    return {
      available: false,
      errorMessage: error instanceof Error ? error.message : '上下文采集失败',
    }
  }
}

export function createIncidentContextService({ tools }) {
  async function collect(error) {
    return {
      error,
      logs: await optionalCall(() =>
        tools.error.getErrorLogs({
          errorId: error.id,
          traceId: error.traceId,
        }),
      ),
      release: await optionalCall(() =>
        tools.error.getErrorRelease({
          errorId: error.id,
          release: error.release,
        }),
      ),
      trace: await optionalCall(() =>
        tools.error.getErrorTrace({
          errorId: error.id,
          traceId: error.traceId,
        }),
      ),
    }
  }

  return {
    collect,
  }
}
