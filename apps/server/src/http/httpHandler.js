export function createHttpHandler({ apiHandler, staticHandler }) {
  return async function handleHttpRequest(req, res) {
    const handledByApi = await apiHandler(req, res)
    if (handledByApi) return

    await staticHandler(req, res)
  }
}
