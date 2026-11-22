/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const validators = [
  join(scripts, 'check-webapp.mjs'),
  resolve(scripts, '../../ai-glasses-webapp-publish/scripts/check-webapp.mjs'),
];
const projectFailure = 'package.json is missing the typecheck script';
const metadata = {
  viewport: '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  description: '<meta name="description" content="Check the weather for your next walk.">',
  capable: '<meta name="mrbd-web-app-capable" content="yes">',
  title: '<title>Walking weather</title>',
};

function checkMetadata(overrides) {
  const root = mkdtempSync(join(tmpdir(), 'wearables-metadata-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'index.html'), Object.values({...metadata, ...overrides}).join('\n'));
    // A known project-shape failure ends static validation before dependency installation.
    // Passing these assertions is deliberately not a full application quality-gate pass.
    writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {build: 'unused', preview: 'unused'}}));
    writeFileSync(join(root, 'package-lock.json'), '{}');
    writeFileSync(join(root, 'wearables.config.json'), JSON.stringify({ui: 'custom-explicit-opt-out'}));
    writeFileSync(join(root, 'vite.config.ts'), 'export default {};');
    writeFileSync(join(root, 'src/styles.css'), '#root { width: 600px; height: 600px; } body { display: grid; place-items: center; }');
    return validators.map(script => {
      const result = spawnSync(process.execPath, [script, root, '--static-only'], {
        encoding: 'utf8', timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.ok(report.failures.includes(projectFailure), 'fixture must reach static project validation');
      assert.equal(report.browser, null);
      assert.equal(report.bundleGzipBytes, null);
      return report.failures.filter(message => message !== projectFailure);
    });
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

for (const [name, overrides] of [
  ['the original metadata order', {}],
  ['reordered and additional attributes', {
    viewport: '<meta data-example="view > port" content="width=device-width, initial-scale=1" name="viewport">',
    description: '<meta content="Walking weather." data-test="summary" name="description">',
    capable: '<meta content="yes" data-test="glasses" name="mrbd-web-app-capable">',
  }],
  ['mixed case, attribute spacing, and single quotes', {
    viewport: "<META CONTENT = 'width=device-width, initial-scale=1.0' NAME = 'VIEWPORT' />",
    description: "<META DATA-EXTRA='extra' CONTENT = 'Walking weather.' NAME = 'DESCRIPTION'>",
    capable: "<META CONTENT = 'YES' NAME = 'MRBD-WEB-APP-CAPABLE'>",
  }],
  ['the other quotation mark and greater-than signs inside values', {
    description: '<meta name="description" content="Today\'s weather > yesterday\'s.">',
    capable: '<meta name="mrbd-web-app-capable" data-example="name=\'other\' content=\'no\' >" content="yes">',
  }],
  ['unquoted attribute values', {
    description: '<meta name=description content=Walking-weather>',
    capable: '<meta content=yes name=mrbd-web-app-capable>',
  }],
]) {
  test(`accepts ${name} in both gates`, () => {
    for (const failures of checkMetadata(overrides)) assert.deepEqual(failures, []);
  });
}

for (const [name, overrides, expected] of [
  ['missing viewport', {viewport: ''}, 'Viewport metadata must declare width=device-width and initial-scale=1'],
  ['incorrect viewport', {viewport: '<meta content="width=600, initial-scale=1" name="viewport">'}, 'Viewport metadata must declare width=device-width and initial-scale=1'],
  ['missing description', {description: ''}, 'Replace the placeholder meta description with app-specific copy'],
  ['blank description', {description: '<meta content="  " name="description">'}, 'Replace the placeholder meta description with app-specific copy'],
  ['placeholder description', {description: '<meta content="A web app for Meta Ray-Ban Display glasses." name="description">'}, 'Replace the placeholder meta description with app-specific copy'],
  ['missing capability marker', {capable: ''}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['incorrect capability value', {capable: '<meta content="no" name="mrbd-web-app-capable">'}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['a newline after the capability value', {capable: '<meta content="yes\n" name="mrbd-web-app-capable">'}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['data-name instead of name', {capable: '<meta data-name="mrbd-web-app-capable" content="yes">'}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['data-content instead of content', {capable: '<meta name="mrbd-web-app-capable" data-content="yes">'}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['attribute-like text inside another value', {capable: '<meta data-example="name=\'mrbd-web-app-capable\' content=\'yes\'">'}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['commented-out metadata', {capable: `<!-- ${metadata.capable} -->`}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['metadata-shaped text in a script', {capable: `<script type="text/plain">${metadata.capable}</script>`}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['metadata-shaped text in another tag attribute', {capable: `<div data-example='${metadata.capable}'></div>`}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['a later duplicate attribute overriding the first', {capable: '<meta name="mrbd-web-app-capable" content="no" content="yes">'}, 'Missing <meta name="mrbd-web-app-capable" content="yes">'],
  ['missing title', {title: ''}, 'Replace the placeholder document title'],
  ['placeholder title', {title: '<title>Meta Wearables App</title>'}, 'Replace the placeholder document title'],
]) {
  test(`rejects ${name} in both gates`, () => {
    for (const failures of checkMetadata(overrides)) assert.ok(failures.includes(expected), failures.join('\n'));
  });
}

test('test and publish metadata validation stay identical', () => {
  assert.deepEqual(readFileSync(validators[0]), readFileSync(validators[1]));
});
