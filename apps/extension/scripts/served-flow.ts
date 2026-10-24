// An application whose pages load anew, as Taleo's, iCIMS's and SuccessFactors' do, served on this
// computer for the end-to-end runs: its site's own server sends the next page once you press the
// page's own Save and Continue, which posts the page's form. Here each page is a fixture, served at
// the application's address in turn, the first on opening it. A post that presses the page's button
// to go on gets the next page, one that presses its button to go back the one before, and any
// other post the same page again, as a page that posts itself to show more does. Submit, which
// nothing here should press, only counts. Each press is counted, so a run can tell that only it
// pressed them, never Factwright.
import type { IncomingMessage, ServerResponse } from 'node:http';

/** An application served a page at a time, and what was pressed on it. */
export interface ServedFlow {
  /** Answers a request, if it's for the application's address, and says whether it did. */
  serve(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  /** How many times each of its buttons was pressed. */
  pressed: { next: number; back: number; submit: number };
  /** Starts it again from its first page, as a new application. */
  restart(): void;
}

/** The buttons of an application's pages, by the names each posts with the page's form. */
export interface FlowButtons {
  next: string;
  back?: string;
  submit: string;
}

/** A request's form, as a page's own post sends it. */
async function postedForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  // A form with a file is sent in parts, which name the button pressed as any field.
  const type = request.headers['content-type'] ?? '';
  if (type.startsWith('multipart/form-data')) {
    const names = [...body.matchAll(/name="([^"]+)"/g)].map((each) => [each[1] ?? '', '']);
    return new URLSearchParams(names);
  }
  return new URLSearchParams(body);
}

/**
 * Serves an application's pages at one address, in order, as `pages` gives their HTML, the page
 * after one once its form is posted with the button to go on.
 */
export function servedFlow(
  path: string,
  pages: readonly string[],
  buttons: FlowButtons,
): ServedFlow {
  let at = 0;
  const pressed = { next: 0, back: 0, submit: 0 };
  const send = (response: ServerResponse) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pages[at] ?? '');
  };
  return {
    pressed,
    restart: () => {
      at = 0;
    },
    async serve(request, response) {
      const [address = ''] = (request.url ?? '').split('?');
      if (address !== path) return false;
      if (request.method === 'POST') {
        const form = await postedForm(request);
        if (form.has(buttons.submit)) {
          pressed.submit += 1;
        } else if (form.has(buttons.next)) {
          pressed.next += 1;
          at = Math.min(at + 1, pages.length - 1);
        } else if (buttons.back && form.has(buttons.back)) {
          pressed.back += 1;
          at = Math.max(at - 1, 0);
        }
      }
      send(response);
      return true;
    },
  };
}
