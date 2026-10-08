import { expect, it } from 'vitest'
import { createDatabase } from '../src/database/connection.js'
import { createAdminRepository } from '../src/modules/admin/admin.repository.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { operatorActor } from '../src/modules/activity/activity.types.js'
it('grants and revokes only an existing account idempotently without creating users', async () => {
  const db = createDatabase(':memory:')
  try {
    db.prepare(
      "INSERT INTO user (id, name, email) VALUES ('operator', 'Operator', 'operator@example.com'), ('customer', 'Customer', 'customer@example.com')",
    ).run()
    const repo = createAdminRepository(db)
    expect(await repo.isAdmin('operator')).toBe(false)
    await repo.setAdminAccess('operator', true, operatorActor)
    await repo.setAdminAccess('operator', true, operatorActor)
    expect(await repo.isAdmin('operator')).toBe(true)
    expect(await repo.isAdmin('customer')).toBe(false)
    await repo.setAdminAccess('operator', false, operatorActor)
    await repo.setAdminAccess('operator', false, operatorActor)
    expect(await repo.isAdmin('operator')).toBe(false)
    await expect(repo.setAdminAccess('missing', true, operatorActor)).rejects.toThrow(
      'User was not found',
    )
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({
      n: 2,
    })
    expect(() =>
      db.prepare("INSERT INTO user_roles (user_id, role) VALUES ('missing', 'ADMIN')").run(),
    ).toThrow(/FOREIGN KEY/)
    db.prepare(
      "INSERT INTO user_roles (user_id, role) VALUES ('operator', 'ADMIN') ON CONFLICT(user_id) DO UPDATE SET role = 'ADMIN'",
    ).run()
    db.prepare("DELETE FROM user WHERE id = 'operator'").run()
    expect(await repo.isAdmin('operator')).toBe(false)
  } finally {
    db.close()
  }
})
it('runs the operator command against only its configured database and rejects invalid arguments', async () => {
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
    expect(await createAdminRepository(check).isAdmin('operator')).toBe(true)
    expect(
      check
        .prepare(
          'SELECT source,actor_user_id,actor_name,actor_role,action,target_id,changes_json FROM activity_events',
        )
        .all(),
    ).toEqual([
      {
        source: 'OPERATOR',
        actor_user_id: null,
        actor_name: 'Operator command',
        actor_role: null,
        action: 'USER_ROLE_CHANGED',
        target_id: 'operator',
        changes_json: JSON.stringify([
          {
            field: 'ROLE',
            before: 'CUSTOMER',
            after: 'ADMIN',
          },
        ]),
      },
    ])
    check.close()
    expect(command('revoke', 'operator').status).toBe(0)
    expect(command('grant', 'unknown').status).toBe(1)
    expect(command('bad', 'operator').status).toBe(1)
    expect(command('grant').status).toBe(1)
    expect(command('grant', 'operator', 'extra').status).toBe(1)
    const final = createDatabase(databasePath)
    try {
      expect(final.prepare('SELECT count(*) AS n FROM activity_events').get()).toEqual({
        n: 2,
      })
      expect(
        final.prepare('SELECT changes_json FROM activity_events ORDER BY id DESC LIMIT 1').get(),
      ).toEqual({
        changes_json: JSON.stringify([
          {
            field: 'ROLE',
            before: 'ADMIN',
            after: 'CUSTOMER',
          },
        ]),
      })
    } finally {
      final.close()
    }
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
}, 20000)
