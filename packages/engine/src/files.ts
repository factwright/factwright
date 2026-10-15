/**
 * The files' name, without an extension: the resume's or letter's output_name, or the person's
 * name with what it is and the date, such as "AlexRiveraResume10112026" or
 * "AlexRiveraCoverLetter10112026". Characters files can't hold become hyphens.
 */
export function outputName(
  doc: { name: string; output_name?: string },
  today: Date,
  what: 'Resume' | 'CoverLetter' = 'Resume',
): string {
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const fallback = `${doc.name.replace(/\s+/g, '')}${what}${month}${day}${today.getFullYear()}`;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: file names can't hold them either.
  return (doc.output_name?.trim() || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-');
}

/**
 * How many pages a PDF from Chromium has. Its page tree writes the count as plain text, which
 * saves parsing the whole file.
 */
export function pdfPageCount(pdf: string): number | null {
  const counts = [...pdf.matchAll(/\/Count (\d+)/g)].map((match) => Number(match[1]));
  return counts.length > 0 ? Math.max(...counts) : null;
}
