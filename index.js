/**
 * Host half of the practical-frontend bundle.
 *
 * It owns two durable records the browser half reads and writes:
 *  - the workspace → colour map behind the sidebar tint, and
 *  - the list of bookmarked conversation excerpts behind the 书签 panel.
 *
 * Both live beside the other plugin data under the Harness home, so they
 * survive a reload, a new GUI port, and a Desktop restart. The endpoints are
 * plain same-origin JSON routes on the existing web server; the browser half
 * never learns a filesystem path.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Same-origin endpoints shared with `client.js`. */
const COLOR_ROUTE = '/dsh-practical-frontend/project-colors'
const BOOKMARK_ROUTE = '/dsh-practical-frontend/bookmarks'

/** Upper bound for one colour-map request body. */
const MAX_COLOR_BODY_BYTES = 64 * 1024

/** Upper bound for one bookmark request body: one excerpt plus its metadata. */
const MAX_BOOKMARK_BODY_BYTES = 1024 * 1024

/** Only these writer fields are accepted from the browser. */
const MAX_WORKSPACES = 2000
const MAX_BOOKMARKS = 5000
const MAX_TEXT = 20000
const MAX_TITLE = 300
const MAX_NOTE = 2000
const MAX_SESSION_ID = 200
const MAX_WORKSPACE_ID = 200
const MAX_PATH = 1000
const MAX_ANCHOR_KEY = 200

/**
 * Resolve one record path the way the rest of the Harness resolves its home.
 *
 * @param file - file name inside this plugin's data directory.
 * @returns absolute path of the record.
 */
function stateFilePath(file) {
  const configured = process.env.DSH_HOME?.trim()
  const home = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), '.dsh')
  return join(home, 'plugin-data', 'dsh-practical-frontend', file)
}

/**
 * Keep only the shape the browser half understands: workspace id → palette id.
 *
 * @param value - whatever was on disk.
 * @returns a fresh record with string keys and string values.
 */
function normalizeRecord(value) {
  const record = {}
  if (value === null || typeof value !== 'object') return record
  const source = value.colors !== null && typeof value.colors === 'object' ? value.colors : value
  for (const [key, color] of Object.entries(source)) {
    if (key === 'colors' || typeof color !== 'string' || color.length > 32) continue
    record[key] = color
    if (Object.keys(record).length >= MAX_WORKSPACES) break
  }
  return record
}

/**
 * Keep one string field bounded and free of NUL.
 *
 * @param value - whatever the browser sent.
 * @param maximum - code-unit cap.
 * @returns the field, or an empty string when it has the wrong type.
 */
function stringField(value, maximum) {
  if (typeof value !== 'string') return ''
  return value.replaceAll('\u0000', '').slice(0, maximum)
}

/**
 * Read one trimmed string field.
 *
 * @param value - whatever the browser sent.
 * @param maximum - code-unit cap.
 * @returns the trimmed field, or an empty string.
 */
function trimmedField(value, maximum) {
  return stringField(value, maximum).trim()
}

/**
 * Keep one excerpt bounded by user-perceived characters so a long selection is
 * never cut through a surrogate pair.
 *
 * @param value - whatever the browser sent.
 * @param maximum - character cap.
 * @returns the excerpt.
 */
function clipText(value, maximum) {
  if (typeof value !== 'string') return ''
  const clean = value.replaceAll('\u0000', '')
  if (clean.length <= maximum) return clean
  return Array.from(clean).slice(0, maximum).join('')
}

/**
 * Read one finite timestamp.
 *
 * @param value - whatever was on disk.
 * @param fallback - value used when the field is not a usable timestamp.
 * @returns a whole millisecond timestamp.
 */
function timeField(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback
}

/**
 * Normalize one bookmarked excerpt.
 *
 * A bookmark without an id or any text is not meaningful and is dropped; the
 * Host never keeps a record it cannot show in the panel.
 *
 * @param value - one entry from disk or from a request.
 * @param now - clock used for missing timestamps.
 * @returns the normalized bookmark, or null when the entry is unusable.
 */
function normalizeBookmark(value, now) {
  if (value === null || typeof value !== 'object') return null
  const id = trimmedField(value.id, 120)
  const text = clipText(value.text, MAX_TEXT)
  if (id === '' || text.trim() === '') return null
  return {
    id,
    title: trimmedField(value.title, MAX_TITLE),
    text,
    note: trimmedField(value.note, MAX_NOTE),
    sessionId: trimmedField(value.sessionId, MAX_SESSION_ID),
    sessionTitle: trimmedField(value.sessionTitle, MAX_TITLE),
    workspaceId: trimmedField(value.workspaceId, MAX_WORKSPACE_ID),
    workspaceTitle: trimmedField(value.workspaceTitle, MAX_TITLE),
    workspacePath: trimmedField(value.workspacePath, MAX_PATH),
    role: trimmedField(value.role, 32),
    turn: Number.isSafeInteger(value.turn) && value.turn >= 0 ? value.turn : null,
    anchorStartKey: trimmedField(value.anchorStartKey, MAX_ANCHOR_KEY),
    anchorStartOffset: Number.isSafeInteger(value.anchorStartOffset) && value.anchorStartOffset >= 0
      ? value.anchorStartOffset
      : null,
    anchorEndKey: trimmedField(value.anchorEndKey, MAX_ANCHOR_KEY),
    anchorEndOffset: Number.isSafeInteger(value.anchorEndOffset) && value.anchorEndOffset >= 0
      ? value.anchorEndOffset
      : null,
    createdAt: timeField(value.createdAt, now),
    updatedAt: timeField(value.updatedAt, now),
  }
}

/**
 * Read a complete bookmark list, newest first.
 *
 * @param value - whatever was on disk.
 * @returns a fresh, bounded list without duplicate ids.
 */
function normalizeBookmarks(value, now = Date.now()) {
  const source = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray(value.bookmarks)
      ? value.bookmarks
      : []
  const seen = new Set()
  const bookmarks = []
  for (const entry of source) {
    const bookmark = normalizeBookmark(entry, now)
    if (bookmark === null || seen.has(bookmark.id)) continue
    seen.add(bookmark.id)
    bookmarks.push(bookmark)
    if (bookmarks.length >= MAX_BOOKMARKS) break
  }
  bookmarks.sort((left, right) => right.createdAt - left.createdAt)
  return bookmarks
}

/**
 * Read one JSON request body.
 *
 * @param request - incoming request.
 * @param maximum - body-size cap in bytes.
 * @returns the parsed body, or an empty object for an empty body.
 */
async function readJsonBody(request, maximum = MAX_COLOR_BODY_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > maximum) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/**
 * Write a JSON response.
 *
 * @param response - server response.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 */
function writeJson(response, status, body) {
  if (response.headersSent === true) {
    response.destroy?.()
    return
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

/**
 * Create one serialized atomic writer for a JSON record.
 *
 * Two rapid picks or saves cannot interleave because every write waits for the
 * previous one; a failed write is logged and leaves the previous file intact.
 *
 * @param file - absolute record path.
 * @param logger - Host logger, when available.
 * @param label - record name used in the warning.
 * @returns a function that writes one complete value.
 */
function createJsonWriter(file, logger, label) {
  let pending = Promise.resolve()
  return (value) => {
    pending = pending.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(temporary, file)
    }).catch((error) => {
      logger?.warn('practical-frontend: writing %s failed: %s', label, error?.message ?? error)
    })
    return pending
  }
}

/**
 * Mount the colour and bookmark endpoints once the web server exists.
 *
 * @param ctx - Host context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    const colorsFile = stateFilePath('workspace-colors.json')
    const bookmarksFile = stateFilePath('bookmarks.json')
    const writeColors = createJsonWriter(colorsFile, webCtx.logger, 'workspace colours')
    const writeBookmarks = createJsonWriter(bookmarksFile, webCtx.logger, 'bookmarks')

    const readRecord = async () => {
      try {
        return normalizeRecord(JSON.parse(await readFile(colorsFile, 'utf8')))
      } catch {
        return {}
      }
    }

    const readBookmarks = async () => {
      try {
        return normalizeBookmarks(JSON.parse(await readFile(bookmarksFile, 'utf8')))
      } catch {
        return []
      }
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: COLOR_ROUTE,
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            writeJson(response, 200, { colors: await readRecord() })
            return
          }
          if (request.method === 'POST') {
            const body = await readJsonBody(request, MAX_COLOR_BODY_BYTES)
            const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
            if (workspaceId === '' || workspaceId.length > MAX_WORKSPACE_ID) {
              writeJson(response, 400, { error: 'workspaceId is required' })
              return
            }
            const record = await readRecord()
            if (typeof body.color === 'string' && body.color !== '') record[workspaceId] = body.color
            else delete record[workspaceId]
            await writeColors({ version: 1, colors: record })
            writeJson(response, 200, { colors: record })
            return
          }
          writeJson(response, 405, { error: 'method not allowed' })
        } catch (error) {
          writeJson(response, 500, { error: String(error?.message ?? error) })
        }
      },
    }), 'practical-frontend: workspace colour endpoints')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: BOOKMARK_ROUTE,
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            writeJson(response, 200, { bookmarks: await readBookmarks() })
            return
          }
          if (request.method === 'POST') {
            const body = await readJsonBody(request, MAX_BOOKMARK_BODY_BYTES)
            const action = typeof body.action === 'string' ? body.action : 'save'
            const current = await readBookmarks()
            const now = Date.now()

            if (action === 'delete') {
              const id = trimmedField(body.id, 120)
              if (id === '') {
                writeJson(response, 400, { error: 'id is required' })
                return
              }
              const next = current.filter((bookmark) => bookmark.id !== id)
              await writeBookmarks({ version: 1, bookmarks: next })
              writeJson(response, 200, { bookmarks: next })
              return
            }

            if (action !== 'save') {
              writeJson(response, 400, { error: 'unknown action' })
              return
            }

            const incoming = body.bookmark
            if (incoming === null || typeof incoming !== 'object') {
              writeJson(response, 400, { error: 'bookmark is required' })
              return
            }
            const requestedId = trimmedField(incoming.id, 120)
            const existing = requestedId === ''
              ? undefined
              : current.find((bookmark) => bookmark.id === requestedId)
            // A client-supplied id is kept when it is new, which lets an
            // optimistic row survive the round trip; anything else gets a Host id.
            const id = existing !== undefined
              ? existing.id
              : requestedId !== '' && current.every((bookmark) => bookmark.id !== requestedId)
                ? requestedId
                : randomUUID()
            const normalized = normalizeBookmark({
              ...(existing ?? {}),
              ...incoming,
              id,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            }, now)
            if (normalized === null) {
              writeJson(response, 400, { error: 'bookmark text is required' })
              return
            }
            const next = [normalized, ...current.filter((bookmark) => bookmark.id !== normalized.id)]
            next.sort((left, right) => right.createdAt - left.createdAt)
            if (next.length > MAX_BOOKMARKS) next.length = MAX_BOOKMARKS
            await writeBookmarks({ version: 1, bookmarks: next })
            writeJson(response, 200, { bookmarks: next })
            return
          }
          writeJson(response, 405, { error: 'method not allowed' })
        } catch (error) {
          writeJson(response, 500, { error: String(error?.message ?? error) })
        }
      },
    }), 'practical-frontend: bookmark endpoints')
  })
}
