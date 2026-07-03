import { createHash, randomBytes } from 'node:crypto'
import { createCookie, parseCookies } from '../http/cookies.js'

const SESSION_COOKIE_NAME = 'deepseek_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

function toSessionPayload(row) {
  return {
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      role: row.workspace_role,
    },
  }
}

async function getPrimaryWorkspace(client, userId) {
  const result = await client.query(
    `
      SELECT
        w.id AS workspace_id,
        w.name AS workspace_name,
        wm.role AS workspace_role
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
        AND wm.status = 'active'
        AND w.status = 'active'
      ORDER BY wm.created_at ASC
      LIMIT 1
    `,
    [userId],
  )

  return result.rows[0] ?? null
}

async function createDefaultWorkspace(client, userId) {
  const workspaceResult = await client.query(
    `
      INSERT INTO workspaces (name, created_by_user_id)
      VALUES ($1, $2)
      RETURNING id, name
    `,
    ['我的工作区', userId],
  )
  const workspace = workspaceResult.rows[0]

  await client.query(
    `
      INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
      VALUES ($1, $2, 'owner', 'active', now())
    `,
    [workspace.id, userId],
  )

  return {
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    workspace_role: 'owner',
  }
}

async function createAnonymousUser(client) {
  const result = await client.query(
    `
      INSERT INTO users (display_name, metadata)
      VALUES ($1, $2::jsonb)
      RETURNING id, email, display_name, avatar_url
    `,
    ['匿名用户', JSON.stringify({ identityType: 'anonymous' })],
  )

  return result.rows[0]
}

async function insertSession(client, options) {
  await client.query(
    `
      INSERT INTO user_sessions (user_id, token_hash, user_agent, expires_at)
      VALUES (
        $1,
        $2,
        $3,
        now() + ($4::text || ' seconds')::interval
      )
    `,
    [
      options.userId,
      options.tokenHash,
      options.userAgent,
      SESSION_MAX_AGE_SECONDS,
    ],
  )
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    createCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'Lax',
    }),
  )
}

function createAnonymousPayload(user, workspace) {
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
    workspace: {
      id: workspace.workspace_id,
      name: workspace.workspace_name,
      role: workspace.workspace_role,
    },
  }
}

async function findSession(client, tokenHash) {
  const result = await client.query(
    `
      SELECT
        s.user_id,
        u.email,
        u.display_name,
        u.avatar_url,
        w.id AS workspace_id,
        w.name AS workspace_name,
        wm.role AS workspace_role
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      JOIN workspace_members wm ON wm.user_id = u.id
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND s.revoked_at IS NULL
        AND u.status = 'active'
        AND wm.status = 'active'
        AND w.status = 'active'
      ORDER BY wm.created_at ASC
      LIMIT 1
    `,
    [tokenHash],
  )

  return result.rows[0] ?? null
}

export function createSessionService({ pool }) {
  async function createAnonymousSession(req, res) {
    const token = createSessionToken()
    const tokenHash = hashToken(token)
    const userAgent = req.headers['user-agent'] ?? null
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const user = await createAnonymousUser(client)
      const workspace = await createDefaultWorkspace(client, user.id)

      await insertSession(client, {
        tokenHash,
        userAgent,
        userId: user.id,
      })
      await client.query('COMMIT')

      setSessionCookie(res, token)
      return createAnonymousPayload(user, workspace)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function getSession(req) {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[SESSION_COOKIE_NAME]
    if (!token) return null

    const tokenHash = hashToken(token)
    const client = await pool.connect()

    try {
      const row = await findSession(client, tokenHash)
      if (!row) return null

      await client.query(
        'UPDATE user_sessions SET last_seen_at = now() WHERE token_hash = $1',
        [tokenHash],
      )

      return toSessionPayload(row)
    } finally {
      client.release()
    }
  }

  async function getOrCreateSession(req, res) {
    const session = await getSession(req)
    if (session) return session

    return createAnonymousSession(req, res)
  }

  async function ensureWorkspace(req, res) {
    const session = await getOrCreateSession(req, res)
    const client = await pool.connect()

    try {
      const workspace = await getPrimaryWorkspace(client, session.user.id)
      if (workspace) {
        return {
          ...session,
          workspace: {
            id: workspace.workspace_id,
            name: workspace.workspace_name,
            role: workspace.workspace_role,
          },
        }
      }

      const createdWorkspace = await createDefaultWorkspace(client, session.user.id)
      return {
        ...session,
        workspace: {
          id: createdWorkspace.workspace_id,
          name: createdWorkspace.workspace_name,
          role: createdWorkspace.workspace_role,
        },
      }
    } finally {
      client.release()
    }
  }

  return {
    getSession,
    getOrCreateSession,
    ensureWorkspace,
  }
}
