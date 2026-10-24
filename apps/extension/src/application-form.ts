import { fieldKind } from '@factwright/core';
import type { PageForm } from './page/form.ts';

/**
 * Whether a page's form looks like an application, so the popup offers to fill it, and the
 * script on the job sites you allowed puts its Fill button on it: a few fields, one of them a
 * file or an email address.
 */
export function looksLikeApplication(form: PageForm | null): boolean {
  if (!form || form.fields.length < 3) return false;
  return form.fields.some((field) => field.control === 'file' || fieldKind(field) === 'email');
}
