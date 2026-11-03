/**
 * Private child process entry: load the native synthesizer, listen on loopback, then print
 * `{"port":N}` and a newline as the only stdout output. The Host passes the configuration and
 * model paths as JSON in `argv[2]` and the bearer secret in `DSH_SPEECH_TOKEN`, which is removed
 * from the environment once read. A failure before readiness writes only its message to stderr,
 * which the Host includes in the preparation error, and exits with code 1. After readiness the
 * loopback listener keeps the process alive until the Host terminates it.
 */
import { z } from 'zod'
import { Config } from './config.ts'
import { createSynthesizer } from './inference.ts'
import { startSynthesisServer } from './process-server.ts'

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(z.string().parse(process.argv[2]))
  const paths = z.object({ model: z.string().min(1), lexicon: z.string().min(1), tokens: z.string().min(1) }).parse(raw)
  const config = Object.assign(Config(z.record(z.string(), z.unknown()).parse(raw)), paths)
  const token = z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.DSH_SPEECH_TOKEN)
  delete process.env.DSH_SPEECH_TOKEN
  const { port } = await startSynthesisServer(token, config.maxTextBytes, createSynthesizer(config))
  process.stdout.write(`${JSON.stringify({ port })}\n`)
}

main().catch((error: unknown) => {
  // Exit once the message is flushed: a loaded native synthesizer would otherwise keep the process alive.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => { process.exit(1) })
})
