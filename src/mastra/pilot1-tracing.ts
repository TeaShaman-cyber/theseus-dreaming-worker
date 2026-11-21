import type { Pilot1Correlation } from '../dreaming/pilot1-runner.ts';

import {
  EXTERNAL_SAFE_SCOPE,
  OBSERVABILITY_SCOPE_KEY,
} from './observability-routing.ts';

export function buildPilot1TracingEnvelope(correlation: Pilot1Correlation) {
  return {
    requestContext: {
      [OBSERVABILITY_SCOPE_KEY]: EXTERNAL_SAFE_SCOPE,
    },
    tracingOptions: {
      metadata: {
        'theseus.request_fingerprint': correlation.requestFingerprint,
        'theseus.evidence_fingerprint': correlation.evidenceFingerprint,
        'theseus.phase': correlation.phase,
        'theseus.proposal_schema': correlation.proposalSchema,
        'theseus.scope': correlation.scope,
      },
      requestContextKeys: [OBSERVABILITY_SCOPE_KEY],
      tags: ['theseus', 'pilot1', `scope:${correlation.scope}`],
    },
  };
}
