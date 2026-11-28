# Bounded Hyperdrive synthetic acceptance witness

Issue #23; actual cloud receipt: https://github.com/TeaShaman-cyber/theseus-dreaming-worker/issues/23#issuecomment-7229767574

This is a QA-only Worker entrypoint, not the application entrypoint, an automatic scheduler, or an authorization to deploy. It uses the checked-in synthetic fixture and simulated inference callbacks only. No provider requests.

Build offline with the locked project dependencies and Node 22:

```sh
qa/cloudflare/build-canary /tmp/dw-canary.mjs
```

Use preview metadata compatibility_date 2026-11-22 and compatibility_flags [nodejs_compat], as in the accepted preview. These are QA preview settings, not a production configuration change. The workerd export condition is essential: without it the pg-cloudflare package resolves its empty Node stub, causing CloudflareSocket is not a constructor. The accepted experiment used esbuild 0.28.2. The checked-in entrypoint is a portable adaptation of that experiment, with stricter missing-key/ID rejection and reduced error disclosure; it has not itself been uploaded.

For an explicitly authorized remote acceptance window, use the existing issue-owned Hyperdrive binding (HYPERDRIVE), a fresh secret CANARY_KEY of at least 32 characters, and unique CANARY_ID matching hyperdrive-synthetic- followed by 32 lowercase hexadecimal characters. Use Cloudflare's temporary edge preview, not Worker deployment or public route enablement. Keep the preview capability and key in process memory. The entrypoint accepts only fixed POST paths, with x-canary-key. No caller evidence is accepted. Probe must report the exact issue23 database/runtime role before any writes. Run /start, /resume, /replay once each, checking the exact expected outcomes below. Stop on any ambiguous failure; inspect the database before retry. Preview expiry is not independently established, so do not claim cleanup solely from the request ending.

| Phase | Expected |
| --- | --- |
| probe | dreaming_issue23 / dw_runtime_issue23, ledger present |
| start | BUDGET_EXHAUSTED, 2 simulated passes, root unchanged |
| resume | ACKNOWLEDGED, 2 simulated passes, first work reused |
| replay | ALREADY_ACKNOWLEDGED, 0 simulated passes, identical receipt |

The completed 2026-11-27 UTC experiment used accepted source at main 8ab8f330c45c70ea01bab267bcf8512817d02403 and temporary bundle SHA256 120dc399cc3354054be666c959a59672dc8725b73157b999917b7ea468f5c2d1. Independent Neon readback: two checkpoints, one plan, two reservations, ten journal entries, two completions, four derived hypotheses, four memberships and two origin links. No external model calls. The synthetic rows are retained append-only evidence. Public routing and the existing deployed version were independently confirmed unchanged. This is evidence for cloud persistence and replay, not full operational or semantic acceptance.
