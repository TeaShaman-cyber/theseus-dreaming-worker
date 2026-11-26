import { parse } from '@prantlf/jsonlint';

/** Reject duplicate decoded member names before schema validation loses them. */
export function parseStrictModelJson(rawText: string): unknown {
  return parse(rawText, { mode: 'json', allowDuplicateObjectKeys: false });
}
