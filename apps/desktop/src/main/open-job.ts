/** The window's page, as far as opening a job in it goes. */
export interface JobPage {
  isDestroyed(): boolean;
  send(channel: string, ...values: unknown[]): void;
}

/**
 * Opens a job in the window, such as when the user clicks a call's reminder. A window that's
 * only opening, as on a Mac where the app ran with none, can't hear it yet, so the job waits
 * until the page says it's listening, and goes to it then.
 */
export class JobOpener {
  private waiting: string | null = null;
  private listening: JobPage | null = null;

  /** Opens a job in a window's page, now if it's listening, or as soon as it is. */
  open(jobId: string, page: JobPage): void {
    if (this.listening === page && !page.isDestroyed()) {
      page.send('jobs:open', jobId);
      return;
    }
    this.waiting = jobId;
  }

  /** The page listens for jobs to open, and gets the one waiting, if any. */
  listen(page: JobPage): void {
    this.listening = page;
    const jobId = this.waiting;
    this.waiting = null;
    if (jobId && !page.isDestroyed()) page.send('jobs:open', jobId);
  }

  /** The page loads again, so it can't hear jobs to open until it says it's listening. */
  forget(page: JobPage): void {
    if (this.listening === page) this.listening = null;
  }
}
