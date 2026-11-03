/** Download failure classification exposes safe categories without raw causes. */
import { expect, it } from 'vitest'
import { classifyDownloadFailure, SynthesisDownloadError } from '../src/download-error.ts'

it('classifies recognized network causes', () => {
  expect(classifyDownloadFailure(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toEqual({ reason: 'dns', code: 'ENOTFOUND' })
  expect(classifyDownloadFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toEqual({ reason: 'network', code: 'ECONNRESET' })
  expect(classifyDownloadFailure(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toEqual({ reason: 'storage', code: 'ENOSPC' })
  expect(classifyDownloadFailure(new Error('plain'))).toEqual({ reason: 'unknown' })
})

it('publishes only structured diagnostics', () => {
  const failure = new SynthesisDownloadError({ resource: 'model.onnx', source: 'https://hf-mirror.com', reason: 'http', status: 403 })
  expect(failure.download).toEqual({ resource: 'model.onnx', source: 'https://hf-mirror.com', reason: 'http', status: 403 })
  expect(failure.message).toContain('HTTP 403')
})
