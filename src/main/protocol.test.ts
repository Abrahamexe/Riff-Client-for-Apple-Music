import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// protocol.ts Electron'un `net`/`protocol` nesnelerini içe aktarır; saf fonksiyon test edilir.
vi.mock('electron', () => ({ net: {}, protocol: {} }))
const { resolveAppFile } = await import('./protocol')

let base: string
let root: string
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'am-proto-'))
  root = join(base, 'renderer')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<html></html>')
  await writeFile(join(root, 'assets', 'app.js'), 'x')
  await mkdir(join(base, 'gizli'))
  await writeFile(join(base, 'gizli', 'secret.txt'), 'GIZLI')
  await writeFile(join(base, 'outside.txt'), 'DIŞARI')
  // Kök içinden dışarıyı gösteren junction (Windows'ta yönetici izni gerekmez).
  await symlink(join(base, 'gizli'), join(root, 'link'), 'junction')
})
afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('resolveAppFile (2.4: app:// path traversal)', () => {
  it.each([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/assets/app.js', join('assets', 'app.js')],
    ['/assets/./app.js', join('assets', 'app.js')],
    ['/assets/%61pp.js', join('assets', 'app.js')]
  ])('izin: %s', async (path, rel) => {
    const r = await resolveAppFile(root, path)
    expect(r).toEqual({
      file: expect.stringMatching(new RegExp(`${rel.replace(/[\\.]/g, '\\$&')}$`))
    })
  })

  it.each([
    ['/../outside.txt', 403],
    ['/assets/../../outside.txt', 403],
    ['/%2e%2e/outside.txt', 403],
    ['/%2E%2E%2Foutside.txt', 403],
    ['/..%5Coutside.txt', 403],
    ['/..%2f..%2fWindows%2fwin.ini', 403],
    ['/C:%5CWindows%5Cwin.ini', 403],
    ['/link/secret.txt', 403],
    ['/%00index.html', 400],
    ['/index.html%00.js', 400],
    ['/%E0%A4%A', 400],
    ['/yok.js', 404],
    ['/%252e%252e/outside.txt', 404]
  ])('red: %s → %i', async (path, status) => {
    expect(await resolveAppFile(root, path)).toEqual({ status })
  })
})
