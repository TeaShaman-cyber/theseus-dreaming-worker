"""Reproduce synthetic cross-generation custody fixture from pinned SS source.

Usage: python3 qa/postgres/generate-source-refresh-fixture.py /path/to/ss-checkout
No network or PostgreSQL. Projected page bodies are simulated serving of
independently verified canonical bundle rows; not a live reader receipt.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

ss = Path(sys.argv[1]).resolve()
commit = subprocess.check_output(["git", "-C", str(ss), "rev-parse", "HEAD"], text=True).strip()
assert commit == "3b7b5360050cc2ecdcb60f485a657f2b763751e4"
assert not subprocess.check_output(["git", "-C", str(ss), "status", "--porcelain", "--untracked-files=no"])
sys.path[:0] = [str(ss), str(ss / "tests"), str(ss / "arcade/session-search-materializer/src")]
from test_refresh_handoff_candidate import RefreshHandoffCandidateTest
from test_chatgpt_export import ChatGPTExportAdapterTest
from test_verified_bundle_handoff_reference import fixture_allocation
from session_search.chatgpt_export import ingest_export
from session_search.accepted_membership import rederive_session_delta
from session_search.corpus_store import CorpusPaths
from session_search.shard_allocation import load_session_rows
from session_search.neon_materializer import capture_source_evidence_index
from session_search.shard_bundle import build_bundle
from session_search.serving_promotion_readiness import evaluate_serving_promotion_readiness
from session_search_arcade_materializer.bundle_consumer import read_verified_bundle

def observation(f):
    candidate = f.prepare()
    entries = []
    for item in candidate["selected"]:
        sid, shard = item["session_id"], item["shard_id"]
        index = capture_source_evidence_index(
            f.corpus, provider="chatgpt", shard_id=shard,
            expected_generation_id=item["generation_id"],
            expected_membership=candidate["current_membership"], session_ids=[sid],
        )
        receipt, sessions, rows = read_verified_bundle(
            f.paths[shard], expected_bundle_sha256=item["bundle_sha256"])
        assert receipt["generation_id"] == index["generation_id"]
        session = index["sessions"][0]
        actual = next(row for row in sessions if row[0] == sid)
        assert actual[1:3] == (session["title"], session["coverage_state"])
        messages = []
        for _, ordinal, mid, role, cls, created, body in (r for r in rows if r[0] == sid):
            messages.append(dict(ordinal=ordinal, message_id=mid, role=role,
                search_class=cls, create_time=created, text=body, text_offset=0,
                text_total_chars=len(body), complete_message=True))
        assert len(messages) == len(session["messages"])
        for m, meta in zip(messages, session["messages"]):
            assert hashlib.sha256(m["text"].encode()).hexdigest() == meta["text_sha256"]
        assert len(messages) <= 100 and sum(len(m["text"]) for m in messages) <= 1000
        page = dict(status="OK", provider="chatgpt", shard_id=shard,
            generation_id=item["generation_id"], session_id=sid,
            session_title=session["title"], session_coverage=session["coverage_state"],
            generation_binding="router_pinned_v1", messages=messages, has_more=False,
            next_position=None, next_cursor=None,
            coverage_complete=session["coverage_state"] == "COMPLETE_EXPOSED_CONVERSATION",
            queried_shards=[shard], unavailable_shards=[])
        entries.append(dict(sessionId=sid,index=index,pages=[page]))
    return dict(candidate=candidate,expected=dict(provider="chatgpt",scope=candidate["scope"],
        previousSnapshotSha256=f.previous["snapshot_sha256"],catalog=f.catalog),entries=entries)

f = RefreshHandoffCandidateTest()
try:
    f.setUp()
    before = observation(f)
    helper = ChatGPTExportAdapterTest()
    ingest_export(helper.write_export(f.root,[helper.conversation(cid="unrelated-refresh")]),f.corpus)
    f.delta = rederive_session_delta(f.corpus,f.previous,scope="synthetic:chatgpt")
    with sqlite3.connect(CorpusPaths.from_root(f.corpus).db) as con:
        shards=fixture_allocation(load_session_rows(con))["shards"]
    f.paths={}
    replacements=[]
    previous_catalog = {r["shard_id"]:r["generation_id"] for r in before["candidate"]["catalog"]}
    for shard in shards:
        sid=shard["shard_id"]
        path=f.root / ("refreshed-"+sid+".zip")
        receipt=build_bundle(f.corpus,provider="chatgpt",shard_id=sid,output_path=path,require_verified=True)
        f.paths[sid]=path
        replacements.append({
            **{k:receipt[k] for k in ("provider","shard_id","generation_id","source_manifest_sha256",
                "bundle_sha256","accepted_set_sha256","session_count","message_count")},
            "state":"READY","time_min":1.0,"time_max":2.0,
            "previous_generation_id":previous_catalog.get(sid,"c"*64),
            "source_verified":True,"bundle_readback_verified":True,"ready_readback_verified":True,
        })
    f.promotion=evaluate_serving_promotion_readiness({
        "schema":"theseus.session-search-serving-promotion-readiness-input.v1",
        "source_commit":commit,"source_watermarks":[],"replacement_shards":replacements,
        "unchanged_catalog":[{"provider":"xai","shard_id":"xai-0001","generation_id":"e"*64,
                              "time_min":1.0,"time_max":2.0,"state":"READY"}],
    },repo_state={"head":commit,"branch":"fixture","clean":True},
       qa_state={"status":"PASS","exit_code":0,"output_sha256":"9"*64})
    assert f.promotion["state"]=="READY_FOR_RUNTIME_GATES",f.promotion
    f.catalog=[{k:r[k] for k in ("provider","shard_id","generation_id","state")}
               for r in f.promotion["replacement_shards"]+f.promotion["unchanged_catalog"]]
    after=observation(f)
    assert before["candidate"]["previous_membership"]==after["candidate"]["previous_membership"]
    assert before["candidate"]["current_membership"]!=after["candidate"]["current_membership"]
    old={e["sessionId"]:e for e in before["entries"]}
    new={e["sessionId"]:e for e in after["entries"]}
    assert old.keys()<new.keys()
    for sid in old:
        assert old[sid]["index"]["sessions"][0]["content_sha256"]==new[sid]["index"]["sessions"][0]["content_sha256"]
    assert any(old[s]["index"]["generation_id"]!=new[s]["index"]["generation_id"] for s in old)
    out=Path(__file__).resolve().parents[2]/"test/fixtures/source-refresh.json"
    out.write_text(json.dumps(dict(producer_commit=commit,serving="verified_bundle_rows_simulated_pages",before=before,after=after),
        ensure_ascii=False,indent=2)+"\n")
    print("SOURCE_REFRESH_FIXTURE_PASS",len(old),len(new),hashlib.sha256(out.read_bytes()).hexdigest())
finally:
    f.doCleanups()
