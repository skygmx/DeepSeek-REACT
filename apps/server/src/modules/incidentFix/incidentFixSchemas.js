const statusValues = new Set(['needs_human', 'ready_to_patch'])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${fieldName} 必须是字符串数组`)
  }
}

function assertRequiredString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} 不能为空`)
  }
  return value.trim()
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function validateIncidentPlan(plan) {
  if (!isObject(plan)) throw new Error('修复计划必须是对象')
  if (typeof plan.summary !== 'string' || !plan.summary.trim()) {
    throw new Error('修复计划缺少 summary')
  }
  if (typeof plan.confidence !== 'number' || plan.confidence < 0 || plan.confidence > 1) {
    throw new Error('修复计划 confidence 必须在 0 到 1 之间')
  }
  if (plan.status && !statusValues.has(plan.status)) {
    throw new Error('修复计划 status 不支持')
  }

  assertStringArray(plan.suspectFiles ?? [], 'suspectFiles')
  assertStringArray(plan.verificationCommands ?? [], 'verificationCommands')

  return {
    confidence: plan.confidence,
    owner: plan.owner,
    promptVersion: optionalString(plan.promptVersion),
    status: plan.status ?? 'ready_to_patch',
    summary: plan.summary.trim(),
    suspectFiles: plan.suspectFiles ?? [],
    verificationCommands: plan.verificationCommands ?? [],
  }
}

export function validatePatchResult(result) {
  if (!isObject(result)) throw new Error('修复结果必须是对象')

  assertStringArray(result.changedFiles ?? [], 'changedFiles')

  return {
    applyPatchResult: result.applyPatchResult,
    changedFiles: result.changedFiles ?? [],
    commitMessage: assertRequiredString(result.commitMessage, 'commitMessage'),
    prBody: assertRequiredString(result.prBody, 'prBody'),
    promptVersion: optionalString(result.promptVersion),
    prTitle: assertRequiredString(result.prTitle, 'prTitle'),
  }
}
