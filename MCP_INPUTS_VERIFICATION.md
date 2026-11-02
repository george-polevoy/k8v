# Typed inline inputs: external MCP verification

Date: 2026-11-02. Consumer: external Codex CLI, `gpt-6.1-sol`, medium reasoning (user-approved replacement for unavailable `gpt-5.4`).

## Isolation and evidence

The consumer ran outside the repository, with a fresh Codex home exposing only the test MCP. Shell, unified execution, image viewing, apps, and the remote plugin catalog were disabled. Its prompt explicitly prohibited inspecting local files, source, runtime internals, or reverse-engineering k8v. The backend used an isolated in-memory database. No existing graphs were edited.

Evidence is retained locally in `tmp/typed-inline-inputs-verification/`: full MCP JSONL trace, final answer, prompt, and pre/post rate-limit snapshots. The required threshold command passed before every run. The visible active primary limit was 30% before and after the completed scenario; the secondary limit was unavailable and is not treated as zero.

## Observed usage

The completed consumer made **22 tool-call attempts**: one resource listing, one template listing, eight resource reads, one graph creation, nine `bulk_edit` calls, one `graph_get`, and one `graph_query`. Two read-tool attempts were blocked by the CLI before dispatch. It used no shell or file tools.

Sequence:

1. Discover resources/templates; read the command schema, overview, compact inline-input guide, node config schema, command schema twice more, and later two examples.
2. Create a disposable `autotests_typed_inputs_external_20261102` graph.
3. Attempt one batched inline-node creation, typed input updates, untyped input addition, and compute. Recover from an unsupported runtime and a duplicate-node retry by recreating the test node with the default runtime.
4. Verify initial computation, update numeric value and recompute, connect a boolean source and compute, disconnect and compute, clear/change input definitions, and inspect the persisted graph in a final compute response.

The observed results were `0`, empty string, `false`, and `2026-11-02T12:30:00Z`; amount then became `2.5`. Connected `true` overrode retained local `false`, and disconnection restored `false`. The extra port used `any`. The final saved graph had no title default, amount was `any` with no numeric editor, and its `2.5` value remained.

## Errors and implications

Five requests failed in the completed scenario:

- `runtime: "javascript"` was an incorrect consumer assumption; omitting runtime selected `javascript_vm`. The compute boundary had already flushed preceding mutations, so blindly retrying creation failed with a duplicate node. The compact guide now explicitly names runtime IDs and documents persistence across compute failures.
- `graph_get` and `graph_query` were blocked by the isolated CLI's approval policy. This was a harness configuration limitation: only `graph_create` and `bulk_edit` had explicit tool approvals. The consumer used returned command-response graphs for persistence verification. Automated API/contract coverage separately verifies `graph_query` with `nodeFields: ["id", "inputs"]`.
- An empty `bulk_edit` failed its nonempty-array validation. The guide now directs readback to `graph_get` and explains that a batch needs a command.

The generic command-schema resource was truncated in the consumer's context and was not parseable JSON. Repeated reads were inefficient. The dedicated `k8v://docs/inline-inputs.md` resource provides small, valid examples and the complete typed-input workflow without requiring that full schema. The remaining generic schema size is a follow-up; this verification does not claim it is solved.

Earlier startup attempts were also captured: `gpt-5.4` was rejected by the account, and the first replacement-model attempt stopped at the CLI approval gate before creating a graph. They are not counted in the 22-request completed scenario.

## Automated verification notes

Regression coverage includes schema/command validation, API persistence and query projection, actual JavaScript/Python computations, source precedence, duplicate-node copying, MCP command/resource contracts, and Playwright controls/reload/editing workflows. Unit test files run serially (`--test-concurrency=1`) to avoid contention in existing 50 ms timeout/retry tests. The native-module reuse test has a five-second execution budget because native loading can exceed a second; it still checks the same module reuse behavior and reports runtime errors in assertions. Dedicated timeout tests retain their limits. The full root command still runs every unit file and browser test.

Final verification: `npm run lint`, `npm run build`, and root `npm run test` all exited successfully. The full test run passed 312 unit tests and 52 browser tests across all 35 e2e files, with no failures or skips. Final command logs and the in-app-browser screenshot are retained with the local evidence.
