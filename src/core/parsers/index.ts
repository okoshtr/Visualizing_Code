import type { Lang } from '../ir';
import { parseCLike } from './clike';
import type { ParseResult } from './common';
import { parsePython } from './python';
import { parseVba } from './vba';

export type { ParseResult };

/** Parses source code of any supported language into the program model. */
export function parse(code: string, lang: Lang): ParseResult {
  switch (lang) {
    case 'python':
      return parsePython(code);
    case 'vba':
      return parseVba(code);
    default:
      return parseCLike(code, lang);
  }
}
