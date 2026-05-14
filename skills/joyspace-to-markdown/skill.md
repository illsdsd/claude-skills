---
name: joyspace-to-markdown
description: Export a JoySpace document page to a markdown file through JoySpace APIs. Use when the user provides a JoySpace document link and wants markdown output in a target directory or the current project root.
---

# JoySpace To Markdown

Use this skill to turn a JoySpace document page into a local `.md` file.

Primary execution path:

- Use `node scripts/export-joyspace-markdown.mjs --url <joyspace-url>`
- Resolve JoySpace auth only through relay-style browser cookies (`browser_cookie3` reading `jd.com` cookies from Chrome first, then other supported browsers)
- Fetch page metadata and `data.content` through JoySpace HTTP APIs
- Convert API blocks into markdown locally and write the result to disk

## Required Input

- JoySpace document link

## Optional Input

- Output directory
  - If omitted or empty, save into the current project root.
- Output filename
  - If omitted, derive the filename from the extracted page title.
- `tenantCode`
  - Optional override for JoySpace team header. Defaults to `CN.JD.GROUP`.
- Target URL pattern
  - Default: `joyspace.jd.com/pages/`
  - Also supports other JoySpace page URLs that contain a page id, such as `page/`, `doc/`, `table/`, `ppt/`, `board/`, `mind/`, and `meeting/`.

## Workflow

1. Validate the input.
   - If the JoySpace link is missing, stop and ask for it.
   - Do not guess the link from browser history or open tabs.
2. Decide the output path.
   - If the user gave a directory, save there.
   - Otherwise, save in the current project root.
3. Resolve JoySpace auth.
   - Use the same cookie-loading path as `relay-d2c-b`: read `jd.com` cookies through Python `browser_cookie3`, with Chrome as the validated first source and other supported browsers as fallback.
   - Browser cookie mode requires `python3` and `browser_cookie3`; if missing, install with `python3 -m pip install browser_cookie3` and make sure Chrome is logged in to `joyspace.jd.com` / `jd.com`.
   - Do not use `ME_TOKEN`, `SSO_TOKEN`, `~/.joyclaw/openclaw.json`, startup token, or local HiOffice exchange as alternate auth paths.
4. Parse the JoySpace page id from the URL.
5. Request page metadata.
   - Call `GET /v3/pages/<pageId>/basic?sendRecent=0` to resolve the page title, `page_type`, `origin_id`, and location metadata.
6. Handle special page types:
   - If `page_type === 5` (reference/copy page) and `origin_id` present, fallback to fetching content and title from the `origin_id`. This resolves `PAGE_TYPE_NOT_SUPPORT` (errCode 400405) errors from the content API.
   - Log info/warnings to stderr for transparency.
7. Request page content.
   - Call `POST /v1/pages/content` with `{ pageId }` (or effective `origin_id` for type 5).
   - Expect `data.content` to be a non-empty array of JoySpace content blocks. Improved error detection now throws clear messages including `errCode`/`errMsg`.
8. Convert `data.content` into markdown locally.
   - Keep the page title as the top-level `#` heading.
   - Convert paragraphs, heading-style lists, normal lists, tables, images, foldable blocks, highlight blocks, dividers, and `text-draw` blocks.
   - For `diagram` blocks: fetch metadata via `GET /v1/diagram/<diagramId>/detail?pageId=<pageId>`, download the `linkUrl` drawio XML in memory, and render in this priority order (the `.md` file is the only on-disk artifact; no drawio attachment is ever written):
     1. If `JOYSPACE_DRAWIO_EXPORT_URL` is set and returns a valid SVG, embed the SVG inline.
     2. Otherwise decode the drawio XML (base64 + raw inflate + URI-decode) into mxGraph XML and convert vertices/edges into a ` ```mermaid flowchart TD ``` ` code block (rhombus → `{}`, ellipse → `(())`, rounded rect → `()`, default rect → `[]`).
     3. If mermaid conversion fails (unsupported shape-heavy diagram, over node cap, or download failure), fall back to a blockquote with title, original JoySpace page link, and `diagramId`.
   - Emit a placeholder warning only when the diagram detail request itself fails (network/auth failure).
8. Validate the conversion result.
   - If `data.content` is empty, stop and report that the API did not return usable page content.
   - If converted markdown is empty, stop and report a conversion failure instead of fabricating content.
9. Sanitize the filename before writing.
   - Use the extracted `title` when available.
   - Replace path-invalid characters such as `/`, `\\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`.
   - Default to `Doc.md` if no usable title is returned.
10. Write the markdown file locally.
   - Output filename: `<sanitizedTitle>.md`
   - Output location: user-provided directory, or the current project root when omitted.
11. Reply with:
   - the final output file path
   - the resolved document title
   - the browser cookie source, such as `chrome`
   - any conversion caveats such as `diagram` placeholders or other unsupported block types

## Output Rules

- Always save a real markdown file, not chat-only output.
- Preserve the converted markdown body unless a write-time cleanup is required for filename safety.
- Keep remote image URLs as-is.

## Bundled Resource

- `scripts/joyspace-api-client.mjs`
  - Resolves JoySpace auth exclusively through relay-style browser cookie loading with Python `browser_cookie3`, and wraps `basic` / `content` / diagram `detail` API calls, plus direct drawio XML download.
- `scripts/joyspace-content-to-markdown.mjs`
  - Converts JoySpace API block data into markdown, including `diagram` blocks when provided a `diagrams` map, and surfaces conversion warnings (`diagram-svg` / `diagram-mermaid` / `diagram-link` / `diagram`).
- `scripts/joyspace-drawio-to-mermaid.mjs`
  - Decodes drawio XML (base64 + raw inflate + URI-decode) and converts the inner mxGraph into a mermaid `flowchart TD` block. Label cleaning strips HTML, decodes entities, and collapses whitespace. Shape detection maps rhombus / ellipse / parallelogram / hexagon / cylinder / process to the matching mermaid node syntax.
- `scripts/export-joyspace-markdown.mjs`
  - Resolves auth, loads JoySpace content through HTTP APIs, pre-fetches all `diagram` blocks (detail + XML) in memory, attempts SVG (if `JOYSPACE_DRAWIO_EXPORT_URL` is set) then mermaid conversion, and writes a single Markdown file. No `.drawio` files are persisted.
  - Supports `--output-dir`, `--output-name`, and `--tenant-code`.
  - Reads `JOYSPACE_DRAWIO_EXPORT_URL` to optionally inline diagrams as SVG. Any drawio-compatible export endpoint that accepts `POST application/xml` and returns `image/svg+xml` works (e.g. `jgraph/drawio-export`).

## Failure Handling

- Missing JoySpace link: stop and ask for the link.
- Output directory does not exist: report the path and ask for a valid directory, unless the directory was omitted and the current project root is being used.
- JoySpace auth cannot be resolved: report that relay-style browser cookie loading failed; ask the user to install `browser_cookie3` and log in with Chrome to `joyspace.jd.com` / `jd.com`.
- `basic` or `content` API returns an error: report the API failure clearly (now includes `errCode`/`errMsg` like 400405 PAGE_TYPE_NOT_SUPPORT) instead of fabricating markdown.
- page_type=5 (reference pages): automatically fallback to `origin_id` for content and title; logs to stderr.
- `data.content` is empty or malformed: stop and report that the page content was not returned by the API (includes page_type and origin info).
- Unsupported block types appear: preserve the supported content, surface warnings, and mark unknown blocks with placeholders when possible.
- Other page_types: log warning to stderr if not 5 or 13.
- Diagram detail or XML download fails: log a `stderr` message for that `diagramId`, keep exporting other blocks, and emit the `diagram` placeholder warning in markdown so the user can retry.
- `JOYSPACE_DRAWIO_EXPORT_URL` is unreachable or returns non-SVG: fall back to the drawio attachment link group so the export still succeeds.

## Safety Boundaries

- Do not submit edits back to JoySpace.
- Do not guess hidden content that was not present in the API response.
- Do not overwrite an existing file silently; if the destination file already exists, either confirm with the user or write a non-conflicting filename.
