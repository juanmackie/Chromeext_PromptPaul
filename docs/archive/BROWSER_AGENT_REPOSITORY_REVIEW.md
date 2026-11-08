# Browser-Agent Repository Review

**Review date:** 2026-08-20  
**Scope:** Prompt Paul Chrome extension only  
**Deliverable:** Review and ranked recommendations. The review phase was advisory; the four recommendations below were later implemented and verified in Prompt Paul. The focused Act security and license closeout is recorded in [ACT_SECURITY_LICENSE_REVIEW.md](ACT_SECURITY_LICENSE_REVIEW.md).

## Executive result

Prompt Paul already has the main safety controls found in these projects: bounded semantic page state, forced inspection, stale-target checks, repeated-action blocking, action budgets, approval gates, owned-tab limits, prompt-injection labels, sensitive-field masking, abort handling, and browser tests.

The best next improvement is not a new browser engine or more actions. It is a stronger answer to this question:

> Did the requested action happen, and what evidence supports that answer?

Adopt these ideas in this order, as clean-room designs inside existing Prompt Paul modules:

1. **Verified action receipts.** Return `not_delivered`, `delivered_unverified`, or `delivered_verified`, with small action-specific evidence. Do not retry an unverified mutation automatically.
2. **Local manual-intervention checkpoints.** Pause the run for CAPTCHA, SSO, hardware-key, or other user-only work. Require explicit Resume and a new page inspection. Do not collect secrets in chat.
3. **A browser-task evaluation corpus.** Test correct completion, false success, duplicate mutations, recovery, prompt size, and action count before adding more capability.
4. **Progressive scoped or diff snapshots.** First measure this in the test harness. Use model-safe indexed regions, not model-supplied selectors.

Do not copy an upstream runtime, browser daemon, Chromium fork, arbitrary JavaScript path, network recorder, CAPTCHA solver, or multi-agent workforce layer.

## Implementation status

| Recommendation                     | Current Prompt Paul status                                                                                                                                              | Verification                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Verified action receipts           | Implemented in the orchestrator and content-script action results. Receipts include bounded action-specific evidence and block unchanged unverified retries.            | Unit behavior tests and real-browser evaluation cases for verified input, false success, and repeated mutation.                       |
| Local manual intervention          | Implemented through `page_pause_for_user`, explicit Resume, snapshot invalidation, fresh inspection, policy checks, secret filtering, and abort cleanup.                | Orchestrator behavior tests and real-browser pause/resume coverage.                                                                   |
| Browser-task evaluation corpus     | Implemented as a 15-case credential-free corpus. Browser-safe cases run against local fixtures; API/Codex/Hermes and restricted-page boundaries run in the unit matrix. | `npm run test:browser` and behavior tests record bounded results, receipts, evidence, failure codes, action counts, and prompt sizes. |
| Progressive scope/diff measurement | Implemented as a bounded runtime `scopeDiff` result plus browser-harness measurement over indexed semantic regions and live snapshots.                                  | Unit and real-browser evaluation proves bounded, selector-free diffs and non-empty changes.                                           |

The implementation keeps the original safety decisions: no model-supplied selectors, arbitrary JavaScript, CDP/debugger access, network capture, remote browser sessions, stored raw browsing memory, or Hermes page actions.

## Current Prompt Paul baseline

The review compared upstream ideas with the current implementation, not with the earlier Page-Agent adoption plan.

- `RunOrchestrator.js` owns the page-action loop, forced initial inspection, snapshot checks, action budgets, approvals, abort handling, event journals, and repeated-mutation protection.
- `pageDom.js` creates bounded semantic snapshots and deterministic page-state hashes.
- `pageActionPolicy.js` owns validation, risk classification, origin gates, and hard blocks.
- `PageTabController.js` limits runs to owned tabs and prevents source-tab closure.
- `content_script_unified.js` re-identifies targets, waits for settled state, checks occlusion, executes actions, and returns fresh state.
- Existing unit and browser tests cover orchestration, DOM state, policy, tab ownership, and page actions.

These controls are reuse points. They are not gaps to reimplement under new names.

## Ranked recommendations

### 1. Add verified action receipts

**Why:** An altered page hash does not prove that the intended action happened. A click can open the wrong menu. A form write can be rejected. A browser API can report success while the page did nothing.

**Pattern:** `agent-desktop` reports delivery disposition and every attempted step. Its source distinguishes not delivered, delivered but unverified, and delivered and verified. It also validates post-state for actions such as clear. See [`ActionResult`](https://github.com/lahfir/agent-desktop/blob/ab7606185463e8ac0197c952e23df16ff2a00954/crates/core/src/action_result.rs), [`DeliveryDisposition`](https://github.com/lahfir/agent-desktop/blob/ab7606185463e8ac0197c952e23df16ff2a00954/crates/core/src/delivery_disposition.rs), and [`chain_verify`](https://github.com/lahfir/agent-desktop/blob/ab7606185463e8ac0197c952e23df16ff2a00954/crates/macos/src/actions/chain_verify.rs).

**Prompt Paul adaptation:** Extend the existing page-action result and activity card. Keep the result bounded and action-specific:

- `not_delivered`: no supported effect was observed.
- `delivered_unverified`: the action was attempted or partial change was observed, but the requested outcome was not proven.
- `delivered_verified`: the requested postcondition was observed.

Use existing fresh snapshots, target checks, policy, journals, and abort paths. For a type action, verify the permitted field value. For a click, verify a declared safe postcondition such as a visible non-sensitive state change or navigation. If no safe postcondition exists, report unverified.

**Safety rule:** Never blindly retry `delivered_unverified` state-changing actions. Ask for approval or stop. A second click can submit a form or repeat a purchase.

**Disposition:** Implemented as a clean-room adaptation; the focused security review is complete. Future direct reuse still needs a separate review.

### 2. Add a local manual-intervention checkpoint

**Why:** Some steps require the user. CAPTCHA, SSO, hardware keys, consent decisions, and ambiguous visual judgment should not become secret collection or hidden automation.

**Evidence:** BrowserAct declares user confirmation for sensitive operations and supports headed human-agent collaboration in its skill metadata and discovery skill. See [`browser-act/SKILL.md`](https://github.com/browser-act/skills/blob/8f287271faa0c1df79a44578cb059102ff004da2/browser-act/SKILL.md). Skyvern documents explicit completion and termination criteria, validation, and recovery after failed steps. See its [reliability guide](https://github.com/Skyvern-AI/skyvern/blob/98dbe907fff1641b2020e6a7b1042a175e4711bc/docs/developers/going-to-production/reliability-tips.mdx). qpilot has run states for waiting, paused, and resumed, with a pause gate and user questions in [`lib/store.ts`](https://github.com/broxhq/qpilot/blob/60d6c7ef8dcc58c8c0fa35800123401cb8751124/lib/store.ts).

**Prompt Paul adaptation:** Pause the local run. Show the user why it is paused and which tab is active. Let the user act in that tab. Invalidate the old snapshot. Require an explicit Resume control. Resume only after a fresh inspection and policy evaluation.

The checkpoint must not bypass policy. It must not route a prohibited purchase, destructive operation, credential change, or security action to the user as a workaround. Do not accept passwords, OTPs, recovery codes, or payment data in chat or run events. Never auto-resume.

**Disposition:** Implemented as a local checkpoint; the focused UX, privacy, and security review is complete.

### 3. Build a browser-task evaluation corpus

**Why:** The projects make claims about speed, token use, reliability, and long-horizon work. Prompt Paul needs measurements for its own supported providers and pages before adopting optimization claims.

**Pattern:** Stagehand keeps evaluation tasks for observe and extract, including iframe cases. See its [evaluation package](https://github.com/browserbase/stagehand/tree/2785d0d1fb9f254a51b9f223f1f1a250094c8e79/packages/evals). agent-browser keeps benchmark scenarios and context-footprint evaluations. See [`benchmarks/`](https://github.com/vercel-labs/agent-browser/tree/b041bd4c9e71b0b1ea0727a9d9deb1e661615050/benchmarks) and [`evals/`](https://github.com/vercel-labs/agent-browser/tree/b041bd4c9e71b0b1ea0727a9d9deb1e661615050/evals). qpilot stores a plan, step states, evidence, and a final verdict derived from failed steps rather than trusting a model-provided finish value. See [`lib/agent.ts`](https://github.com/broxhq/qpilot/blob/60d6c7ef8dcc58c8c0fa35800123401cb8751124/lib/agent.ts) and [`lib/store.ts`](https://github.com/broxhq/qpilot/blob/60d6c7ef8dcc58c8c0fa35800123401cb8751124/lib/store.ts).

**Prompt Paul adaptation:** Reuse the existing browser fixtures and test harness. Add cases for:

- safe navigation and form entry;
- a click that changes state;
- a click that reports success but has no effect;
- a partial mutation and timeout;
- a stale target;
- a repeated mutation;
- an approval timeout and abort;
- a prompt-injection string in page data;
- a restricted page and a sensitive control;
- provider differences.

Record task result, action disposition, postcondition evidence, action count, prompt size, and failure reason. Do not record credentials, full page content, or screenshots by default.

**Disposition:** Implemented as a test and evidence format. It is not a runtime dependency.

### 4. Measure progressive scoped and diff snapshots

**Why:** Large pages create context cost and make target selection harder. Prompt Paul already has strict snapshot bounds. A smaller, named region may improve reliability, but it must not weaken masking or target identity.

**Evidence:** agent-desktop describes skeleton snapshots and region drill-down in its HN launch post, then implements strict live identity matching in [`ref_identity.rs`](https://github.com/lahfir/agent-desktop/blob/ab7606185463e8ac0197c952e23df16ff2a00954/crates/core/src/ref_identity.rs). agent-browser provides text snapshot diffs in [`diff.rs`](https://github.com/vercel-labs/agent-browser/blob/b041bd4c9e71b0b1ea0727a9d9deb1e661615050/cli/src/native/diff.rs) and persisted tab binding in [`tab_binding.rs`](https://github.com/vercel-labs/agent-browser/blob/b041bd4c9e71b0b1ea0727a9d9deb1e661615050/cli/src/native/tab_binding.rs). Stagehand's observe path captures a bounded snapshot, supports a locator scope, and resolves observed element IDs before returning actions in [`observeService.ts`](https://github.com/browserbase/stagehand/blob/2785d0d1fb9f254a51b9f223f1f1a250094c8e79/packages/extension/services/observeService.ts).

**Prompt Paul adaptation:** First measure named semantic regions and bounded diffs in the evaluation harness. If useful, expose only indexed regions produced by the content script. Do not let the model send CSS, XPath, or arbitrary selectors as a scope. Re-run policy, masking, stale checks, and target identity for every action.

Prompt Paul now exposes a bounded `scopeDiff` on successful non-navigation mutations. It contains only indexed metadata, changed flags, counts, and snapshot identity. Richer region and byte-size measurements remain evaluation-only.

**Disposition:** Implemented as a bounded selector-free runtime result; the focused security review is complete.

## Repository findings

| Repository                                                                                                  | Useful idea                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Main conflict or cost                                                                                                                                                                                                                                                                                  | Decision                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| [browser-use](https://github.com/browser-use/browser-use/tree/85ddbfedf609166b2d2c76c3d80506649fee82a9)     | Watchdogs for crashes, permissions, popups, CAPTCHA, downloads, and page state; domain filtering tests. See [`watchdogs/`](https://github.com/browser-use/browser-use/tree/85ddbfedf609166b2d2c76c3d80506649fee82a9/browser_use/browser/watchdogs) and [`security_watchdog.py`](https://github.com/browser-use/browser-use/blob/85ddbfedf609166b2d2c76c3d80506649fee82a9/browser_use/browser/watchdogs/security_watchdog.py).                                                                                                                                   | Python runtime and a broad automation service. Some watchdogs, such as downloads or CAPTCHA handling, conflict with Prompt Paul's narrow action policy.                                                                                                                                                | Study recovery and domain-filtering tests. Do not import the runtime.                                                              |
| [Stagehand](https://github.com/browserbase/stagehand/tree/2785d0d1fb9f254a51b9f223f1f1a250094c8e79)         | Observe, extract, action scoping, iframe evaluation cases, timeouts, cache boundaries, and usage reporting. See [`observeService.ts`](https://github.com/browserbase/stagehand/blob/2785d0d1fb9f254a51b9f223f1f1a250094c8e79/packages/extension/services/observeService.ts), [`extractService.ts`](https://github.com/browserbase/stagehand/blob/2785d0d1fb9f254a51b9f223f1f1a250094c8e79/packages/extension/services/extractService.ts), and [`evals`](https://github.com/browserbase/stagehand/tree/2785d0d1fb9f254a51b9f223f1f1a250094c8e79/packages/evals). | SDK and browser service add runtime and network dependencies. Natural-language observation can create unsafe action candidates without Prompt Paul's policy gate.                                                                                                                                      | Adapt the observe/validate/evaluate ideas. Do not embed the SDK.                                                                   |
| [BrowserOS](https://github.com/browseros-ai/BrowserOS/tree/8fc6ccbdd017a4cd96e8ee72976ccaa8ae3f617c)        | Owned sessions, trust and audit surfaces, tool evidence, agent history, and large evaluation infrastructure.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | AGPL-3.0; Chromium fork and server architecture are far outside an MV3 extension. The repository also includes CDP and scheduling surfaces.                                                                                                                                                            | Study visible audit and evidence concepts. No code copying without a deliberate license decision and human review.                 |
| [Skyvern](https://github.com/Skyvern-AI/skyvern/tree/98dbe907fff1641b2020e6a7b1042a175e4711bc)              | Explicit completion and termination criteria, deterministic-first blocks, validation after mutations, recovery guidance, retries, and cache invalidation tests.                                                                                                                                                                                                                                                                                                                                                                                                 | AGPL-3.0; Python service, database, browser sessions, workflow engine, and cloud features are not extension-sized.                                                                                                                                                                                     | Adapt completion and validation principles. Reject the service stack.                                                              |
| [agent-browser](https://github.com/vercel-labs/agent-browser/tree/b041bd4c9e71b0b1ea0727a9d9deb1e661615050) | Snapshot diffs, context-footprint evaluations, strict session-to-tab binding, safe URL sanitization, and error reporting.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Rust native daemon, CDP connection, network capabilities, and installation burden.                                                                                                                                                                                                                     | Adapt diffs and binding principles. Do not add the daemon or CDP permission.                                                       |
| [XAgent](https://github.com/XorbitsAI/XAgent/tree/1ef3ff6c09603347eaa593fa65c16ed2fd9c7cbb)                 | Multi-agent planning and tool abstraction are useful as comparison points only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Custom Xagent Source License. The license restricts use in competing products and is not a safe direct-reuse choice for Prompt Paul. The generic workforce layer is also out of scope. See its [`LICENSE`](https://github.com/XorbitsAI/XAgent/blob/1ef3ff6c09603347eaa593fa65c16ed2fd9c7cbb/LICENSE). | No code reuse. Do not copy its architecture.                                                                                       |
| [browser-act/skills](https://github.com/browser-act/skills/tree/8f287271faa0c1df79a44578cb059102ff004da2)   | Skill discovery, version-matched instructions, confirmation gates, local profile isolation, and human collaboration. See [`browser-act/SKILL.md`](https://github.com/browser-act/skills/blob/8f287271faa0c1df79a44578cb059102ff004da2/browser-act/SKILL.md) and [skill-forge](https://github.com/browser-act/skills/blob/8f287271faa0c1df79a44578cb059102ff004da2/browser-act-skill-forge/SKILL.md).                                                                                                                                                            | Requires a Python CLI and CDP. It advertises network capture, remote assistance, proxy support, and optional CAPTCHA challenge upload. These are not acceptable defaults for Prompt Paul.                                                                                                              | Adapt manual intervention and progressive skill loading. Reject stealth, network capture, remote assist, and generated code paths. |
| [Pane](https://github.com/abhishek-verma/Pane/tree/75bcad669f8a0a17c2e9b261154bf69f8dfa9689)                | BrowserOS-derived UI for agent history, tool evidence, trust, workflows, and evaluation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | AGPL-3.0 and a Chromium-based product. Its feature set is much larger than the extension boundary.                                                                                                                                                                                                     | Treat as BrowserOS lineage. Study “show the work,” not code.                                                                       |
| [qpilot](https://github.com/broxhq/qpilot/tree/60d6c7ef8dcc58c8c0fa35800123401cb8751124)                    | Human pause and question states, step evidence, derived final verdicts, and a QA-oriented task model.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Playwright/server application, screenshot and attachment surfaces, and credentials or task data that need strict retention rules.                                                                                                                                                                      | Adapt its evidence and pause model without its server.                                                                             |

## Hacker News findings

The four HN items were read through the official HN API on 2026-08-20. The stories had no substantive comment discussion at review time, so the launch claims are not independent validation.

- [Stagehand launch, item 49248980](https://news.ycombinator.com/item?id=49248980): advertises better snapshots, iframe support, self-healing, extension execution, and approximate speed/token gains. The claims have no benchmark method in the HN item. Use the source code and Prompt Paul measurements instead.
- [agent-desktop launch, item 49307819](https://news.ycombinator.com/item?id=49307819): gives the strongest design evidence. It describes skeleton and drill-down inspection, chained action fallbacks, observed-effect success, delivery states, and strict reference re-identification. The HN text also claims a CDP timing comparison; that comparison is not an independent benchmark for Prompt Paul.
- [Pickle launch, item 49260102](https://news.ycombinator.com/item?id=49260102): claims policy-gated actions, logs, user takeover, compact state, model-aware routing, memory, and large token reduction. The product is closed for this review. No reproducible method was found for the token or routing claims. Keep policy gates and takeover as general ideas; reject stored browsing memory and automatic model-strength routing for now.
- [qpilot launch, item 49123489](https://news.ycombinator.com/item?id=49123489): links to qpilot and has no discussion text. Evaluate qpilot from its pinned source, not from the HN item.

## Licensing and integration rules

- MIT sources: browser-use, Stagehand, browser-act/skills, and qpilot. Direct copying still needs copyright notices and dependency review. Clean-room adaptation is preferred.
- Apache-2.0 source: agent-browser and agent-desktop. Direct copying requires the license notice and any required NOTICE handling. A native dependency would still conflict with Prompt Paul's MV3 and dependency contracts.
- AGPL-3.0 sources: BrowserOS, Skyvern, and Pane. Do not copy their code into the extension without a separate legal decision and human review. This review recommends concepts only.
- XAgent uses a custom source license. Do not copy code or distinctive implementation text. See the pinned [license](https://github.com/XorbitsAI/XAgent/blob/1ef3ff6c09603347eaa593fa65c16ed2fd9c7cbb/LICENSE).

License classification is not legal advice. A focused license review is complete for this implementation. Any future direct reuse or distribution needs a new review.

## Explicitly rejected for Prompt Paul

Reject these imports unless a later approved requirement changes the extension boundary:

- full Chromium forks or a second browser;
- Python, Node, or Rust browser daemons;
- cloud browser sessions or remote-control services;
- CDP or debugger access;
- arbitrary page JavaScript, generated scripts, or stealth controls;
- network, HAR, cookie, or credential capture;
- CAPTCHA-solving or challenge-upload services;
- hidden schedules, purchases, destructive actions, or automatic checkout;
- stored page-element memory, browsing notebooks, or cross-run raw page history;
- screenshots or video replay by default;
- automatic routing by inferred model strength;
- a multi-agent workforce layer.

These choices either duplicate existing Prompt Paul controls, add broad privilege or data flows, weaken the privacy contract, create a new service dependency, or carry an incompatible license.

## Could not verify

This review did not establish independent evidence for:

- Stagehand's HN speed and token claims;
- Pickle's token, routing, memory, or reliability claims;
- any upstream claim that generalizes to Prompt Paul's providers, page mix, or safety policy;
- production behavior of closed-source Pickle;
- legal conclusions about combining upstream code, dependencies, or generated output;
- the effectiveness of any self-healing locator outside the upstream test cases;
- a safe way to expose iframe or shadow-root traversal under Prompt Paul's masking and restricted-page rules.

These items need a controlled experiment or human review. They are not adoption recommendations.

## Follow-up verification of later research input

The later research report was checked against the package registry and project sources before implementation:

- `@htekdev/agent-harness` was not found at the claimed npm scope. Do not adopt an unverified package.
- `@qhn/pi-goal` exists, but it is a Pi extension rather than a browser-runtime library and is outside this extension's architecture.
- No exact `Open Multi Agent` package was identified. Related packages such as `open-multi-agent-kit` and `@open-multi-agent/core` are multi-agent application frameworks, not a narrow MV3 runtime dependency, and were not adopted.
- `dom-agent` was not found as an npm package. The located GitHub `ticuong78/dom-agent` project is a Node/TypeScript DOM-diff utility under GPL-3.0, not the claimed Rust/Wasm semantic-tree library.
- `dom-semantic-tree` was not found in the npm registry. No source was identified that supports the claimed Rust/Wasm implementation.
- `open-web-bridge` exists as a MIT package, but its Node/Chromium bridge architecture does not fit pure MV3 and is rejected.
- `dom-accessibility-api` 0.7.1 exists under MIT and was vendored as `libs/dom-accessibility-api.js`. It implements accessible-name/description algorithms; it is not used as a complete role engine.
- LangGraph.js exists under MIT and documents StateGraph, interrupts, and checkpointers. Its concepts informed explicit-resume state handling, but the runtime dependency was not adopted.
- Effect exists under MIT and Dexie exists under Apache-2.0. Neither was adopted; Prompt Paul uses a small retry helper and Chrome session storage instead.
- WAInjectBench has no stated repository license, WASP is CC BY-NC 4.0 for its main materials, and ST-WebAgentBench is Apache-2.0. Prompt Paul uses clean-room evaluation cases and does not redistribute the first two projects.

The registry and source checks do not establish production suitability. Maintenance, bundle impact, browser policy, privacy, and license review remain required for future dependencies.

## Release and follow-up gate

The implemented changes use existing modules and pass the relevant automated gates. Keep the following checks for release review and any future public page-action capability:

1. unit tests for receipts, postconditions, partial mutation, stale state, abort, and retry behavior;
2. policy tests for sensitive controls, page injection, restricted pages, and manual-intervention boundaries;
3. real-browser tests for pause, user action, fresh inspection, and explicit Resume;
4. evaluation runs across supported provider profiles;
5. `npm run validate` and `npm run smoke`;
6. `npm run test:browser` for browser-runtime changes;
7. manual unpacked-extension checks for consent, accessibility, restricted pages, and fail-closed behavior;
8. recorded security and license review for browser-control, authentication, external-service, user-data, permission, or direct-code-reuse changes.

The review phase changed only documentation. The later implementation passed `npm run validate`, `npm run test:browser`, `npm run build`, formatting, lint, `npm audit --audit-level=high --omit=optional`, `npm run verify:licenses`, and `git diff --check`. The focused Act review is complete; publication approval remains a separate release operation.
