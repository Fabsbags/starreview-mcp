import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync(
  new URL('../.circleci/config.yml', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

function job(name, nextName) {
  const start = config.indexOf(`\n  ${name}:\n`);
  const end = nextName
    ? config.indexOf(`\n  ${nextName}:\n`, start + 1)
    : config.indexOf('\nworkflows:\n', start + 1);
  assert.ok(start > -1, `missing ${name} job`);
  assert.ok(end > start, `could not find end of ${name} job`);
  return config.slice(start, end);
}

const candidate = job('candidate', 'publish');
const publish = job('publish', 'verify_registry');
const verifyRegistry = job('verify_registry');
const workflow = config.slice(config.indexOf('\nworkflows:\n'));

test('packs one candidate and tests that immutable tarball against an exact CLI SHA', () => {
  assert.equal(candidate.match(/^\s+npm pack \\$/gm)?.length, 1);
  assert.match(
    candidate,
    /CLI_SHA: "[0-9a-f]{40}"/,
  );
  assert.ok(candidate.includes('git -C /tmp/cli-consumer checkout --detach "$CLI_SHA"'));
  assert.ok(candidate.includes('merge-base --is-ancestor'));
  assert.ok(candidate.includes('/tmp/release-workspace/candidate/package.tgz'));
  assert.ok(candidate.includes('--ignore-scripts'));
  assert.ok(candidate.includes('ajv@8.20.0'));
  assert.ok(candidate.includes('ajv-formats@3.0.1'));
  assert.ok(candidate.includes('npm run test:contract'));

  const pack = candidate.indexOf('name: Pack and hash the exact candidate once');
  const testContract = candidate.indexOf('name: Test CLI requests against the exact candidate');
  const unchanged = candidate.indexOf('name: Verify the tested candidate is unchanged');
  const decision = candidate.indexOf('name: Decide publish or verified no-op');
  const persist = candidate.indexOf('persist_to_workspace');
  assert.ok(pack > -1 && pack < testContract);
  assert.ok(testContract < unchanged && unchanged < decision);
  assert.ok(decision < persist);
  assert.ok(candidate.includes('sha256sum --check package.tgz.sha256'));
});

test('binds the candidate to the exact current Fabsbags/starreview-mcp main commit', () => {
  assert.ok(candidate.includes('Fabsbags/starreview-mcp'));
  assert.ok(candidate.includes('"${CIRCLE_BRANCH:-}" != "main"'));
  assert.ok(candidate.includes('actual_sha="$(git rev-parse HEAD)"'));
  assert.ok(candidate.includes('"$actual_sha" != "$CIRCLE_SHA1"'));
  assert.ok(candidate.includes(
    '"+refs/heads/main:refs/remotes/origin/main"',
  ));
  assert.ok(candidate.includes('"$remote_main_sha" != "$CIRCLE_SHA1"'));
});

test('records a fail-closed publish or byte-identical no-op decision', () => {
  assert.ok(candidate.includes('name: Decide publish or verified no-op'));
  assert.ok(candidate.includes('npm view "$package_spec" version'));
  assert.ok(candidate.includes('npm pack "$package_spec"'));
  assert.ok(candidate.includes('"$actual_sha" != "$expected_sha"'));
  assert.ok(candidate.includes('decision="skip"'));
  assert.ok(candidate.includes('decision="publish"'));
  assert.ok(candidate.includes('grep -q \'E404\' "$registry_error"'));
  assert.ok(candidate.includes('"$release_dir/decision.txt"'));

  const publishDecision = publish.indexOf('decision="$(cat "$release_dir/decision.txt")"');
  const tokenRequest = publish.indexOf('circleci run oidc get');
  assert.ok(publishDecision > -1 && publishDecision < tokenRequest);
  assert.ok(publish.includes('skipping OIDC token request and npm publish'));
  assert.ok(verifyRegistry.includes('decision="$(cat "$release_dir/decision.txt")"'));
});

test('keeps the npm OIDC token inside the minimal artifact-only publish job', () => {
  assert.equal(
    config.match(/^\s+circleci run oidc get \\$/gm)?.length,
    1,
  );
  assert.equal(
    config.match(/^\s+NPM_ID_TOKEN="\$oidc_token" npm publish \\$/gm)?.length,
    1,
  );
  assert.ok(publish.includes(
    '--claims \'{"aud":"npm:registry.npmjs.org"}\'',
  ));
  assert.ok(!candidate.includes('circleci run oidc get'));
  assert.ok(!candidate.includes('NPM_ID_TOKEN='));
  assert.ok(!verifyRegistry.includes('circleci run oidc get'));
  assert.ok(!verifyRegistry.includes('NPM_ID_TOKEN='));

  assert.ok(!publish.includes('- checkout'));
  assert.ok(!publish.includes('/tmp/cli-consumer'));
  assert.ok(!publish.includes('npm install'));
  assert.ok(!publish.includes('npm run'));
  assert.ok(!publish.includes('npm pack'));
  assert.ok(publish.includes('sha256sum --check package.tgz.sha256'));
  assert.ok(publish.includes('git ls-remote'));
  assert.ok(publish.includes(
    'NPM_ID_TOKEN="$oidc_token" npm publish',
  ));
  assert.ok(publish.includes('--access public'));
  assert.ok(publish.includes('--ignore-scripts'));
  assert.ok(!publish.includes('--provenance'));
});

test('automatically publishes only protected main pushes with one context', () => {
  assert.ok(!workflow.includes('type: approval'));
  assert.ok(workflow.includes('serial-group: starreview-mcp/npm-publish'));
  assert.equal(
    workflow.match(
      /filters: pipeline\.git\.branch == "main" and pipeline\.config\.ref == "refs\/heads\/main" and pipeline\.event\.name == "push"/g,
    )?.length,
    3,
  );
  assert.equal(
    workflow.match(/^\s+- npm-trusted-publishing$/gm)?.length,
    1,
  );

  const publishInvocation = workflow.slice(
    workflow.indexOf('      - publish:'),
    workflow.indexOf('      - verify_registry:'),
  );
  assert.ok(publishInvocation.includes('context:'));
  assert.ok(publishInvocation.includes('- npm-trusted-publishing'));
  assert.match(publishInvocation, /requires:\n\s+- candidate/);
});

test('pins and checks the supported trusted-publishing runtime', () => {
  assert.ok(config.includes('image: cimg/node:24.18.0'));
  assert.ok(candidate.includes('Node.js >=22.14'));
  assert.ok(candidate.includes('npm >=11.5.1'));
  assert.ok(publish.includes('Node.js >=22.14'));
  assert.ok(publish.includes('npm >=11.5.1'));
  assert.ok(!config.includes('npm install --global'));
});

test('verifies registry bytes and exact package contents without publishing authority', () => {
  assert.ok(verifyRegistry.includes('attach_workspace'));
  assert.ok(!verifyRegistry.includes('- checkout'));
  assert.ok(!verifyRegistry.includes('npm-trusted-publishing'));
  assert.ok(!verifyRegistry.includes('npm publish'));
  assert.ok(verifyRegistry.includes('npm view "$package_spec" version'));
  assert.ok(verifyRegistry.includes('npm pack "$package_spec"'));
  assert.ok(verifyRegistry.includes('"$actual_sha" != "$expected_sha"'));
  assert.ok(verifyRegistry.includes('package/agent-contract.generated.json'));
  assert.ok(verifyRegistry.includes('/tmp/expected-registry-contents.txt'));
  assert.ok(verifyRegistry.includes('/tmp/actual-registry-contents.txt'));
  assert.ok(verifyRegistry.includes('diff --unified'));
});
