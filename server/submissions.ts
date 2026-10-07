import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export type SubmissionRecord = {
  type: 'contact' | 'order'
  receivedAt: string
  [key: string]: unknown
}

let writeQueue: Promise<void> = Promise.resolve()

export function saveSubmission(record: SubmissionRecord) {
  const filePath = process.env.SUBMISSIONS_FILE || path.join(process.cwd(), 'data', 'submissions.jsonl')
  const write = writeQueue.then(async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' })
  })
  writeQueue = write.catch(() => undefined)
  return write
}
