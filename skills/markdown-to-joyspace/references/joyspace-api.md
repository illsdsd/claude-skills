# JoySpace API Notes

This skill relies on relay-style browser cookie loading for JoySpace API requests.

## Important limitation

This skill uses one authentication path only: Python `browser_cookie3` reads `jd.com` cookies from the local browser cookie jar.

Required runtime state:

- `python3`
- `browser_cookie3`
- a logged-in `joyspace.jd.com` / `jd.com` session in Chrome or another supported local browser

Do not use `ME_TOKEN`, `SSO_TOKEN`, `~/.joyclaw/openclaw.json`, startup token, HiOffice, or CDP/browser automation as fallback auth paths.

## Private space default

For private-space pages, JoySpace `basic` responses can return:

- `team_id: "$<current_user_id>"`
- `folder_id: ""`

The existing JoySpace plugin normalizes team IDs starting with `$` into `root`, so this skill should create private-space docs with:

```json
{
  "teamId": "root"
}
```

and no `folderId`.

## Resolve target folder from an open page

Request:

```http
GET https://apijoyspace.jd.com/v3/pages/<page_id>/basic?sendRecent=0
```

Useful fields in the response:

- `team_id`
- `folder_id`
- `title`
- `full_name`

If `team_id` starts with `$`, normalize it to `root`.

## Create a markdown-backed normal doc

Request:

```http
POST https://apijoyspace.jd.com/v1/pages
Content-Type: application/json
```

Body:

```json
{
  "title": "文档标题",
  "page_type": 13,
  "teamId": "<team_id>",
  "content": [
    { "value": "# 标题\n\n正文" }
  ],
  "contentType": "markdown"
}
```

Only include `folderId` when it is non-empty.

## Direct import helper

Primary script:

```bash
node scripts/import_markdown_doc.js --file /abs/path/doc.md
```

Optional overrides:

```bash
node scripts/import_markdown_doc.js \
  --file /abs/path/doc.md \
  --page-url https://joyspace.jd.com/pages/<page_id> \
  --tenant-code CN.JD.GROUP
```

Output is JSON containing:

- `authMode`
- `cookieSource`
- `pageId`
- `link`
- `teamId`
- `folderId`
- `verified`

## Verify created content

Request:

```http
POST https://apijoyspace.jd.com/v1/pages/content
Content-Type: application/json
```

Body:

```json
{
  "pageId": "<new_page_id>"
}
```

Expected result:

- `status: "success"`
- `data.content` contains parsed blocks from the markdown input.

## Helper server

The helper server is kept for standalone local markdown serving tests and manual experiments. It is not part of the primary import auth path.

Example:

```bash
node scripts/serve_markdown.js --file /abs/path/doc.md --port 8765
```

It serves:

- `GET /md` -> markdown file contents
- `OPTIONS /md` -> CORS preflight response

Default allowed origin is `https://joyspace.jd.com`.
