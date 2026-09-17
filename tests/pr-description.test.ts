import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  await readFile(new URL("../.github/workflows/pr-description.yml", import.meta.url), "utf8"),
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction(
  "github",
  "context",
  "core",
  workflow.jobs.describe.steps[0].with.script,
);
const markers = "<!-- auto-pr:start -->old<!-- auto-pr:end -->\n\n## Notes\nKeep my explanation.";
async function simulate(
  options: { body?: string; ref?: string; stale?: boolean; ci?: boolean } = {},
) {
  const pr = {
    number: 7,
    state: "open",
    body: options.body ?? markers,
    labels: [],
    base: { repo: { full_name: "owner/repo" } },
    head: { sha: "abc1234", ref: options.ref ?? "feature", repo: { full_name: "owner/repo" } },
  };
  const updates: { body: string }[] = [];
  const rest = {
    pulls: {
      get: async () => ({ data: pr }),
      listCommits: async () => [
        {
          sha: "abc1234",
          parents: [{}],
          commit: { message: "feat: add reports\n\n- Display throughput" },
        },
      ],
      update: async (value: { body: string }) => {
        updates.push(value);
      },
    },
    actions: {
      listWorkflowRuns: async () => ({
        data: {
          workflow_runs: options.ci
            ? [
                {
                  id: 1,
                  head_repository: { full_name: "owner/repo" },
                  conclusion: "failure",
                  html_url: "https://github.com/owner/repo/actions/runs/1",
                },
              ]
            : [],
        },
      }),
      listJobsForWorkflowRun: async () => [
        {
          name: "Test",
          conclusion: "failure",
          steps: [{ name: "Run npm run check", conclusion: "failure" }],
        },
      ],
    },
    repos: { listPullRequestsAssociatedWithCommit: async () => [{ number: 7 }] },
  };
  await execute(
    { rest, paginate: (method: () => Promise<unknown>) => method() },
    {
      repo: { owner: "owner", repo: "repo" },
      payload: options.stale ? { workflow_run: { head_sha: "old-head" } } : { pull_request: pr },
    },
    { warning: () => {} },
  );
  return updates;
}
test("PR description replaces only its marked section and reports actual CI failure", async () => {
  const updates = await simulate({ ci: true });
  assert.equal(updates.length, 1);
  assert.match(updates[0]?.body ?? "", /feat: add reports/);
  assert.match(updates[0]?.body ?? "", /Display throughput/);
  assert.match(updates[0]?.body ?? "", /npm run check: failure/);
  assert.match(updates[0]?.body ?? "", /## Notes\nKeep my explanation\.$/);
});
test("PR description reports pending CI without asserting validation passed", async () => {
  const updates = await simulate({ body: "Author's existing description" });
  assert.match(updates[0]?.body ?? "", /^Author's existing description/);
  assert.match(updates[0]?.body ?? "", /CI is pending/);
  assert.doesNotMatch(updates[0]?.body ?? "", /\[x\]/);
});
test("PR description skips stale runs, release PRs, and malformed markers", async () => {
  assert.deepEqual(await simulate({ stale: true }), []);
  assert.deepEqual(await simulate({ ref: "release-please--branches--main" }), []);
  assert.deepEqual(await simulate({ body: "<!-- auto-pr:start -->manual text" }), []);
});
