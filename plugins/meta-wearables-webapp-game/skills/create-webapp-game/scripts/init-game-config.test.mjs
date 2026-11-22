/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./init-game.mjs', import.meta.url));
const AGENT_DIRECTORIES = ['.agents', '.claude', '.codex', '.cursor'];

function fixture(t) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'init-game-config-'));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  const target = path.join(temporaryDirectory, 'game');
  mkdirSync(target);
  return {
    target,
    write(relativePath, contents) {
      const destination = path.join(target, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, contents);
    },
    scaffold() {
      const result = spawnSync(process.execPath, [
        SCRIPT, '--dir', target, '--name', 'config-regression',
        '--title', 'Config Regression', '--skip-install',
      ], { encoding: 'utf8', timeout: 30_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(existsSync(path.join(target, 'src/core/Game.ts')));
      assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).name, 'config-regression');
      return JSON.parse(result.stdout);
    },
  };
}

test('keeps agent configuration and Git directories in place', (t) => {
  const { target, write, scaffold } = fixture(t);
  const expected = new Map();
  for (const directory of [...AGENT_DIRECTORIES, '.git']) {
    const relativePath = `${directory}/nested/settings.txt`;
    const contents = Buffer.from(`Original configuration for ${directory}\n`);
    expected.set(relativePath, contents);
    write(relativePath, contents);
  }

  const summary = scaffold();
  for (const [relativePath, contents] of expected) {
    assert.deepEqual(readFileSync(path.join(target, relativePath)), contents);
  }
  assert.deepEqual(summary.stashedToIncomingAssets, []);
  assert.equal(existsSync(path.join(target, '_incoming-assets')), false);
});

test('does not stamp or validate template tokens inside existing agent configuration', (t) => {
  const { target, write, scaffold } = fixture(t);
  const contents = Buffer.from('Keep REPLACE_WITH_GAME_NAME and REPLACE_WITH_GAME_TITLE literally.\n');
  for (const directory of AGENT_DIRECTORIES) write(`${directory}/nested/instructions.md`, contents);
  const binary = Buffer.from([0, 1, 2, 128, 255]);
  write('.codex/nested/state.bin', binary);

  const summary = scaffold();
  for (const directory of AGENT_DIRECTORIES) {
    assert.deepEqual(readFileSync(path.join(target, directory, 'nested/instructions.md')), contents);
  }
  assert.deepEqual(readFileSync(path.join(target, '.codex/nested/state.bin')), binary);
  assert.deepEqual(summary.stashedToIncomingAssets, []);
  assert.equal(summary.placeholdersRemaining, 0);
});

test('keeps a Git worktree pointer file intact', (t) => {
  const { target, write, scaffold } = fixture(t);
  const pointer = 'gitdir: /existing/repository/.git/worktrees/REPLACE_WITH_GAME_NAME\n';
  write('.git', pointer);

  const summary = scaffold();
  assert.equal(readFileSync(path.join(target, '.git'), 'utf8'), pointer);
  assert.deepEqual(summary.stashedToIncomingAssets, []);
});

test('continues stashing user assets while preserving agent configuration', (t) => {
  const { target, write, scaffold } = fixture(t);
  const asset = Buffer.from('<svg>REPLACE_WITH_GAME_TITLE</svg>\n');
  write('art/icon.svg', asset);
  write('notes.txt', 'Original project notes.\n');
  write('.cursor/rules/project.md', 'Original editor rules.\n');

  const summary = scaffold();
  assert.deepEqual(summary.stashedToIncomingAssets.sort(), ['art', 'notes.txt']);
  assert.deepEqual(readFileSync(path.join(target, '_incoming-assets/art/icon.svg')), asset);
  assert.equal(readFileSync(path.join(target, '_incoming-assets/notes.txt'), 'utf8'), 'Original project notes.\n');
  assert.equal(readFileSync(path.join(target, '.cursor/rules/project.md'), 'utf8'), 'Original editor rules.\n');
  assert.equal(existsSync(path.join(target, '_incoming-assets/.cursor')), false);
  assert.equal(existsSync(path.join(target, 'art')), false);
});
