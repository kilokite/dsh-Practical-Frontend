/**
 * Host half of the practical-frontend bundle.
 *
 * It owns one thing: the durable workspace → colour map the browser half reads
 * and writes. The record lives beside other plugin data under the Harness home,
 * so the tints survive a reload, a new GUI port, and a Desktop restart. The two
 * endpoints are plain same-origin JSON routes on the existing web server; the
 * browser half never learns a filesystem path.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Same-origin endpoint shared with `client.js`. */
const ROUTE = '/dsh-practical-frontend/project-colors'

/** Upper bound for one request body: a colour map write is tiny. */
const MAX_BODY_BYTES = 64 * 1024

/** Only these writer fields are accepted from the browser. */
const MAX_WORKSPACES = 2000

/**
 * Resolve the record path the way the rest of the Harness resolves its home.
 *
 * @returns absolute path of the colour record.
 */
function stateFilePath() {
  const configured = process.env.DSH_HOME?.trim()
  const home = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), '.dsh')
  return join(home, 'plugin-data', 'dsh-practical-frontend', 'workspace-colors.json')
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
 * Read one JSON request body.
 *
 * @param request - incoming request.
 * @returns the parsed body, or an empty object for an empty body.
 */
async function readJsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
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
 * Mount the colour endpoints once the web server exists.
 *
 * @param ctx - Host context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    const file = stateFilePath()
    /** Serialize writes so two rapid picks cannot interleave. */
    let pendingWrite = Promise.resolve()

    const readRecord = async () => {
      try {
        return normalizeRecord(JSON.parse(await readFile(file, 'utf8')))
      } catch {
        return {}
      }
    }

    const writeRecord = (record) => {
      pendingWrite = pendingWrite.then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const temporary = `${file}.${process.pid}.tmp`
        await writeFile(temporary, `${JSON.stringify({ version: 1, colors: record }, null, 2)}\n`, 'utf8')
        await rename(temporary, file)
      }).catch((error) => {
        webCtx.logger?.warn('practical-frontend: writing workspace colours failed: %s', error?.message ?? error)
      })
      return pendingWrite
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (request, response) => {
        try {
          if (request.method === 'GET') {
            writeJson(response, 200, { colors: await readRecord() })
            return
          }
          if (request.method === 'POST') {
            const body = await readJsonBody(request)
            const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
            if (workspaceId === '' || workspaceId.length > 200) {
              writeJson(response, 400, { error: 'workspaceId is required' })
              return
            }
            const record = await readRecord()
            if (typeof body.color === 'string' && body.color !== '') record[workspaceId] = body.color
            else delete record[workspaceId]
            await writeRecord(record)
            writeJson(response, 200, { colors: record })
            return
          }
          writeJson(response, 405, { error: 'method not allowed' })
        } catch (error) {
          writeJson(response, 500, { error: String(error?.message ?? error) })
        }
      },
    }), 'practical-frontend: workspace colour endpoints')
  })
}
