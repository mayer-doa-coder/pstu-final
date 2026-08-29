import { z } from 'zod';

// C0 (0x00–0x1F), DEL (0x7F), and C1 (0x80–0x9F) control characters. None of
// them belong in a display name or a payment note.
//
// `no-control-regex` exists to catch control characters written into a pattern
// by accident; here matching them is the entire purpose of the rule.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * A bounded, single-line string for user-controlled text that is stored and
 * later rendered back to *other* users (display names, transfer/request
 * notes).
 *
 * The values are stored verbatim and returned as JSON — escaping belongs to
 * the renderer, not the database, so this does not try to strip markup (which
 * would silently corrupt a legitimate name like `A<B`). What it does reject is
 * control characters, which have no legitimate use here and are what let a
 * value smuggle line breaks into logs or terminal escape sequences into a
 * developer's console.
 */
export function safeText(max: number): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: 'Text must not contain control characters.',
    });
}
