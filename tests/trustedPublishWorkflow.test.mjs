import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/npm-publish.yml', import.meta.url),
  'utf8',
);

test('requires an exact CLI SHA and confines consumer code to the no-OIDC job', () => {
  assert.match(workflow, /cli_sha:[\s\S]*?required: true/);
  assert.ok(workflow.includes('^[0-9a-f]{40}$'));
  assert.ok(workflow.includes('ref: ${{ steps.guard.outputs.cli_sha }}'));
  assert.ok(workflow.includes('persist-credentials: false'));

  const candidate = workflow.slice(
    workflow.indexOf('  candidate:'),
    workflow.indexOf('\n  publish:'),
  );
  assert.ok(!candidate.includes('id-token: write'));
  assert.ok(!candidate.includes('npm publish'));
  assert.ok(candidate.includes('--ignore-scripts "$MCP_CANDIDATE"'));
  assert.ok(candidate.includes('ajv@8.20.0'));
  assert.ok(candidate.includes('ajv-formats@3.0.1'));
  assert.ok(candidate.includes('npm run test:contract'));
});

test('gives OIDC only to the artifact-only publish job', () => {
  const publish = workflow.slice(
    workflow.indexOf('\n  publish:'),
    workflow.indexOf('\n  verify_registry:'),
  );
  assert.equal(workflow.match(/id-token: write/g)?.length, 1);
  assert.ok(publish.includes('id-token: write'));
  assert.ok(!publish.includes('actions/checkout@'));
  assert.ok(!publish.includes('cli-consumer'));
  assert.ok(!publish.includes('npm install'));
  assert.ok(!publish.includes('npm run'));
  assert.ok(!publish.includes('npm pack'));
  assert.ok(!publish.includes('npm view'));
  assert.ok(publish.includes('sha256sum --check'));
  assert.ok(publish.includes(
    'npm publish "candidate/$MCP_FILENAME" --access public --provenance --ignore-scripts',
  ));
});

test('pins actions and enforces repository, main, Node, and npm release guards', () => {
  for (const line of workflow.split(/\r?\n/).filter((entry) => entry.includes('uses: '))) {
    assert.match(line, /uses: actions\/[a-z-]+@[0-9a-f]{40}$/);
  }
  assert.ok(workflow.includes('Fabsbags/starreview-mcp'));
  assert.ok(workflow.includes('refs/heads/main'));
  assert.ok(workflow.includes('node-version: 24'));
  assert.ok(!workflow.includes('npm install --global'));
  assert.ok(workflow.includes('Node.js >=22.14'));
  assert.ok(workflow.includes('npm >=11.5.1'));
});

test('verifies the published registry artifact without OIDC', () => {
  const verifyRegistry = workflow.slice(workflow.indexOf('\n  verify_registry:'));
  assert.ok(verifyRegistry.includes('- publish'));
  assert.ok(!verifyRegistry.includes('id-token: write'));
  assert.ok(!verifyRegistry.includes('actions/checkout@'));
  assert.ok(verifyRegistry.includes('npm view "$package_spec" version'));
  assert.ok(verifyRegistry.includes('npm pack "$package_spec"'));
  assert.ok(verifyRegistry.includes('actual_sha256'));
  assert.ok(verifyRegistry.includes('EXPECTED_SHA256'));
  assert.ok(verifyRegistry.includes('package/agent-contract.generated.json'));
  assert.ok(verifyRegistry.includes('diff --unified expected-contents.txt actual-contents.txt'));
});

test('hashes before the consumer and re-verifies before artifact handoff', () => {
  const pack = workflow.indexOf('name: Pack and hash candidate');
  const consumer = workflow.indexOf('name: Guard CLI requests satisfy the candidate contract');
  const unchanged = workflow.indexOf('name: Verify tested candidate is unchanged');
  const upload = workflow.indexOf('name: Upload exact tested candidate');
  const download = workflow.indexOf('name: Download tested candidate');
  const verify = workflow.indexOf('name: Verify exact artifact and SHA256');
  const publish = workflow.indexOf('name: Publish exact verified tarball');
  const registry = workflow.indexOf('name: Verify registry tarball bytes and contents');

  assert.ok(pack > -1 && pack < consumer);
  assert.ok(consumer < unchanged && unchanged < upload);
  assert.ok(upload < download && download < verify && verify < publish);
  assert.ok(publish < registry);
});
