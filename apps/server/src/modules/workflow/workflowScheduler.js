export function createWorkflowScheduler(options) {
  let timer = null
  let running = false

  async function tick() {
    if (running) return
    running = true

    try {
      await options.onTick()
    } catch (error) {
      options.onError?.(error)
    } finally {
      running = false
    }
  }

  function start() {
    if (!options.enabled || timer) return
    timer = setInterval(() => {
      void tick()
    }, options.intervalMs)
  }

  function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return {
    start,
    stop,
    tick,
  }
}
