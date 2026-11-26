/**
 * File-backed tweet store under one admitted data root
 * `<workspace>/.dsh/tweet/`: per-post records (text, images, and the post's
 * comments) in `posts/`, content-addressed image bytes in `objects/`, and
 * publish order in `index.json`. Every mutation is serialized per root and
 * every file replace is write-temp-then-rename, so a crashed process never
 * leaves a torn file.
 *
 * A post file missing from `index.json` (a crash between its two writes)
 * still lists: reads treat the directory as the source of truth and the index
 * only as the same-millisecond tiebreak, so orphaned posts heal into view.
 *
 * @module @deepseek-ai/dsh-client-ui-tweet/store
 */

import { createHash, randomUUID } from 'node:crypto'
import { rename, readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { brandString } from '@deepseek-ai/dsh-brand'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { TweetCommentId, TweetId, TweetMediaType } from './types.ts'
import { extensionOf, mediaTypeOf, tweetIndex, tweetRecord } from './records.ts'
import type { TweetRecord } from './records.ts'
import { admitDataFile, admitObjectName } from './paths.ts'

/** One image whose bytes the store commits as a content-addressed object. */
export interface StoreImageInput {
  readonly mediaType: TweetMediaType
  readonly bytes: Buffer
  readonly name?: string
  readonly width?: number
  readonly height?: number
}

/** What one store commit creates. */
export interface StorePostInput {
  readonly text: string
  readonly images: readonly StoreImageInput[]
  readonly now: number
}

/** Per-root write chains: every mutation of one root runs after the previous. */
const chains = new Map<string, Promise<unknown>>()

/** Run `task` after every earlier mutation of the same root. */
function serialized<T>(root: string, task: () => Promise<T>): Promise<T> {
  const run = chains.get(root) ?? Promise.resolve()
  const next = run.then(task, task)
  chains.set(root, next.catch(() => {}))
  return next
}

/** Replace one file atomically: write a sibling temp file, then rename over the target. */
async function writeFileAtomic(absolute: string, content: string): Promise<void> {
  const temp = `${absolute}.tmp-${randomUUID()}`
  await writeFile(temp, content, 'utf8')
  await rename(temp, absolute)
}

/** Replace one binary file atomically; renaming over an identical object is a no-op byte-wise. */
async function writeBytesAtomic(absolute: string, bytes: Buffer): Promise<void> {
  const temp = `${absolute}.tmp-${randomUUID()}`
  await writeFile(temp, bytes)
  await rename(temp, absolute)
}

/** Read and validate one JSON file as a post record; `undefined` marks an unreadable or invalid file. */
async function readPostRecord(absolute: string): Promise<TweetRecord | undefined> {
  let text: string
  try {
    text = await readFile(absolute, 'utf8')
  } catch (error) {
    // A missing or unreadable file lists no post; deletion or an external mover owns the file.
    void error
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    // A malformed file lists no post; the file stays on disk for manual repair.
    void error
    return undefined
  }
  const parsed = tweetRecord.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Read the publish order; a missing index is an empty store. */
async function readOrder(root: string): Promise<TweetId[]> {
  let text: string
  try {
    text = await readFile(join(root, 'index.json'), 'utf8')
  } catch {
    return []
  }
  const parsed = tweetIndex.safeParse(JSON.parse(text))
  if (!parsed.success) {
    throw new RemoteError(
      'tweet/corrupt-store',
      `index.json is not a valid tweet index: ${parsed.error.message}`,
      { path: 'index.json', reason: parsed.error.message },
    )
  }
  return parsed.data.order
}

/** Persist the publish order atomically. */
async function writeOrder(root: string, order: readonly TweetId[]): Promise<void> {
  await writeFileAtomic(join(root, 'index.json'), `${JSON.stringify({ order })}\n`)
}

/** Every post record on disk, keyed by id; invalid files are skipped and kept. */
async function readAllPosts(root: string): Promise<Map<TweetId, TweetRecord>> {
  const posts = new Map<TweetId, TweetRecord>()
  let entries: readonly string[]
  try {
    entries = await readdir(join(root, 'posts'))
  } catch {
    return posts
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const record = await readPostRecord(join(root, 'posts', entry))
    if (record !== undefined) posts.set(record.id, record)
  }
  return posts
}

/** Ensure the data-root directories exist. */
async function ensureLayout(root: string): Promise<void> {
  await mkdir(join(root, 'posts'), { recursive: true })
  await mkdir(join(root, 'objects'), { recursive: true })
}

/** Write one image's bytes as a content-addressed object; an identical object is rewritten byte-for-byte. */
async function writeObject(root: string, mediaType: TweetMediaType, bytes: Buffer): Promise<string> {
  const digest = createHash('sha256').update(bytes).digest('hex')
  const file = `${digest}.${extensionOf(mediaType)}`
  const absolute = admitDataFile(root, `objects/${admitObjectName(file)}`)
  await writeBytesAtomic(absolute, bytes)
  return file
}

/**
 * List every post of one data root, newest first: `createdAt` descending,
 * same-millisecond posts in publish-order position.
 * @param root - admitted data root.
 * @returns the posts in feed order.
 * @throws {RemoteError} `tweet/corrupt-store` when `index.json` is invalid.
 */
export async function listPosts(root: string): Promise<TweetRecord[]> {
  const [order, posts] = await Promise.all([readOrder(root), readAllPosts(root)])
  const position = new Map(order.map((id, index) => [id, index]))
  return [...posts.values()].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
    return (position.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  })
}

/**
 * Commit one post: store its images as content-addressed objects, write the
 * post record, and prepend the publish order.
 * @param root - admitted data root.
 * @param input - post text, image bytes, and the publish instant.
 * @returns the created record.
 */
export function createPost(root: string, input: StorePostInput): Promise<TweetRecord> {
  return serialized(root, async () => {
    try {
      await ensureLayout(root)
      const images = []
      for (const image of input.images) {
        const file = await writeObject(root, image.mediaType, image.bytes)
        images.push({
          file,
          mediaType: image.mediaType,
          bytes: image.bytes.byteLength,
          ...(image.name === undefined ? {} : { name: image.name }),
          ...(image.width === undefined ? {} : { width: image.width }),
          ...(image.height === undefined ? {} : { height: image.height }),
        })
      }
      const record: TweetRecord = {
        id: brandString<TweetId>(`tweet-${randomUUID()}`),
        text: input.text,
        images,
        comments: [],
        createdAt: input.now,
      }
      await writeFileAtomic(admitDataFile(root, `posts/${record.id}.json`), `${JSON.stringify(record)}\n`)
      const order = await readOrder(root)
      await writeOrder(root, [record.id, ...order.filter(existing => existing !== record.id)])
      return record
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'tweet/corrupt-store',
        `failed to publish into '${root}': ${error instanceof Error ? error.message : String(error)}`,
        { path: root, reason: 'write failed' },
      )
    }
  })
}

/**
 * Replace one post's text; the publish order and images stay unchanged.
 * @param root - admitted data root.
 * @param id - post identity.
 * @param text - replacement text.
 * @param now - edit instant.
 * @returns the updated record.
 * @throws {RemoteError} `tweet/post-not-found` when no record file exists.
 */
export function editPost(root: string, id: TweetId, text: string, now: number): Promise<TweetRecord> {
  return serialized(root, async () => {
    const absolute = admitDataFile(root, `posts/${id}.json`)
    const record = await readPostRecord(absolute)
    if (record === undefined) {
      throw new RemoteError('tweet/post-not-found', `post '${id}' not found`, { id })
    }
    const next: TweetRecord = { ...record, text, updatedAt: now }
    await writeFileAtomic(absolute, `${JSON.stringify(next)}\n`)
    return next
  })
}

/**
 * Append one comment under a post: the record's comment list grows by one,
 * with no count limit, and the whole record is replaced atomically.
 * @param root - admitted data root.
 * @param id - post identity.
 * @param text - comment text, already trimmed and non-empty.
 * @param now - comment instant.
 * @returns the updated record.
 * @throws {RemoteError} `tweet/post-not-found` when no record file exists.
 */
export function addComment(root: string, id: TweetId, text: string, now: number): Promise<TweetRecord> {
  return serialized(root, async () => {
    const absolute = admitDataFile(root, `posts/${id}.json`)
    const record = await readPostRecord(absolute)
    if (record === undefined) {
      throw new RemoteError('tweet/post-not-found', `post '${id}' not found`, { id })
    }
    const next: TweetRecord = {
      ...record,
      comments: [...record.comments, { id: brandString<TweetCommentId>(`comment-${randomUUID()}`), text, createdAt: now }],
    }
    await writeFileAtomic(absolute, `${JSON.stringify(next)}\n`)
    return next
  })
}

/**
 * Delete one post and its publish-order entry. Idempotent.
 * @param root - admitted data root.
 * @param id - post identity.
 * @returns whether a record file was deleted.
 */
export function deletePost(root: string, id: TweetId): Promise<boolean> {
  return serialized(root, async () => {
    const absolute = admitDataFile(root, `posts/${id}.json`)
    try {
      await unlink(absolute)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new RemoteError(
          'tweet/corrupt-store',
          `failed to delete post '${id}': ${error instanceof Error ? error.message : String(error)}`,
          { path: `posts/${id}.json`, reason: 'delete failed' },
        )
      }
      return false
    }
    const order = (await readOrder(root)).filter(existing => existing !== id)
    await writeOrder(root, order)
    return true
  })
}

/**
 * Read one stored image object's bytes and recorded media type.
 * @param root - admitted data root.
 * @param file - content-addressed object name.
 * @returns the media type and exact bytes.
 * @throws {RemoteError} `tweet/corrupt-store` when the object is missing or unreadable.
 */
export async function readObject(root: string, file: string): Promise<{ mediaType: TweetMediaType; bytes: Buffer }> {
  const mediaType = mediaTypeOf(file.slice(file.lastIndexOf('.') + 1))
  if (mediaType === undefined) {
    throw new RemoteError('tweet/invalid-object-name', `'${file}' is not a stored object name`, { file })
  }
  const absolute = admitDataFile(root, `objects/${admitObjectName(file)}`)
  try {
    return { mediaType, bytes: await readFile(absolute) }
  } catch (error) {
    throw new RemoteError(
      'tweet/corrupt-store',
      `failed to read image object '${file}': ${error instanceof Error ? error.message : String(error)}`,
      { path: `objects/${file}`, reason: 'read failed' },
    )
  }
}
