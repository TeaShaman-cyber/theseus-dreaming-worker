import { createHash } from 'node:crypto';

export type OutputNormalization = {
  classification: 'DIRTY_BUT_COMPLETE_JSON';
  repairKind: 'MARKDOWN_JSON_FENCE';
  rawOutputFingerprint: string;
  normalizedOutputFingerprint: string;
};

export type PreparedStructuredOutput = {
  text: string;
  normalization?: OutputNormalization;
};

function fingerprint(value: string): string {
  return 'sha256:' + createHash('sha256').update(value).digest('hex');
}

export function prepareStructuredOutput(
  rawText: string,
  finishReason?: string,
): PreparedStructuredOutput {
  if (finishReason === 'length') {
    throw new Error('PILOT1_OUTPUT_TRUNCATED');
  }

  const fenced = rawText.match(/^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  if (!fenced) return { text: rawText };

  const normalized = fenced[1];
  try {
    JSON.parse(normalized);
  } catch {
    return { text: rawText };
  }

  return {
    text: normalized,
    normalization: {
      classification: 'DIRTY_BUT_COMPLETE_JSON',
      repairKind: 'MARKDOWN_JSON_FENCE',
      rawOutputFingerprint: fingerprint(rawText),
      normalizedOutputFingerprint: fingerprint(normalized),
    },
  };
}
