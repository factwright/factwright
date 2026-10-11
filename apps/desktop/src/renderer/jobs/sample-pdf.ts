/** A line of the made-up resume: its size, where it sits, and its words. */
const LINES: readonly [size: number, x: number, y: number, text: string][] = [
  [28, 54, 716, 'ALEX RIVERA'],
  [13, 54, 692, 'Staff Platform Engineer'],
  [10, 54, 676, 'Developer platforms - Kubernetes - Go - Postgres'],
  [13, 54, 636, 'SUMMARY'],
  [10, 54, 616, 'Platform engineer who builds the tools other engineers rely on.'],
  [10, 54, 602, 'Cut deploy time by ~40% across twelve services.'],
  [13, 54, 566, 'EXPERIENCE'],
  [11, 54, 546, 'Staff Engineer - Tidewater Analytics'],
  [10, 54, 530, 'Led the move to one deploy pipeline for every team.'],
];

/**
 * A one-page resume PDF, made up, for previewing in the sample screens. Its text is plain
 * ASCII, so each object's place in the file is its place in the string.
 */
export function samplePdf(): Uint8Array {
  const content = [
    '0.76 0.25 0.05 rg 54 662 40 3 re f',
    '0 g',
    ...LINES.map(([size, x, y, text]) => `BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET`),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
