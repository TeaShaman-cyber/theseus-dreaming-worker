// Research only: packet-scoped projection, not a change to Proposal v1.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {proposalSetJsonSchema,parseProposalSet} from '../../../src/dreaming/proposal-schema.ts';
import {runPilot0} from '../../../src/dreaming/dry-run.ts';
import {pilot1RequestFingerprint} from '../../../src/dreaming/pilot1-runner.ts';

export const compactVersion='theseus.dw.packet-handles.research.v1';
const canonicalVersion='theseus.dreaming-worker.proposals.v1';

export function strictParse(raw){
  assert.equal(typeof raw,'string');
  assert.ok(Buffer.byteLength(raw)<=65536,'response too large');
  const guard=spawnSync('python3',[fileURLToPath(new URL('./strict-json.py',import.meta.url))],
    {input:raw,encoding:'utf8',timeout:2000,maxBuffer:4096});
  assert.equal(guard.status,0,'strict JSON guard rejected response');
  return JSON.parse(raw);
}
export function makeContext(request){
  assert.equal(request.scope,'SYNTHETIC_FIXTURE');
  const snapshot=structuredClone(request);
  const gate=runPilot0(snapshot.packet);
  assert.equal(gate.outcome,'PROCESSED');
  assert.ok(snapshot.packet.evidence.length<=64);
  const fingerprint=pilot1RequestFingerprint(snapshot.scope,snapshot.task,gate.receipt.inputFingerprint);
  const map=new Map();
  const seen=new Set();
  const evidence=snapshot.packet.evidence.map((e,i)=>{
    assert.equal(typeof e.sourceRef,'string');
    assert.ok(e.sourceRef&&!seen.has(e.sourceRef),'ambiguous source');
    seen.add(e.sourceRef);
    // This equality is a property of our frozen synthetic fixtures only.
    assert.equal(e.evidenceHash,'sha256:'+createHash('sha256').update(e.text).digest('hex'));
    const handle='E'+(i+1);
    map.set(handle,{source_ref:e.sourceRef,evidence_hash:e.evidenceHash});
    return {handle,text:e.text};
  });
  const schema=structuredClone(proposalSetJsonSchema);
  schema.properties.schema.const=compactVersion;
  for(const branch of schema.properties.proposals.items.oneOf){
    branch.properties.source_refs={type:'array',minItems:1,uniqueItems:true,items:{type:'string',enum:[...map.keys()]}};
  }
  const compactInput={task:snapshot.task,packet:{...snapshot.packet,evidence}};
  const messages=[
    {role:'system',content:'Return one JSON object matching this schema. source_refs are exact packet-local handles; choose only sources supporting the claim. Do not invent or copy hashes. '+JSON.stringify(schema)},
    {role:'user',content:JSON.stringify(compactInput)},
  ];
  const wireFingerprint='sha256:'+createHash('sha256').update(JSON.stringify({messages,schema})).digest('hex');
  function resolve(raw,finishReason,expectedRequestFingerprint){
    assert.equal(finishReason,'stop','incomplete or unknown finish');
    assert.equal(expectedRequestFingerprint,fingerprint,'wrong request context');
    const data=strictParse(raw);
    assert.equal(data.schema,compactVersion);
    assert.ok(Array.isArray(data.proposals)&&data.proposals.length>0);
    const expanded={...data,schema:canonicalVersion,proposals:data.proposals.map(p=>{
      assert.ok(Array.isArray(p.source_refs)&&p.source_refs.length>0);
      assert.equal(new Set(p.source_refs).size,p.source_refs.length,'duplicate handle');
      return {...p,source_refs:p.source_refs.map(h=>{
        assert.ok(typeof h==='string'&&map.has(h),'unknown handle');
        return {...map.get(h)};
      })};
    })};
    return parseProposalSet(JSON.stringify(expanded),snapshot.packet);
  }
  function compactForComparison(proposals){
    // Only already-validated historical artifacts, never repair failed output.
    const checked=parseProposalSet(JSON.stringify(proposals),snapshot.packet);
    return {...checked,schema:compactVersion,proposals:checked.proposals.map(p=>({...p,source_refs:p.source_refs.map(ref=>{
      const matches=[...map].filter(([,v])=>v.source_ref===ref.source_ref&&v.evidence_hash===ref.evidence_hash);
      assert.equal(matches.length,1);
      return matches[0][0];
    })}))};
  }
  // Request/response pairing is the caller's responsibility; reused E1 is not
  // a globally unique identifier and cannot authenticate an arbitrary replay.
  return {fingerprint,wireFingerprint,evidenceFingerprint:gate.receipt.inputFingerprint,
          schema,messages,resolve,compactForComparison};
}
