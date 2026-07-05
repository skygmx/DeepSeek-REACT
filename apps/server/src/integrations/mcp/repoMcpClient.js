function notConnected(toolName) {
  throw new Error(`代码仓库 MCP 未接入：${toolName}`)
}

export function createRepoMcpClient() {
  return {
    async findReferences() {
      notConnected('findReferences')
    },
    async gitDiff() {
      notConnected('gitDiff')
    },
    async gitLog() {
      notConnected('gitLog')
    },
    async listFiles() {
      notConnected('listFiles')
    },
    async readFile() {
      notConnected('readFile')
    },
    async search() {
      notConnected('search')
    },
  }
}
