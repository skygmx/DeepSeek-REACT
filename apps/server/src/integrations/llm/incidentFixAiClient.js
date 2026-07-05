function notConnected(toolName) {
  throw new Error(`事故修复 AI 节点未接入：${toolName}`)
}

export function createIncidentFixAiClient() {
  return {
    async applyFix() {
      notConnected('applyFix')
    },
    async diagnoseAndPlan() {
      notConnected('diagnoseAndPlan')
    },
  }
}
