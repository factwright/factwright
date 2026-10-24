import { fieldKind } from '@factwright/core';
import type { PageForm } from './page/form.ts';

/**
 * Whether a page's form looks like an application, so the popup offers to fill it, and the
 * script on the job sites you allowed puts its Fill button on it: a few fields, one of them a
 * file or an email address, or any field on a page of an application that runs over several, as
 * Workday's Application Questions and Voluntary Disclosures are. A form to sign in, or to make an
 * account, as Workday's before its application, isn't one: an email address, a password and boxes
 * to tick, and nothing else that's ever filled, as a page's trap for bots isn't.
 */
export function looksLikeApplication(form: PageForm | null): boolean {
  if (!form) return false;
  const signIn =
    form.fields.some((field) => field.type === 'password') &&
    form.fields.every(
      (field) =>
        field.type === 'password' ||
        field.control === 'check' ||
        ['email', 'never'].includes(fieldKind(field)),
    );
  if (signIn) return false;
  if (form.step && form.fields.length > 0) return true;
  if (form.fields.length < 3) return false;
  return form.fields.some((field) => field.control === 'file' || fieldKind(field) === 'email');
}
