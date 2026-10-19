import express from 'express'
import cors from 'cors'
import { fromNodeHeaders } from 'better-auth/node'
import type { createAuth } from '../../auth.js'
import { normalizeStore, type DatabaseInput } from '../../database/persistence.js'
import { createPermissionGuard } from '../admin/admin.authorization.js'
import { createCoverRepository } from './cover.repository.js'
import { createCoverService } from './cover.service.js'
import { CoverError, coverKeyPattern, unavailable, type CoverStorage } from './cover.storage.js'
import { maxCoverBytes } from './cover.image.js'

export function mountCoverRoutes(
  app: express.Express,
  db: DatabaseInput,
  auth: ReturnType<typeof createAuth>,
  origin: string,
  storage: CoverStorage,
  mediaDirectory?: string,
) {
  const store = normalizeStore(db),
    guard = createPermissionGuard((id) => store.role(id))
  const service = createCoverService(createCoverRepository(db), storage)
  const route = express.Router({ mergeParams: true })
  route.use(
    cors({
      origin,
      credentials: true,
      methods: ['PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'If-Match'],
    }),
  )
  route.use(async (req, res, next) => {
    try {
      if (req.get('origin') !== origin) throw new CoverError(403, 'FORBIDDEN', 'Forbidden origin.')
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
        query: { disableCookieCache: true },
      })
      const user = await guard(session?.user.emailVerified ? session.user : null, 'MANAGE_CATALOG')
      res.locals.coverUser = user
      if (
        !/^[1-9]\d*$/.test(req.params.id as string) ||
        !Number.isSafeInteger(Number((req.params as { id: string }).id))
      )
        throw new CoverError(404, 'BOOK_NOT_FOUND', 'Book was not found.')
      const match = /^"(0|[1-9]\d*)"$/.exec(req.get('if-match') ?? '')
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= 2147483647)
        throw new CoverError(
          400,
          'INVALID_COVER_REVISION',
          'Reload the book before changing its cover.',
        )
      res.locals.coverRevision = Number(match[1])
      next()
    } catch (error) {
      next(error)
    }
  })
  route.put(
    '/',
    express.raw({ type: () => true, limit: maxCoverBytes }),
    async (req, res, next) => {
      try {
        const user = res.locals.coverUser
        res.setHeader('Cache-Control', 'no-store')
        res.json(
          await service.upload(
            Number((req.params as { id: string }).id),
            res.locals.coverRevision,
            Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
            req.get('content-type') ?? '',
            { source: 'HTTP', userId: user.id, name: user.name, role: await store.role(user.id) },
          ),
        )
      } catch (error) {
        next(error)
      }
    },
  )
  route.delete('/', async (req, res, next) => {
    try {
      const user = res.locals.coverUser
      res.setHeader('Cache-Control', 'no-store')
      res.json(
        await service.remove(Number((req.params as { id: string }).id), res.locals.coverRevision, {
          source: 'HTTP',
          userId: user.id,
          name: user.name,
          role: await store.role(user.id),
        }),
      )
    } catch (error) {
      next(error)
    }
  })
  route.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const detail = error as { type?: string; extensions?: { code?: string } }
      const code = detail?.extensions?.code
      const failure =
        error instanceof CoverError
          ? error
          : detail?.type === 'entity.too.large'
            ? new CoverError(413, 'COVER_TOO_LARGE', 'Choose an image no larger than 5 MiB.')
            : code === 'UNAUTHENTICATED' || code === 'FORBIDDEN'
              ? new CoverError(
                  code === 'UNAUTHENTICATED' ? 401 : 403,
                  code,
                  code === 'UNAUTHENTICATED'
                    ? 'Sign in to continue.'
                    : 'Catalog permission is required.',
                )
              : unavailable()
      res.setHeader('Cache-Control', 'no-store')
      res.status(failure.status).json({ error: { code: failure.code, message: failure.message } })
    },
  )
  app.use('/api/books/:id/cover', route)
  if (mediaDirectory)
    app.use(
      '/media/covers',
      (req, res, next) => {
        if (
          !['GET', 'HEAD'].includes(req.method) ||
          !coverKeyPattern.test(`covers/${req.path.slice(1)}`)
        ) {
          res.sendStatus(404)
          return
        }
        next()
      },
      express.static(mediaDirectory, {
        dotfiles: 'deny',
        index: false,
        immutable: true,
        maxAge: '1y',
        setHeaders(res) {
          res.setHeader('X-Content-Type-Options', 'nosniff')
        },
      }),
    )
}
