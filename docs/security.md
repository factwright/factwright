# Security

Factwright holds the most personal parts of a job hunt: your career history, your pay, the companies you're talking to, and the people you're reaching out to. It also runs an AI agent on your computer. This is how it protects both.

> [!NOTE]
> This is the design. The exact key handling gets written up here as the encryption is built.

## Your Claude login
- Factwright never reads, stores or passes Claude credentials, tokens or API keys.
- It launches your installed Claude Code unmodified. The only check it makes is `claude auth status`, to see whether you're signed in.
- If you're signed out, it tells you to run `claude auth login` yourself. There's no "sign in to Claude" button in the app.
- Your Claude Code talks to Anthropic directly. Factwright's servers are never in that path.

## What Claude can do on your computer
Job postings are web pages written by strangers, so a posting could try to give Claude instructions. Factwright limits what those instructions could do:
- Claude runs without a shell: no Bash, no PowerShell.
- Its file access stays inside your workspace folder. Your tracker (statuses, notes, calls and pasted application questions) sits outside it.
- Text from an employer, such as a posting or an application form's questions, reaches Claude only through Factwright's tools, marked as information. The app never types it in as if it were you.
- Its only extra tools are the ones Factwright provides, each doing one narrow job. They answer only the run Factwright started, and refuse anything a web page sends.
- The tools that only read what's on file run without asking, as do web searches, whose words go to the search service, never to a site a posting names. Reading a page or saving a posting reaches that site, so Claude Code asks you first, each time: a posting could otherwise steer Claude into sending your details to a site in a link.
- The job search tools run without asking too. They reach only fixed public APIs (Greenhouse, Lever, Ashby, Gem and Hacker News's), and send them nothing but a board's name or a month.
- Claude's own tool for fetching pages is off. Factwright's tools only fetch public https sites: never this computer, your home network, or a link with a sign-in in it. Each page is capped in size and time.
- Claude Code asks you before it writes a file, unless you tell it not to for the rest of a run.
- Once for each new version of Claude Code, the app starts it hidden, with no prompt, to check that its setup still works, then closes it. No prompt means none of your plan is used, and the check runs with the same restrictions as a run.
- Building a resume runs without asking, since it stays on this computer: Factwright prints it in a hidden window that loads nothing else. Once you've applied to a job, the files you sent stay as they are.

## Your data in the cloud
### End-to-end encryption
- Your first device creates a random data key and keeps it in the operating system's keychain.
- You get a recovery key once, to print or save in a password manager.
- The server keeps a copy of the data key locked with your recovery key, which it can't open.
- A new device gets the key by scanning a QR code from a device that's already set up, or from your recovery key.
- Everything is encrypted before it leaves your computer. The server sees only opaque IDs, sizes and timestamps.

### Separate accounts
- The server takes your account from your verified session only, never from the request.
- Each account has its own store, so there's no shared table of user data to leak across accounts.
- Automated tests try to read across accounts and must fail.

### The trade-off
If you lose every device and your recovery key, your data can't be recovered, by you or by us. You can export an unencrypted copy whenever you like.

## What still leaves your computer
Whatever Claude reads goes to Anthropic, under your own account and Anthropic's terms. That's how Claude works, and Factwright doesn't add anyone else to that path.

Crash reports never include your content.

## Reporting a problem
See [SECURITY.md](../SECURITY.md).
