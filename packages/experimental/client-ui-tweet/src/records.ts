/**
 * Durable record vocabulary of the tweet store: zod schemas validating the
 * files inside `<workspace>/.dsh/tweet/` at the durable-file boundary.
 *
 * @module @deepseek-ai/dsh-client-ui-tweet/records
 */

import { z } from 'zod'
import type { TweetId, TweetMediaType } from './types.ts'

/** File extensions of the accepted media types, in the same order. */
export const OBJECT_EXTENSIONS: readonly string[] = ['png', 'jpeg', 'webp', 'gif']

/** Accepted media types as a readonly tuple for zod and validation. */
export const TWEET_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Content-addressed object name: 64 lowercase hex digits plus one accepted extension. */
export const OBJECT_NAME_PATTERN = /^[0-9a-f]{64}\.(?:png|jpeg|webp|gif)$/

/** Post identity shape: `tweet-` plus a UUID. */
const OPINION_ID_PATTERN = /^tweet-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const tweetIdSchema = z.string().regex(OPINION_ID_PATTERN).transform(value => value as TweetId)

/** Media type schema shared by records and publish validation. */
export const mediaTypeSchema = z.enum(TWEET_MEDIA_TYPES)

/** Durable shape of one stored image reference inside a post record. */
export const tweetImageRef = z.object({
  file: z.string().regex(OBJECT_NAME_PATTERN),
  mediaType: mediaTypeSchema,
  bytes: z.number().int().nonnegative(),
  name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/** Durable shape of one post record file under `posts/`. */
export const tweetRecord = z.object({
  id: tweetIdSchema,
  text: z.string(),
  images: z.array(tweetImageRef),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
})

/** One stored post record, inferred from {@link tweetRecord}. */
export type TweetRecord = z.infer<typeof tweetRecord>

/** Durable shape of `index.json`: publish order, newest first. */
export const tweetIndex = z.object({
  order: z.array(tweetIdSchema),
})

/** Stored index state, inferred from {@link tweetIndex}. */
export type TweetIndex = z.infer<typeof tweetIndex>

/**
 * Extension that stores one media type's object file.
 * @param mediaType - accepted media type.
 * @returns the object-file extension without the dot.
 */
export function extensionOf(mediaType: TweetMediaType): string {
  return mediaType.slice('image/'.length)
}

/**
 * Media type a stored object extension records.
 * @param extension - object-file extension without the dot.
 * @returns the matching media type, or undefined when the extension is not stored.
 */
export function mediaTypeOf(extension: string): TweetMediaType | undefined {
  return TWEET_MEDIA_TYPES.find(type => extensionOf(type) === extension)
}
