function notConnected(toolName) {
  throw new Error(`报错系统 MCP 未接入：${toolName}`)
}

export function createIncidentErrorMcpClient() {
  return {
    async getErrorDetail() {
      notConnected('getErrorDetail')
    },
    async getErrorLogs() {
      notConnected('getErrorLogs')
    },
    async getErrorRelease() {
      notConnected('getErrorRelease')
    },
    async getErrorTrace() {
      notConnected('getErrorTrace')
    },
    async listRecentErrors() {
      return []
    },
  }
}
