import { isAbsolute, relative, resolve, sep } from 'node:path'

function assertStringPath(pathValue, fieldName) {
  if (pathValue === undefined || pathValue === null) return '.'
  if (typeof pathValue !== 'string') throw new Error(`${fieldName} 必须是字符串`)
  if (pathValue.includes('\0')) throw new Error(`${fieldName} 不合法`)
  return pathValue.trim() || '.'
}

export function createWorkspacePathResolver(rootDir = process.cwd()) {
  const workspaceRoot = resolve(rootDir)

  function assertInsideWorkspace(resolvedPath) {
    const relativePath = relative(workspaceRoot, resolvedPath)
    const isInside =
      relativePath === '' ||
      (!relativePath.startsWith('..') && !isAbsolute(relativePath))

    if (!isInside) {
      throw new Error('路径超出工作区范围')
    }
  }

  function resolvePath(pathValue = '.', fieldName = 'path') {
    const safePath = assertStringPath(pathValue, fieldName)
    const resolvedPath = resolve(workspaceRoot, safePath)
    assertInsideWorkspace(resolvedPath)
    return resolvedPath
  }

  function toRelativePath(pathValue) {
    const resolvedPath = resolvePath(pathValue)
    const relativePath = relative(workspaceRoot, resolvedPath)
    return relativePath.split(sep).join('/') || '.'
  }

  return {
    rootDir: workspaceRoot,
    resolvePath,
    toRelativePath,
  }
}
