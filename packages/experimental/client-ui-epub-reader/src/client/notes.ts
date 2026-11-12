/**
 * Capture reading material into the Notes panel through its same-origin JSON API.
 *
 * The Notes panel (dsh-notes bundle) serves `/plugins/dsh-notes/api` from the
 * same Host webserver as this client, so plain relative fetches reach it. When
 * the panel is absent every call degrades to `false` and the reader carries on.
 *
 * @module @deepseek-ai/dsh-client-ui-epub-reader/client/notes
 */

/** The Notes panel's JSON API root. */
const NOTES_API = '/plugins/dsh-notes/api'

/** One note as the reading capture sends it. */
export interface NoteDraft {
  readonly title: string
  readonly body: string
}

/** Run one fetch against the Notes panel, resolving false on any failure. */
async function notesFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(NOTES_API + path, init)
  } catch {
    // Offline, blocked, or the panel is not installed.
    return null
  }
}

/** Whether the Notes panel is installed and answering. */
export async function notesReachable(): Promise<boolean> {
  const response = await notesFetch('/meta')
  return response !== null && response.ok
}

/** Append one note through the Notes panel. */
export async function saveNote(draft: NoteDraft): Promise<boolean> {
  const response = await notesFetch('/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: draft.title, body: draft.body }),
  })
  return response !== null && response.ok
}
