import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const load = name => parse(readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'));
function assertTrustedMetadataJobs(manager) {
    for (const job of Object.values(manager.jobs)) {
        for (const step of job.steps || []) {
            // Reading head.sha to attach a status is safe; checking it out is not.
            if (step.uses?.startsWith('actions/checkout@')) {
                assert.doesNotMatch(JSON.stringify(step.with || {}), /pull_request\.head|refs\/pull\//);
            }
            const commands = `${step.run || ''}\n${step.with?.script || ''}`;
            assert.doesNotMatch(commands, /\bnpm\s+(ci|install|run)\b|\bnpx\b/);
            assert.doesNotMatch(step.uses || '', /action-eslint/);
        }
    }
}

test('privileged PR metadata jobs never check out a PR head or run its package scripts', () => {
    const manager = load('pr-auto-manager.yml');
    assert.ok(manager.on.pull_request_target);
    assertTrustedMetadataJobs(manager);
});
test('PR lint runs with a read-only token, without persisted checkout credentials or secrets', () => {
    const lint = load('lint.yml');
    assert.ok(lint.on.pull_request);
    assert.equal(lint.on.pull_request_target, undefined);
    assert.equal(lint.on.workflow_run, undefined);
    assert.deepEqual(lint.permissions, { contents: 'read' });
    for (const job of Object.values(lint.jobs)) {
        assert.equal(job.permissions, undefined);
        for (const step of job.steps) {
            if (step.uses?.startsWith('actions/checkout@')) {
                assert.equal(step.with['persist-credentials'], false);
            }
        }
    }
    assert.doesNotMatch(JSON.stringify(lint), /secrets\./);
});
for (const ref of ['${{ github.event.pull_request.head.sha }}', 'refs/pull/7/head']) {
    test(`metadata guard rejects untrusted checkout: ${ref}`, () => {
        const manager = load('pr-auto-manager.yml');
        Object.values(manager.jobs)[0].steps.push({ uses: 'actions/checkout@v4', with: { ref } });
        assert.throws(() => assertTrustedMetadataJobs(manager));
    });
}
test('metadata guard rejects execution of package scripts', () => {
    const manager = load('pr-auto-manager.yml');
    Object.values(manager.jobs)[0].steps.push({ run: 'npm run test' });
    assert.throws(() => assertTrustedMetadataJobs(manager));
});
