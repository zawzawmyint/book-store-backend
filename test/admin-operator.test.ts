import { expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { createAdminRepository } from '../src/modules/admin/admin.repository.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

it('grants and revokes only an existing account idempotently without creating users', () => {
  const db = createDatabase(':memory:')
  try {
    db.prepare(
      "INSERT INTO user (id, name, email) VALUES ('operator', 'Operator', 'operator@example.com'), ('customer', 'Customer', 'customer@example.com')",
    ).run()
    const repo = createAdminRepository(db)
    expect(repo.isAdmin('operator')).toBe(false)
    repo.setAdminAccess('operator', true)
    repo.setAdminAccess('operator', true)
    expect(repo.isAdmin('operator')).toBe(true)
    expect(repo.isAdmin('customer')).toBe(false)
    repo.setAdminAccess('operator', false)
    repo.setAdminAccess('operator', false)
    expect(repo.isAdmin('operator')).toBe(false)
    expect(() => repo.setAdminAccess('missing', true)).toThrow('User was not found')
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 2 })
    expect(() =>
      db.prepare("INSERT INTO admin_memberships (user_id) VALUES ('missing')").run(),
    ).toThrow(/FOREIGN KEY/)
    db.prepare("INSERT INTO admin_memberships (user_id) VALUES ('operator')").run()
    db.prepare("DELETE FROM user WHERE id = 'operator'").run()
    expect(repo.isAdmin('operator')).toBe(false)
  } finally {
    db.close()
  }
})

it('runs the operator command against only its configured database and rejects invalid arguments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'admin-command-'))
  const databasePath = join(directory, 'operator.sqlite')
  const db = createDatabase(databasePath)
  db.prepare(
    "INSERT INTO user (id, name, email) VALUES ('operator', 'Operator', 'operator@example.com')",
  ).run()
  db.close()
  const command = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/modules/admin/admin-access-cli.ts', ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          BETTER_AUTH_SECRET: 'operator-test-secret-at-least-thirty-two-characters',
          NODE_ENV: 'test',
        },
      },
    )
  try {
    expect(command('grant', 'operator').status).toBe(0)
    expect(command('grant', 'operator').status).toBe(0)
    const check = createDatabase(databasePath)
    expect(createAdminRepository(check).isAdmin('operator')).toBe(true)
    check.close()
    expect(command('revoke', 'operator').status).toBe(0)
    expect(command('grant', 'unknown').status).toBe(1)
    expect(command('bad', 'operator').status).toBe(1)
    expect(command('grant').status).toBe(1)
    expect(command('grant', 'operator', 'extra').status).toBe(1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20000)
