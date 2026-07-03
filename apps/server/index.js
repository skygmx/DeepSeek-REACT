import { createServerRuntime } from './src/app/createServerRuntime.js'

const runtime = createServerRuntime()

runtime.listen()

process.once('SIGINT', () => {
  void runtime.shutdown().finally(() => process.exit(0))
})

process.once('SIGTERM', () => {
  void runtime.shutdown().finally(() => process.exit(0))
})
