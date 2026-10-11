# Architecture

> [!NOTE]
> This is the design. Most of it isn't built yet; the [roadmap](roadmap.md) shows what exists today.

```mermaid
flowchart LR
  subgraph computer [Your computer]
    app[Factwright app] -->|launches| claude[Your Claude Code]
    claude -->|reads and writes| files[(Workspace folder)]
    app -->|watches and syncs| files
  end
  claude -->|your own login| anthropic[Anthropic]
  app -->|encrypted data only| server[Sync server]
  phone[Phone or browser] -->|decrypts on the device| server
```

## The desktop app
An Electron app for Mac and Windows ([`apps/desktop`](../apps/desktop)). It holds your dashboard and tracker, runs Claude Code in a built-in terminal, and syncs your data.

## Your Claude Code
Factwright doesn't have an AI of its own. It launches the Claude Code you installed and signed in to, unmodified, in a real terminal you can watch and type into. It loads Factwright's skills and tools for that session only, through Claude Code's own command-line flags, and never changes your Claude settings.

When you click **Run** on a job, the app starts a session in your workspace and sends the command, such as a fit check or a tailored resume. Claude asks you questions in that terminal when it needs to. Claude Code hooks tell the app when a run finishes or is waiting on you.

## Tools for Claude
Claude doesn't get a shell. Instead, the app gives it a small set of tools over MCP, which it serves itself, on this computer, while a run is live ([`apps/desktop/src/main/tools`](../apps/desktop/src/main/tools)):
- see whether you've seen a job before, and how it went
- look up everything on file for a job, including your notes and calls
- read a web page, and save a job posting word for word
- render a resume to PDF or Word (coming next)

The skills ([`plugin`](../plugin)) tell Claude how to use them for each task, such as a fit check or interview prep.

## The workspace
Claude works on plain files in a folder on your computer:

| Folder | What's in it |
|---|---|
| `facts/` | The fact bank: your experience as checkable claims |
| `guide/` | Your rules and preferences for resumes and answers |
| `applications/` | One folder per job: posting, fit check, notes, answers, prep and resumes |
| `searches/` | Job searches, your search criteria, and logs of fit, salary and employer checks |
| `outreach/` | Messages drafted for people at a company |

The app watches this folder, and reads it again whenever something changes. What you track by hand, such as statuses, dates, calls and notes, lives in a small database beside the workspace, where Claude's file tools can't reach it.

## Sync and storage
Everything syncs to the cloud, encrypted, so your other computers and your phone see the same job hunt. The sync server ([`apps/server`](../apps/server)) runs on Cloudflare:
- **One store per account:** a Durable Object with its own database, plus a private folder of encrypted files in R2.
- **Identity from the session:** the server works out who you are from your verified session only, and no request can name another account.
- **Version history:** files are stored by content hash, so old versions stay available.

The web and phone view ([`apps/web`](../apps/web)) downloads your encrypted data and decrypts it in the browser.

## Resumes
Resume data is JSON. The engine ([`packages/engine`](../packages/engine)) renders it to PDF with the browser built into Electron, and to Word with the `docx` library.
