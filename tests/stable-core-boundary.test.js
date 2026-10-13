import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function importsFrom(filePath) {
  const source = fs.readFileSync(path.join(ROOT, filePath), 'utf8');
  return [...source.matchAll(/\bimport(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/gu)]
    .map(match => match[1]);
}

test('stable core boundaries keep domain modules away from Runtime, Store, and UI', () => {
  assert.equal(importsFrom('core/events.js').some(specifier => /(?:^|\/)runtime\//u.test(specifier) || /(?:^|\/)storage\//u.test(specifier)), false);
  assert.equal(importsFrom('story/time.js').some(specifier => /(?:^|\/)runtime\//u.test(specifier) || /(?:^|\/)storage\//u.test(specifier) || /(?:^|\/)ui\//u.test(specifier)), false);
});

test('consumer layers do not import the private Event Reconciliation implementation', () => {
  const consumerFiles = [
    'core/tracking.js',
    'core/tracking-window.js',
    'core/health-assessment.js',
    'core/health-evolution.js',
    'core/health-aggregation.js',
    'core/health-recovery-guidance.js',
    'core/projection.js',
    'core/projection-eligibility.js',
    'core/projection-timing.js',
    'ui/app.js',
    'ui/characters.js',
  ];
  for (const filePath of consumerFiles) {
    assert.equal(
      importsFrom(filePath).includes('../runtime/character-event-analysis.js'),
      false,
      `${filePath} must consume canonical Event/read-model outputs instead of Reconciliation internals`,
    );
  }
});
