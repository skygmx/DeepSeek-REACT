export function createWorkflowToolRegistry(tools) {
  return {
    ai: tools.ai,
    error: tools.error,
    git: tools.git,
    notify: tools.notify,
    repo: tools.repo,
  }
}
