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
- Its file access stays inside your workspace folder. Your tracker (statuses, notes and calls) sits outside it.
- Its only extra tools are the ones Factwright provides, each doing one narrow job.

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
