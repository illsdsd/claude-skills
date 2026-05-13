---
name: markdown-to-joyspace
description: Convert a local markdown file into a JoySpace document. Use when the user wants to create a JoySpace doc from a `.md` file, import markdown into JoySpace, or quickly publish local markdown content as a JoySpace page.
---

# Markdown to JoySpace

Use this skill when a user wants a local markdown file turned into a JoySpace document.

## Runtime Requirements

- A JoySpace/JD login state available in a local browser cookie jar.
- `python3` with `browser_cookie3` installed.
  - Install with `python3 -m pip install browser_cookie3` if missing.
  - Chrome is the validated first source, matching `relay-d2c-b`; other supported browsers are fallback sources.
- The markdown source must be a readable local file path.

## What This Skill Assumes

- The user is already logged in to `joyspace.jd.com` / `jd.com` in Chrome or another supported local browser.
- The markdown source is a local file path.

## Workflow

1. Confirm the markdown file path exists locally.
2. Resolve the target save location:
   - Default: save into JoySpace private space root.
   - If the user explicitly provides a JoySpace page or folder URL, derive `team_id` + `folder_id` from that location and override the default.
3. Import with [scripts/import_markdown_doc.js](scripts/import_markdown_doc.js).
   - Auth is resolved only through the same cookie-loading path as `relay-d2c-b`: Python `browser_cookie3` reads `jd.com` cookies, Chrome first.
   - Do not use `ME_TOKEN`, `SSO_TOKEN`, `~/.joyclaw/openclaw.json`, startup token, or local HiOffice exchange as alternate auth paths.
4. If import succeeds:
   - return the created JoySpace URL
   - report the browser cookie source
   - stop
5. Verify success by reading the new document content through JoySpace APIs.
6. Return the new JoySpace document link and where it was created.

## Failure Mode

- If relay-style browser cookie loading fails, do not try alternate auth modes.
- Stop and tell the user to install `browser_cookie3` and log in to `joyspace.jd.com` / `jd.com` in Chrome, then retry.

## Output Requirements

- Report the final JoySpace URL.
- State which team/folder was used.
- If verification fails, say whether creation failed or only content verification failed.

## Notes

- This skill creates a new JoySpace page; it does not edit an existing page in place.
- Default behavior is “save to JoySpace private space root”.
- If the user wants another location, require a JoySpace page or folder URL and derive the destination from it.
- Prefer `node scripts/import_markdown_doc.js --file /abs/path/doc.md`.
- For API details and payload shapes, read [references/joyspace-api.md](references/joyspace-api.md) before executing.
