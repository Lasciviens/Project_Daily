#!/usr/bin/env node
// Compiles the kitchen scale's weighing logic (firmware/kitchen-scale/lib/scale_core)
// with the computer's own C++ compiler and runs its checks
// (firmware/kitchen-scale/test/scale_core_test.cpp).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fw = join(root, 'firmware/kitchen-scale')
const dir = mkdtempSync(join(tmpdir(), 'scale-core-'))
const exe = join(dir, 'scale_core_test')

try {
  execFileSync('c++', [
    '-std=c++17', '-Wall', '-Wextra', '-Werror',
    '-I', join(fw, 'lib/scale_core'),
    join(fw, 'lib/scale_core/scale_core.cpp'),
    join(fw, 'test/scale_core_test.cpp'),
    '-o', exe,
  ], { stdio: 'inherit' })
  execFileSync(exe, { stdio: 'inherit' })
} catch (e) {
  if (e.code === 'ENOENT') console.log('No C++ compiler (c++) found; on a Mac run `xcode-select --install`.')
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
