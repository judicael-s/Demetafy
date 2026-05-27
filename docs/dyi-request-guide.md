# How to request your Meta Download Your Information (DYI) export

> **Audience:** internal — Alex + Claude. This is the engineering-flavored, source-of-truth doc. The public-facing version (stripped of Demetafy internals, with screenshots) will be derived from this at launch — tracked under Phase 3 launch prep in `tasks/todo.md`. Keep facts here verified; the public copy will inherit them.

Demetafy is built on top of Meta's official DYI export. You request a copy of your data, Meta prepares a `.zip` archive of everything they have, and you download it. Demetafy then ingests that archive locally — your data never touches our (non-existent) servers.

This guide covers requesting the export for **Instagram** and **Facebook**. The two flows are unified through Meta's Accounts Center.

## Before you start

- Preparation can take **anywhere from 1 hour to several days**, depending on how much data is on your account. Submit it now so it's ready when you want to start parsing.
- The download link in the email **expires ~4 days** after the email arrives. Set a reminder.
- Power-user archives can be **50–100+ GB** — make sure you have disk space and a stable connection.

## Step-by-step (web is easiest)

### 1. Open Accounts Center

Go to `https://accountscenter.meta.com/` and sign in.

### 2. Navigate to download

- Left sidebar → **Your information and permissions**
- Click **Download your information**
- Click **Download or transfer information**

### 3. Choose a profile — one at a time

Meta shows you a **"Choose a profile"** dialog. Even when Facebook, Instagram, and Meta are linked under the same Accounts Center, **each profile is exported separately** — there is no "do everything at once" shortcut. Expect to see:

- **Facebook** (your real name)
- **Instagram** (your @handle)
- **Meta** (a separate identity used for Threads, Meta AI, Meta Quest if you have any of those)

Pick **one profile**, complete the full request flow below, then come back here and repeat for the next profile. Format, media quality, and date range are chosen **per profile** — they do not carry over.

For Demetafy Phase 0 (Alex' personal validation), prioritize **Instagram first**, then Facebook, then Meta. Phase 0 parsers target Instagram; Facebook is Phase 2; the Meta profile mostly maps to Phase 3 (Threads).

### 4. Choose what to include

For Demetafy, request **"All available information"**.

Reasoning: it's easier than picking and choosing, the archive shape will be the same, and you can ignore categories Demetafy doesn't yet parse.

If you want to minimize size, the categories Demetafy actively uses are:

- **Instagram:** Profile, Posts, Stories, Reels, Saved, Collections, Messages, Followers and following
- **Facebook:** Profile, Posts, Photos and videos, Albums, Messages, Friends, Comments, Reactions

### 5. Choose destination

- Select **Download to device** (not transfer to another service).

### 6. Choose format — IMPORTANT

Three separate sub-screens. Meta defaults are wrong for Demetafy — you must actively change each:

- **Format → JSON.** HTML is selected by default; Demetafy requires JSON. The HTML format is for human reading only and is not parsable by Demetafy.
- **Media quality → Higher quality.** Medium quality is selected by default. Pick *Higher quality* — anything lower means photos and videos come back further compressed beyond Meta's already-compressed serving copies.
- **Date range → All time.**

Each sub-screen has its own **Save** button. You'll click Save three times before submitting the request.

### 7. Submit and wait

You'll get an email when the archive is ready. For active accounts this is usually 24–48 hours; for very large accounts it can take ~4 days.

### 8. When the email arrives

- Click the link in the email (or return to Accounts Center → Download your information).
- Re-enter your password.
- Download every `.zip` file. Large archives are split into multiple parts (e.g. `instagram-yourname-1.zip`, `-2.zip`, …) — **download all of them**.
- Place them under `Demetafy/data/archives/`:
  - Instagram zip(s) → `Demetafy/data/archives/instagram/`
  - Facebook zip(s) → `Demetafy/data/archives/facebook/`

## Optional: E2EE chats (do this alongside the main request)

Instagram **deprecated end-to-end-encrypted DMs on 2026-05-08**. If you used encrypted chats before that date, those threads may live in a separate **secure-storage** download (PIN-gated) rather than the main DYI. The secure-storage path may not stay available indefinitely post-deprecation — trigger it now to be safe.

1. Instagram app → **Settings** → **Privacy and security** → **End-to-end encrypted chats** (or **Secure storage**).
2. If prompted, enter your secure-storage PIN. (If you never set one, you probably have no E2EE history — skip.)
3. Choose **Download your data** for end-to-end encrypted messages.
4. Save the resulting file alongside your main archive, under `Demetafy/data/archives/instagram-e2ee/`.

If you can't find this option, it likely means either (a) you never used E2EE chats, or (b) Meta has already removed the export path. Note this in your notes — Demetafy will flag missing E2EE threads when the archive is parsed.

## What's in the archive (and what isn't)

Worth knowing before you wait days for the export:

- **Your own posts, stories, reels, profile** — full media included.
- **DMs (regular):** text + media files included. Excluded: View Once / Vanishing Mode media, Unsent messages, anything the other party deleted.
- **Saved posts:** only a list of permalinks — no media files. Demetafy fetches them via yt-dlp after import.
- **Photos others tagged you in:** not included — those live in the tagger's archive.

## Verification

After download, check:

- All zip parts present (file names usually end with `_part_1`, `_part_2`, etc.).
- Total size matches what the download page reported.
- Try unzipping one part — you should see folders like `your_instagram_activity/`, `messages/`, `media/`, etc.

## What to do next

Once your archives are in `data/archives/`, return to the Demetafy project and start a new Claude session. The next step is in `tasks/todo.md` under **"Demetafy (next Claude session, once archives are in place)"** — scaffolding the Phase 0 CLI.

## Troubleshooting

- **"Your download is empty / very small"** — Almost always means HTML format was selected. Re-request as JSON.
- **"Link expired"** — Re-request the export. Another wait, unfortunately.
- **"My private account's saved posts can't be downloaded by yt-dlp"** — Expected; private content needs a logged-in cookie jar. Phase 0 will add an opt-in flag for this.
- **"I get two download buttons, Facebook and Instagram"** — That's fine, request both. They produce separate archives with different internal layouts; Demetafy handles each.
