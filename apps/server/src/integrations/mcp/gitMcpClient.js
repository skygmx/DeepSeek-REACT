function notConnected(toolName) {
  throw new Error(`Git MCP 未接入：${toolName}`)
}

export function createGitMcpClient() {
  return {
    async commitChanges() {
      notConnected('commitChanges')
    },
    async createBranch() {
      notConnected('createBranch')
    },
    async createPullRequest() {
      notConnected('createPullRequest')
    },
    async pushBranch() {
      notConnected('pushBranch')
    },
    async runVerificationPlan() {
      notConnected('runVerificationPlan')
    },
  }
}
