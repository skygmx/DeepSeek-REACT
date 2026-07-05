export function createIncidentNotifyMcpClient() {
  return {
    async notifyOwner(options) {
      return {
        message: options.message,
        notified: false,
        owner: options.owner,
        reason: '通知 MCP 未接入',
      }
    },
  }
}
