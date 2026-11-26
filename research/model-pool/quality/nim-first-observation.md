# NVIDIA developer API comparison: interrupted first condition

#89; exact executed runner da9761957d75491f180ccb8683bab59aac15da5b,
base 9937b041f065e937800044b0fd517d46205857c4, unchanged frozen six-case
fixture. Current catalog HTTP 200, GLM-5.3 Flash present, 30 models.
Developer research entitlement is distinct from per-response price evidence.

One physical request observed in the runner: GLM decision case, output
cap 1024, timeout 30000 ms, elapsed 30003 ms, no response obtained,
execution UNKNOWN, usage absent, cost unreported. All remaining GLM
cases marked NOT_ATTEMPTED, Lightning not invoked. No retry, fallback,
or production changes. Post-timeout read-only catalog HTTP 200 (299 ms)
does not establish the outcome of the original request. No semantic score.

Guest process no longer present. The enclosing shell inherited errexit and
did not record the exit file; exact process exit code is unknown. The
terminal runner receipt and absence of the second route output were checked.
Do not infer an execution or billing result from shell termination.

A future separately admitted research cycle needs its own bounded latency
condition and must not treat this unknown result as known failure or replay
the same outstanding work blindly. No evidence here for model rejection,
quota exhaustion, or production entitlement.

## Separate independent probe after launcher repair

The historical GLM observation above is unchanged. New condition: Lightning,
authority case only, 3072 output tokens, 60-second request timeout, 80-second
outer deadline. Not a retry of GLM or a controlled single-variable comparison.
Exact executed source 1b53f8d211e880930cf6b3d3a885cfb7160a759f.

Actual HTTP 200 after 19378 ms; 1424 input and 3072 output tokens, all 3072
reported as reasoning; finish=length, no usable final content. Cost unreported.
Process exit 0 denotes a completed measurement, not a validated proposal.
No semantic quality score. No paid entitlement or production route inferred.

See nim-lightning-observation.jsonl and nim-lightning-process.json. The process
log matched the captured observation bytes. New launcher runs one explicit
bounded command, records STARTED, captures timeout/child exit even with
errexit, atomically renames the exit receipt and state, and returns that exit.
It rejects an existing run directory. An abrupt loss of the launcher itself
may still leave STARTED or a partial receipt; missing exit is UNKNOWN, not 0.
The attempt event is a pre-dispatch witness, not independent proof that an
upstream server received the request. Do not retry unknown outcomes blindly.

Reproduce the launcher QA without external requests:
```sh
python3 -m unittest discover -s research/model-pool/quality -p 'test_launcher.py'
node research/model-pool/quality/run-nim.mjs --check
```
Next investigate model-specific documented reasoning controls and bounded
output requirements, not simply raising token limits indefinitely.
