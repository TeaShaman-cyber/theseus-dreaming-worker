"""Actual pinned SS synthetic recapture and verified full-provider handoff; no live serving claim."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import zipfile

ss=Path(sys.argv[1]).resolve()
commit=subprocess.check_output(["git","-C",str(ss),"rev-parse","HEAD"],text=True).strip()
assert commit=="3b7b5360050cc2ecdcb60f485a657f2b763751e4"
assert not subprocess.check_output(["git","-C",str(ss),"status","--porcelain","--untracked-files=no"])
sys.path[:0]=[str(ss),str(ss/"tests"),str(ss/"arcade/session-search-materializer/src")]
from test_refresh_handoff_candidate import RefreshHandoffCandidateTest
from test_chatgpt_export import ChatGPTExportAdapterTest
from test_verified_bundle_handoff_reference import fixture_allocation
from session_search.accepted_membership import capture_accepted_membership,rederive_session_delta
from session_search.chatgpt_export import ingest_export
from session_search.corpus_store import CorpusPaths
from session_search.shard_allocation import load_session_rows
from session_search.shard_bundle import build_bundle
from session_search.serving_promotion_readiness import evaluate_serving_promotion_readiness

f=RefreshHandoffCandidateTest()
try:
    f.setUp()
    f.previous=capture_accepted_membership(f.corpus,scope="synthetic:chatgpt")
    helper=ChatGPTExportAdapterTest()
    source=helper.write_export(f.root,[helper.conversation(cid="changed"),helper.conversation(cid="stable")])
    with zipfile.ZipFile(source,"a") as z:
        z.comment=b"synthetic recapture with unchanged conversations"
    ingest_export(source,f.corpus)
    f.delta=rederive_session_delta(f.corpus,f.previous,scope="synthetic:chatgpt")
    assert not any(f.delta[k] for k in ("added","changed","removed"))
    assert len(f.previous["members"])==7 and len(f.delta["current_membership"]["members"])==11
    old={r["shard_id"]:r["generation_id"] for r in f.catalog}
    with sqlite3.connect(CorpusPaths.from_root(f.corpus).db) as con:
        shards=fixture_allocation(load_session_rows(con))["shards"]
    f.paths={}
    replacements=[]
    for shard in shards:
        sid=shard["shard_id"]
        path=f.root/("recapture-"+sid+".zip")
        receipt=build_bundle(f.corpus,provider="chatgpt",shard_id=sid,output_path=path,require_verified=True)
        f.paths[sid]=path
        replacements.append({**{k:receipt[k] for k in ("provider","shard_id","generation_id","source_manifest_sha256","bundle_sha256","accepted_set_sha256","session_count","message_count")},"state":"READY","time_min":1.0,"time_max":2.0,"previous_generation_id":old.get(sid,"c"*64),"source_verified":True,"bundle_readback_verified":True,"ready_readback_verified":True})
    f.promotion=evaluate_serving_promotion_readiness({"schema":"theseus.session-search-serving-promotion-readiness-input.v1","source_commit":commit,"source_watermarks":[],"replacement_shards":replacements,"unchanged_catalog":[{"provider":"xai","shard_id":"xai-0001","generation_id":"e"*64,"time_min":1.0,"time_max":2.0,"state":"READY"}]},repo_state={"head":commit,"branch":"fixture","clean":True},qa_state={"status":"PASS","exit_code":0,"output_sha256":"9"*64})
    assert f.promotion["state"]=="READY_FOR_RUNTIME_GATES"
    f.catalog=[{k:r[k] for k in ("provider","shard_id","generation_id","state")} for r in f.promotion["replacement_shards"]+f.promotion["unchanged_catalog"]]
    candidate=f.prepare()
    assert candidate["selected"]==candidate["removed"]==[]
    output={"producer_commit":commit,"serving":"verified_bundles_simulated_catalog_readback","candidate":candidate,"expected":{"provider":"chatgpt","scope":candidate["scope"],"previousSnapshotSha256":f.previous["snapshot_sha256"],"catalog":f.catalog}}
    out=Path(__file__).resolve().parents[2]/"test/fixtures/source-empty-refresh.json"
    out.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n")
    print("EMPTY_HANDOFF_FIXTURE_PASS members=7→11 selected=0 removed=0")
finally:
    f.doCleanups()
