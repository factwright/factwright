# Security

Factwright holds the most personal parts of a job hunt: your career history, your pay, the companies you're talking to, and the people you're reaching out to. It also runs an AI agent on your computer. This is how it protects both.

> [!NOTE]
> The cloud part below is written up in full so it can be reviewed. On 2026-10-13 a separate Claude agent with no part in the design reviewed it against the code, as a second opinion rather than an outside expert's audit. What it found is fixed or written up here, including what the web view can't promise.

## Your Claude login
- Factwright never reads, stores or passes Claude credentials, tokens or API keys.
- It launches your installed Claude Code unmodified. The only check it makes is `claude auth status`, to see whether you're signed in.
- If you're signed out, it tells you to run `claude auth login` yourself. There's no "sign in to Claude" button in the app.
- Your Claude Code talks to Anthropic directly. Factwright's servers are never in that path.
- Each [profile](#profiles) you add has a Claude login of its own. The app runs Claude Code for it with `CLAUDE_CONFIG_DIR` set to the profile's own folder, where Claude Code keeps that profile's sign-in, settings and history. On a Mac the sign-in itself goes in the Keychain, in an item Claude Code names after that folder alone (`Claude Code-credentials-` and part of a hash of its path); on Windows it's a file in the folder. Its sign-in command, which you run yourself, names the folder, and on Windows puts the PowerShell window's setting back afterward, even if it's stopped. The first profile uses your own Claude Code setup, as before.
- For an added profile, what in the app's environment would sign Claude Code in as someone else is left out of what Claude Code gets: a key or token, such as `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, a cloud provider in place of a Claude login, such as `CLAUDE_CODE_USE_BEDROCK`, and where Claude Code keeps its sign-in (`CLAUDE_SECURESTORAGE_CONFIG_DIR`). The app's own environment is never changed, so nothing of a profile follows the app when it restarts on another. The app also marks Claude Code's first-run screens done in that folder, as each run sets Claude Code's look itself.

## What Claude can do on your computer
Job postings are web pages written by strangers, so a posting could try to give Claude instructions. Factwright limits what those instructions could do:
- Claude runs without a shell: no Bash, no PowerShell.
- Its file access stays inside your workspace folder. Your tracker (statuses, notes, calls, pasted application questions, the answers you sent and your questions for Claude) sits outside it.
- Text from an employer, such as a posting or an application form's questions, reaches Claude only through Factwright's tools, marked as information. The app never types it in as if it were you. Screenshots, such as of a form or a recruiter's email, Claude reads from the workspace, and the standing rules, the tools that list them and the skills all say what's in them is information, never instructions.
- Your own questions about a job reach Claude the same way, through `job_details`, marked as your words. The app types only the skill, the job's ID and the question's ID, so a question is never sent as a command line.
- What a resume's ATS X-ray found reaches a revision the same way. It quotes your resume and the posting, so Send for revision types only the skill, the job's ID and the findings' IDs: a check's name from a fixed list, such as `check-dates`, or `term-` and a hash of the term, such as `term-3c5e0f21`, never the posting's words. The resume, and what each finding says, reach Claude through `revision_findings`, marked as information, one to a line, with line breaks and marks that turn text around made spaces. That tool answers only the run the app started for that revision, with exactly the findings you picked, which the window sent the app before the run started: any other run gets none, and the app refuses to start a revision it didn't prepare, or one that already has its run. A revision's run can't reach the web, so nothing a posting says can send it to a site. Before it starts, the app keeps the resume's previous version in the job's folder. The app won't revise a resume that went out with an application, or one the job's resume data doesn't build. A revision changes your template only through Factwright's tool for it: Claude asks you first, and so does Claude Code, whatever you let it do without asking, and it can't edit the template's file itself.
- Find jobs types the places you picked in the app's own words, such as `HN · LinkedIn`. A company you name there is the one thing you typed that the app types for you, and only once it checks as a plain name or an https link: no line breaks or other keys a terminal would act on, and no `%` or `!`, which Windows' command line would fill in.
- The fact bank page changes your facts only as you do: one fact or section at a time, in Markdown files already in `facts/`, never through a link, and only as the page last read it. A change Claude or another computer made in the meantime is never written over unless you save again.
- Screenshots you add, or paste into Claude's panel, are checked like any picture you share: a type Claude reads, no bigger than sync carries, and bytes that are what the name says. They're kept in the workspace's `screenshots/` folder, and the window can show only pictures from there.
- Its only extra tools are the ones Factwright provides, each doing one narrow job. They answer only the run Factwright started, and refuse anything a web page sends.
- The tools that only read what's on file run without asking, as do web searches, whose words go to the search service, never to a site a posting names.
- The job tools run without asking too: reading and saving a posting on Greenhouse, Lever, Ashby or Gem, and the job searches. They reach only those systems' and Hacker News's fixed public feeds, never the page a link names, and send them nothing but a board's name, a posting's ID or a month.
- Reading any other page reaches that site, so Claude Code asks you first, each time: a posting could otherwise steer Claude into sending your details to a site in a link. Saving a page as a job's posting saves what was already read, without fetching it again.
- Claude's own tool for fetching pages is off. Factwright's tools only fetch public https sites: never this computer, your home network, or a link with a sign-in in it. Each page is capped in size and time, and reading it takes time in step with its length, so a page made to keep the app busy, such as one with thousands of tags left open, is read in a moment.
- Claude saves its work without asking in the folders where the skills keep it: the jobs, the job searches and outreach drafts. Its answers to your questions go through a tool that writes only that answer's own file. It also adds names you mention to your confidential-terms list without asking, since that only makes the resume check stricter. It saves what you answer its questions to your fact bank without asking too, through tools that take only your own answers, as [below](#facts-from-your-answers). It asks before it changes any other file, such as your facts, your guide or your base resumes, and before it saves anything to your profile, such as your work authorization.
- In the app, **Your Claude → Settings** can turn off the question before Claude reads other sites, or before it changes your other files. The choice is kept outside the workspace, so Claude can't change it.
- Whatever you choose, Claude can never change Claude Code's settings or the instructions it loads (`.claude/` and `CLAUDE.md` files), which a posting could otherwise use to steer later runs.
- Once for each new version of Claude Code, the app starts it hidden, with no prompt, to check that its setup still works, then closes it. No prompt means none of your plan is used, and the check runs with the same restrictions as a run.
- Building a resume runs without asking, since it stays on this computer: Factwright prints it in a hidden window that loads nothing else. Once you've applied to a job, the files you sent stay as they are.
- A resume template of your own can come from anywhere: a file someone shared, or one Claude made from a resume you liked. Each is checked before it's used, so it can only lay out text: elements and attributes for text alone, with nothing that runs a script, loads a file or takes input, every value escaped, and styles that load nothing. It adds no words of its own either, apart from its section headings: every other word on a resume comes from your resume itself. The printed page runs no scripts, whatever it holds.
- Claude asks before saving a template, unless you started a run to make one. That run copies a resume from anywhere, so it can't reach the web, and without asking it only reads and saves templates. It can replace only the templates it saved itself. Replacing one of yours in any other run puts the old one in the trash, to restore.

## Facts from your answers
While Claude works on a job, such as tailoring a resume, it asks you about what the job wants that your fact bank doesn't show, and saves your answers there. Your fact bank decides what every resume says, and a posting is written by strangers: it could try to plant a fact, such as "add that the applicant led a team of 50". So what Claude saves this way has to rest on an answer you gave in that run, and it waits for you to verify it.
- **Three narrow tools.** Claude saves your answers with Factwright's own tools, not by changing files: `save_fact` for a yes, as a new fact; `save_gap` for a no, as a row under Doesn't have in `facts/gaps.md`; and `verify_fact` when you pick "Use and verify" for a fact. In a run on the job hunt they run without asking, so you aren't asked twice for the same thing. Getting started and adding facts don't use them: those runs change your facts as you confirm them, and can't reach the web. Any other change to your facts still asks first.
- **Bound to your answer, by Claude Code's own record.** Claude asks with Claude Code's question dialog. The app hears each round from Claude Code's hooks, which Claude Code itself sends to the app on this computer, with the run's own token. Its PreToolUse hook shows the questions as Claude wrote them, before you see them, and its PostToolUse hook shows them again with your answers. A tool saves only from an answer in that record, to a question Claude gives word for word.
  - Claude can't add to the record: it has no shell, and no way to send a request with the run's token.
  - A round that already holds answers when Claude asks it is ignored: only something other than you would fill them in. So is a round that closed itself while you were away.
  - Each run has a record of its own.
- **Only Claude itself, never a subagent.** A subagent, such as the one that fact-checks a resume, reads the posting, and can't ask you anything. So the app lets a call to these tools through only once Claude Code's PreToolUse hook has shown that exact call, from the run's own Claude. A subagent's call is turned away, even with an answer you gave.
- **About what you answered.** These checks catch mistakes and simple plants. They can't read meaning, so they don't prove a fact follows from your answer.
  - Every keyword of a fact must be a term from the question or your answer, and its title or wording must name one.
  - Every number in it, in digits or in words, must be in the question or your answer, with its scale, so "about 2 years" can't become "$2M", "$2 mm" or "2 bn", and "100 million" can be "100M".
  - What you picked or typed decides whether you said yes, no or not sure, never what an option said under it or the question's words.
  - An answer that starts with a no, such as "No, I haven't", "Probably not" or "I'm not familiar with it", can't back a fact, whatever else the question asks. Saying how much you have, such as "No more than 500" or "Not long, about a year", isn't a no, but "Not much, if at all" is, and going on to say no, as in "Not much, never in production", backs nothing.
  - Not being sure backs nothing without a number of your own. With one, such as "Not sure, maybe 18%", it's an estimate to hedge, unless you go on to say no.
  - A pick about using a fact, such as "Use this once", backs no fact, unless you added a note correcting the fact it named.
  - Only a plain no can become something you don't have: not a yes, not "About a year", and not an answer that says you're not sure or how much you have. A Doesn't have row must be about a term the question or your answer names.
- **The app writes where it came from.** A saved fact's Source, the date, and each question with your answer, word for word, come from the app's record, not from Claude. Your answer keeps what the option you picked said under it, and any notes you added. The company in the Source comes from the job on file that Claude names.
- **Unverified until you say so.** A fact saved from your answer is tagged `unconfirmed`. The task you answered in uses it, since you just said it, and its report says which lines rest on it. Later tasks ask before using it, with "Use and verify", "Use this once" and "Don't use".
- **Verifying is yours.** A run verifies a fact only on your "Use and verify", with no notes added, in a question that names the fact by its title in quotes, gives its tags (such as shipped, solo) and quotes its wording as it reads then. So you verify the words and tags you saw. Its other details, such as its keywords, aren't in the question, and you see them in the Fact bank. A title that more than one waiting fact has is never verified in a run, and neither is a fact saved or corrected in the same run: you verify those in the Fact bank.
- **What the tools can't change.** They only add facts and Doesn't have rows, or replace a fact that's still unverified, when this run saved it, or you just answered a question that names it by its title, in quotes. Before it saves a file, the app checks that every verified fact in it is still there, word for word, and refuses the change otherwise. A fact whose code block is never closed, which runs on over the facts after it, is never replaced. Facts go only in files of facts already in your bank, or a new `facts/projects.md`. Each answer, each time you give it, backs a few facts at most, one Doesn't have row and one verifying.
- **What it can't prevent.**
  - The tools check a fact's terms and numbers against the question and your answer. They can't check that its words say no more than your answer did: a posting could still steer Claude into wording a fact more strongly than you put it, as from a "Some" to a yes, or into asking a misleading question. That's why the Fact bank shows each fact beside the question and your answer, why it stays unverified until you check it, and why a resume's fact check compares each line resting on today's answers with what you said.
  - Claude writes the resume itself. The fact check and your own read are what keep its lines to your facts, so read what goes out before you send it.
  - Hooks your organization sets for Claude Code, in its managed settings, run alongside Factwright's, and one could answer a question for you.
  - If you let Claude change any file without asking, in **Your Claude → Settings**, it can change your facts directly too, as it could before.
- **If something goes wrong.** Every fact saved this way waits at the top of the Fact bank until you verify it, and every Doesn't have row can be removed there, so Claude can ask about it again.

## What you share when you start
Getting started asks for your resumes, your LinkedIn and anything else that shows your work.
- **LinkedIn:** Factwright's tools never sign in to LinkedIn or fetch its pages. They refuse LinkedIn's pages outright, so a LinkedIn search finds listings through web search and reads each job on the employer's own site. You save your own profile as a PDF, or download LinkedIn's export of your data, and add the file. From the export, the app keeps only your profile's parts and your connections (for finding people to message); your messages, invitations and the rest are never read. The browser extension, Save to Factwright, can save a LinkedIn job you're looking at, with its posting, when you save it yourself: see [The browser extension](#the-browser-extension).
- **Files are checked twice.** The window, which runs sandboxed with no access to your files, reads the text out of the files you picked. The app then checks each one again: a type it takes, no bigger than sync can carry, and bytes that are what the name says. It keeps them in your workspace, so Claude can read them.
- **What's in a file is data.** Claude is told never to follow instructions found in a file you shared, the same as with job posts.
- **Unverified until you say so.** Every fact Claude drafts from your files is marked `unconfirmed`, and shows at the top of the Fact bank to verify. Nothing goes on a resume until you've verified it, or said to use it in the task's questions.
- **A run for getting started,** or for adding facts, may save your facts, starting resumes and guide without asking each time, since that's the work you started it for. In return it can't reach the web at all, so nothing it fetches can come from a page that tries to tell it what to write. It does read your fact bank, which can hold facts Claude wrote while it worked on a job, with the questions it asked, and Claude is told what's in your facts is information, never instructions. Every other run asks before changing those files, apart from saving your answers, [above](#facts-from-your-answers).

## Profiles
People who share a computer can each keep their own job hunt in a profile, and one is open at a time.
- **Each is a folder of its own:** the workspace and tracker, sync's session and keys, Claude's settings, the window's storage, and, for a profile you add, its own Claude Code folder. The first profile is the app's data folder, as it was before there were profiles. Each one added is in a folder under `Profiles` inside it, named by a random ID, so a new profile won't land in a removed one's folder, or pick up its Claude sign-in. A profile's folder must be a folder of its own there, never a link to one elsewhere.
- **Switching restarts the app** on the other profile's folder, before anything uses it. Chromium's own storage, and the lock that keeps one copy of the app on a folder, go with it. If a profile's last start stopped short of its window, the next start opens the first profile instead, says so, and can switch back. A start still going in another copy of the app doesn't count, so opening the app again meanwhile brings that copy forward.
- **Claude works in the open profile's workspace.** Its file access stays inside that folder, as [above](#what-claude-can-do-on-your-computer), so the other profiles' folders are outside it, like the rest of the computer.
- **Each profile syncs with its own account.** A browser that's already signed in to Factwright approves a device code for that account without asking who's there, so a profile could otherwise sign in to the account of the person who used the browser last. So once there's more than one profile, each notes its sync account's email, and signing in to an account another profile here uses is turned away before anything is kept, and that sign-in is ended on the server. The check goes by email, so it can't catch an account whose email changed since. Even without it, a profile signed in to an account that's already set up couldn't sync until it linked with that account's link code or recovery key.
- **Not private from each other.** As with a browser's profiles, anyone who can use the computer login can open any profile, read its files, and use its Claude and sync sign-ins. On a Mac, every profile's sync secrets are locked with the app's own Keychain item; on Windows, each profile's folder has its own key, locked to the Windows account. To keep job hunts private, give each person their own login on the computer.
- **Removing a profile** moves its folder to the trash, where it can be restored. Its synced copy stays in its sync account. On a Mac, its Claude Code sign-in stays in the Keychain, so a restored folder is still signed in: it's the item named `Claude Code-credentials-` and a short code, which Keychain Access can delete. The open profile, the first one, whose folder holds the others, and one open in another copy of the app can't be removed.
- **Updates are app-wide.** There's one copy of the app for every profile, and it updates once for all of them.

## Your data in the cloud
Sync is off until you turn it on. Once it's on, your Mac, your Windows PC and your phone show the same job hunt, and everything is locked on your device before it leaves.

### The account key
- Your first device makes the **account key**: 32 random bytes. It never leaves your devices unlocked.
- The desktop app keeps it in the system's keychain, through Electron's safe storage: the Keychain on a Mac, and Windows' data protection on Windows.
- The web view keeps only keys made from it, as Web Crypto keys the page can use but can't read back out.

Each device makes four keys from the account key with HKDF-SHA-256, one for each purpose, plus an ID:

| Key | Algorithm | What it's for |
|---|---|---|
| Records | AES-256-GCM | Locks each record: what a synced file is called, or what a tracked row says |
| Files | AES-256-GCM | Locks file contents |
| Record IDs | HMAC-SHA-256 | Turns a record's name, such as a file's path, into an ID that reveals nothing |
| File IDs | HMAC-SHA-256 | Turns a file's contents into an ID, so the same contents are stored once |
| Key ID | 128 bits from HKDF | Names the account key, so devices can tell they hold the same one |

### Locking
- Everything is locked with AES-256-GCM, with a fresh random 96-bit nonce each time. A locked value is a version byte, the nonce, then the ciphertext and its tag.
- What a value is for is bound in as GCM's additional data. A record is bound to its ID and its version number, and a file to its ID. So the server can't swap one record's data for another's, pass an old version off under a new number, or hand back a file under another file's ID.
- A file's ID is an HMAC of its contents. A device checks the contents it opens hash to the ID it asked for.
- The code is in [`packages/sync`](../packages/sync). It uses only Web Crypto, which every platform Factwright runs on has built in, and no home-made cryptography.

### The recovery key
- When you turn on sync, your first device shows a **recovery key** once: 160 random bits, written as 32 characters to print or keep in a password manager.
- The server keeps the account key locked with a key made from the recovery key (HKDF, then AES-256-GCM). It can't open it.
- With the recovery key, any device you sign in on can unlock the account key. Since the recovery key is random and long, guessing it is out of reach, so it needs no slow key derivation.
- Where you type it in, its box is a password box, so a password manager can fill it in. In the web view it's filed under your account's email.
- A computer that signs in again checks the account's key on the server before it syncs anything, and asks again after a restart until it has.
  - If the account has none, such as after it was deleted and made again, the computer makes a new account key and recovery key, as a first device does. The old ones, which a lost or stolen device may still hold, open nothing of it, and the computer's other devices link again.
  - If the account uses another key, the computer asks to be linked to it and sends nothing until it is. Linking adds this computer's job hunt to that account, so signing in with the wrong one can be undone with **Use a different account**, which ends only that sign-in.
- A computer that's syncing checks the account's key too, after its first round each time sync starts there (opening the app, signing in, turning on or linking), and after each round that follows until the server answers. Until then, its rounds run under the key it hasn't checked. Version 0.1.0 didn't check when it signed in again. After an account was deleted and made again, it synced under its old key without saving that key to the account, and a computer that set up later made another key. Each then skipped what the other sent, and both said they were up to date. Now a key the account doesn't use stops sync on that computer, even across a restart, and it does what signing in again does:
  - If the account has no key, the computer makes a new account key and recovery key, and sends its job hunt again under the new key. What it sent under the old key stays on the server, where only that key opens it, and the account's other devices skip it.
  - If the account uses another key, the computer links to it, as above.

### Adding a device
A new device signs in to the same account, then gets the account key in one of three ways. In none of them can the server open it.

**Approved from a computer that's set up.** Nothing to type. It works as Matrix's emoji check (`m.sas.v1`) and Bluetooth's number comparison do:
1. The new device asks to link. It makes a one-time key pair for this request alone (ECDH on P-256), and sends the server only a hash of its public key (SHA-256, with a random ID for the request). The hash fixes the key before anyone sees it.
2. The desktop app on a computer that's set up shows the request, with the name of the device asking, such as "Chrome on Windows". When the person chooses **Approve…**, it sends a one-time public key of its own.
3. Only then does the new device send its public key. The approving device checks it matches the hash, and stops if it doesn't.
4. Each device works out the same secret from its own private key and the other's public key, and shows six emoji made from it, from Matrix's list. The emoji are bound to the request, both public keys and the ID of the account key, so an approving computer with a key the account doesn't use shows other emoji. The person checks both screens show the same six, in the same order, and says so on each.
5. Once they say so on the device that's set up, it seals the account key with a key made from the secret (HKDF, then AES-256-GCM, bound to the request, both public keys and the key ID) and leaves it on the server. Once they say so on the new device, it picks the sealed key up, once, and opens it. A request runs out 10 minutes after it's made.

What stops a server in the middle: to get the account key, or to slip the new device a key of its own, it would have to swap its own keys in for both devices' and still make both screens show the same emoji. The hash fixes the key it shows the approving device before it sees that device's key, and the new device shows its key only after the server has passed one along. So whatever it swaps in, the emoji on the two screens are each down to chance, and match once in 2^36 (about 69 billion) tries. Each try needs the person to start linking, and a miss shows them two different sets of emoji. That's why both screens ask: the approving device seals the key only once the person says they match there, and the new device takes a key only once they say so there.

That holds only while each try keeps to a few rules, which both apps follow:
- Each try makes fresh one-time keys, and the new device a fresh request ID. Nothing of a try is kept on disk, so a restart starts a new try, never picks one up.
- The approving computer checks the new device's key against the hash it saw before it offered its own. The new device keeps the first approving key it's given, and never takes another.
- A try ends on each device after 10 minutes, whatever the server says. Once the new device has shown its key, its emoji stay on screen, even if the server calls the request off, so the person can still compare them.
- A try that fails is called off, and so is one whose app quits or whose tab closes, so it doesn't linger on the person's other devices.
- Each device runs one try at a time, and starts one only when the person does: by opening the step to link, choosing **Ask again**, or choosing **Approve…**.

Who can approve, and who can ask:
- Only the desktop app approves. A browser can ask, and gets the account key once, as with a code, but it never approves: the web view keeps only keys it can't read back out, so it has no account key to hand over, and it stays that way. A browser that could approve would have to keep the account key where the page can read it, and a server that was taken over could copy it whenever the web view opens, not only while a browser links.
- Any device signed in to the account can ask, including one signed in by tricking someone into approving its sign-in code. The emoji can't tell a person's own device from someone else's, so the approving computer does more:
  - It shows the device asking by name, with when it asked and when it signed in. A device can ask only within 30 minutes of signing in, so a sign-in someone was tricked into long ago can't ask at all.
  - It won't approve while more than one device is asking, so a request made alongside the person's own can't slip in. The person turns down any that aren't theirs first.
  - **Turn down** turns a request down, and the device asking says so. Then it offers to sign that device out of the account, for one that isn't the person's. That goes by the ID the account lists the device under, so it can't dodge it by calling its request off.
  - It says to approve only a device that's in front of you, and that nobody from Factwright will ever ask for the emoji.
- The server keeps one request per device at a time, five waiting per account, and ten an hour from each device.
- A computer that's set up hears of a request as it's made, and shows it on its Sync card, with a notification if Factwright isn't in front.
- A sync server from before this doesn't offer it, so the app and the web view offer it only when the server says it can.

**With a link code.**
- On a device that's set up, **Link a phone or computer** makes a link code: 160 random bits, shown as a QR code and as 32 characters to type.
- It leaves the account key on the server for 10 minutes, locked with a key made from the code, under an ID that's a hash of the code. The server never sees the code.
- The new device scans or types the code. It picks the link up once, and the link is gone.
- A phone scans the QR code with its camera. The code is in the link's `#` part, which browsers don't send to the server.

**With the recovery key**, as above.

### Signing in
- Signing in is separate from the keys: it proves who you are to the server, and the keys never touch it. You sign in with GitHub or Google, through [Better Auth](https://www.better-auth.com) running in the sync server.
- The desktop app signs in through your browser with a device code (RFC 8628): the app shows a short code, and you check the browser shows the same one before you allow it. The app keeps its session token in the system's keychain.
- A session lasts 60 days and renews while it's used. You can see each signed-in device, and sign any of them out. Signing out deletes the session's record at once, and one that runs out is deleted within a day.
- A session keeps the name of the device that signed in, such as "Safari on iPhone" or "Factwright on Sam's Mac", in place of everything the browser or app sent, and no IP address. GitHub's and Google's tokens, and the link to your profile picture, aren't kept, and sign-in's ways to hand out or refresh a provider's token are off.
- The account key's locked copy is saved once, by the first device, and no session can replace it. So someone who tricks you into approving their device code can't spoil your recovery key.
- Each session says how it signed in: in a browser with GitHub or Google, or with a device code. Only a browser's session can delete the account or approve a device's code, and deleting also needs it to be from the last 15 minutes. Sessions from before this count as a device's, so a browser signs in again first.
- Sign-in's own ways to list sessions, which would hand out their tokens, or to sign other sessions out are off. The account page lists devices without tokens, and signs one out by its ID.
- So someone who tricks you into approving their code gets a session that can sync and sign devices out from the account page, where it shows up as a device of its own. It can't delete your account, approve codes of its own to stay signed in, or take another session's sign-in.

### The web view
The web view opens your job hunt in the browser, so the page that holds your keys has to be the only thing running there.
- Its pages run only their own scripts and styles, under a strict Content-Security-Policy, and no other site can frame them. Following a link out, such as to a job posting, sends no referrer.
- It keeps keys made from the account key in IndexedDB, as Web Crypto keys the page can use but can't read back out. Signing out of the browser forgets them, and so does finding it was signed out another way: from another device, by running out, or by the account being deleted. A page left open, such as on a lost phone, forgets them and what it shows the next time it hears from the server.
- A job's page address names it by a code made from its ID with the account's key, never by its company and role. Addresses go to the server and into the browser's history, which the browser may sync.
- Its session is a cookie the page itself can't read. A change sent with that cookie must come from the app's own pages: sign-in and the sync API both turn away requests another site starts.
- A copy of your job hunt is put together in the browser, as a ZIP, and never passes through the server opened.
- **What it can't promise:** the web view's code comes from the server each time it opens. A server that misbehaved, or someone who took over the account it runs on, could send code that reads everything you've synced, in any browser you've linked, while it's open there, or the account key when you link a browser or type your recovery key into it. The desktop app is different: its code changes only through updates signed by Neatifai and checked before they install.

### The browser extension
Save to Factwright, for Chrome and Firefox ([`apps/extension`](../apps/extension)), saves the job you're looking at, with its posting, to your job hunt through sync, from any computer, without the desktop app.
- **It reads a page only when you save it.** Clicking its button, its right-click menu item or its shortcut lets it read that one tab, once: the browser's activeTab permission. It has no content scripts, reads nothing as you browse, and offers nothing a page can load or message, so sites can't tell it's installed. What it reads, the posting and the page's job data, is data, never instructions, as everywhere else in Factwright.
- **It reaches one site,** the sync server, and nothing else. It never sends the browser's cookies there: it has a session of its own, a bearer token from a device code you approve in the browser, which the account page lists as "Save to Factwright in Chrome on Mac". Like a device code's session in the app, it can't approve another device or delete the account.
- **It holds the account's keys,** like a linked browser. They come the same ways, with the same checks: Factwright on your computer approves it after you check both show the same emoji, or a link code, or your recovery key. It keeps them in its own IndexedDB, as Web Crypto keys that can't be read back out, and forgets them when you sign it out or the server says it's signed out. Its code is in the extension itself, checked by each store, not sent by the server each time, as the web view's is.
- **What it saves:** the job's row, as New, its history's first line, and the posting as `saved/<job ID>/posting.md`, kept with the job's extras so saving never makes the job's folder. Everything is locked in the browser before it's sent, as the app locks it. Claude's tools later copy that posting into the job's folder, so a LinkedIn job's posting gets there without them reading LinkedIn.
- **LinkedIn:** it reads a LinkedIn job you're looking at only when you save it, as copying it yourself would, and a setting saves LinkedIn jobs by their link and title alone. LinkedIn's terms forbid software that copies from it.

### What the server sees
- Your account: the email and name your sign-in shares, and which GitHub or Google account it is.
- Each session: the device's name (for the app, your computer's name), and when it signed in and was last used.
- Sign-in's limits, which count each IP address's requests to sign in or check a sign-in. Those counts are deleted within a day.
- For each record: an opaque ID, its version numbers, sizes, times, whether it's deleted, which file contents it points to, and which session made each version.
- For each file: an opaque ID, its size and when it was uploaded.
- For each request to link: which devices asked and approved it, with their names and when the one asking signed in, two one-time public keys and a hash, when it was made, whether it was turned down or picked up, and once it's approved, the account key sealed for the new device alone, until it's picked up. Each is gone 10 minutes after it's made, or sooner when the device asking calls it off.
- Never your file names, the files' contents, what you track, or any key that opens them.
- Its own logs keep only what it writes itself, such as a backup that failed. Cloudflare's log of every request is off, and a ticket to listen for changes says nothing about the account. Cloudflare, which runs the server, still sees each request's IP address and address as it passes through, as any host does.
- Sizes and times aren't padded, so they show roughly how much you keep and when you change it.
- Once a day it counts its accounts, the ones made the day before and in the last week and month, the ones used in the last week and month, and the sign-ins that haven't ended, in the app and in browsers. It keeps only those totals, for 3 months, in Cloudflare's Workers Analytics Engine, where Factwright's maker reads them with a token that can read analytics and nothing else (`apps/site/scripts/stats.ts`). No total names anyone, and the token can't reach the accounts database.

### What it can't prevent
A server that misbehaved couldn't read or forge what the desktop app syncs. It could still delete it, hold back new changes, or keep serving an old version of a record. And because it sends the web view's code, it could change that code to read what you've synced, in a browser you've linked, while that code is open there.

### Separate accounts
- The server takes your account from your verified session only, never from the request.
- Each account has its own store: a Durable Object with its own database, and its own folder of files in R2. There's no shared table of user data to leak across accounts.
- Automated tests try to read and write across accounts, through every part of the API, and must fail.
- Each account has limits on storage, file size and requests, since a free service invites abuse.

### Backups and deleting
- Each account's store is snapshotted to R2 every day and kept for 14 days. Cloudflare also keeps 30 days of point-in-time recovery for each store, and 7 days for the accounts database (30 on a paid plan).
- Something you delete in the app stays on the server, locked, while an earlier version holds it (90 days), then in backups (up to 14 days more) and Cloudflare's recovery (up to 30 days more).
- Deleting your account signs out every device first, then removes your store, your files, your backups and your sign-in records. The store remembers it was deleted, so nothing can fill it again, and a last sweep a few minutes later catches an upload that was on its way. If deleting fails partway, trying again finishes it.
- Someone who can't sign in any more can ask by email, and the operator can delete their account with a token only the operator has.

### The trade-off
If you lose every device and your recovery key, your data can't be recovered, by you or by us. You can download an unencrypted copy whenever you like, from your account in the web view.

## Installing and updating
- **Signed.** The Mac app is signed with Neatifai's Developer ID and notarized by Apple. On
  Windows, the installer, the app and every module it loads are signed through Azure Artifact
  Signing. A release that isn't signed is never published.
- **Where an installer came from.** While the repository is public, each release's installers
  come with an attestation: a record, signed through Sigstore and kept by GitHub, of the commit
  and workflow run that built them. With the GitHub CLI signed in, `gh attestation verify
  <installer> -R factwright/factwright --signer-workflow
  factwright/factwright/.github/workflows/release.yml --source-ref refs/tags/v<version>` checks a
  download against it, so anyone can confirm it was built from that version's code by the release
  workflow, not uploaded from somewhere else. It shows where an installer came from, not that the
  code is free of mistakes. Versions released while the repository was private don't have one.
- **Locked down.** The installed app can't take Node's options from the environment, open Node's
  debugger from the command line, or load code from anywhere but its own archive, which it
  checks. On a Mac it can't be started as plain Node either. On Windows it can, because the
  terminal library stops a run through a helper started that way.
- **Settings for testing are ignored.** The variables that point the app at other screens or
  another sync server, for development and tests, do nothing in an installed copy.
- **Only Factwright's own builds are set up to use its servers.** The release workflow builds
  with the sync server, app.factwright.com, and the download site, downloads.factwright.com, only
  when it runs in this repository, outside pull requests: for a release, or by hand to try one. A
  copy built anywhere else, such as from a fork, has neither: its Sync card says sync isn't in that
  copy, and it never looks for updates. Its builder can set up their own, as `apps/server` and
  `apps/desktop` say. This is how copies are built, not a lock: anyone can build a copy that
  points at app.factwright.com. The server treats it like any other copy: it reaches only the
  account it signs in to, whose job hunt is locked with keys only that account's devices hold. No
  one else's build can sign as Neatifai, though: the signing keys are secrets of this repository,
  which a fork's builds don't have, and which the release workflow gives to no pull request's run.
- **Downloads are counted, not the people downloading.** factwright.com's download links go
  through its Worker, which counts each download by computer and version, in Cloudflare's
  Workers Analytics Engine, then sends the browser on to the installer. A count keeps nothing
  about who downloaded, no IP address, browser or ID, only when, as Analytics Engine notes for
  every count. Each is kept for 3 months. The installed app still reports nothing.
- **No debugging the user's data.** Chromium, which the app is built on, can let another program
  drive it through a debugging port. As in Chrome, an installed copy won't start that way on the
  user's own data folder, or any profile in it: only with a folder of its own, as the tests give
  it, where there's no job hunt and no sync to reach.
- **Updates are checked.** A copy from Factwright's own releases downloads updates only from
  downloads.factwright.com, over https. An update must match the checksum in the update feed. On a
  Mac, it must also pass Apple's check that it's signed by the same developer as the app. On
  Windows, it must be signed by a certificate issued to the same publisher name, Neatifai's.
- **Asking for updates says little.** Looking for an update asks for the feed, which tells the
  download site your IP address and that a copy of Factwright is looking, like any download. The
  updater can send an ID of each install too, to roll a version out to some installs at a time.
  Factwright sends the same ID for everyone instead.

## What still leaves your computer
Whatever Claude reads goes to Anthropic, under your own account and Anthropic's terms. That's how Claude works, and Factwright doesn't add anyone else to that path.

Factwright sends no crash reports, analytics or usage data. Claude Code sends Anthropic its own, under your Claude Code settings.

Factwright's tools read job boards and pages straight from your computer, so each site sees your IP address and that Factwright is asking. Hacker News's "Who is hiring?" threads come through Algolia's Hacker News search. On Windows, the spell checker built into Chromium downloads its dictionary from Google once; it never sends what you type.

## Reporting a problem
See [SECURITY.md](../SECURITY.md).
