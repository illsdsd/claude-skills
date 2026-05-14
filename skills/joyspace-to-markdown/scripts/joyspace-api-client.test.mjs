import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCookieHeader,
  normalizeBrowserCookiePayload,
  normalizeCookieMap,
} from "./joyspace-api-client.mjs";

test("buildCookieHeader supports relay-style browser cookie jar", () => {
  const header = buildCookieHeader({
    cookies: {
      "sso.jd.com": "sso-123",
      me_token: "me-456",
      thor: "thor-789",
      empty: "",
    },
  });

  assert.equal(header, "sso.jd.com=sso-123; me_token=me-456; thor=thor-789");
});

test("buildCookieHeader ignores removed token-style auth inputs", () => {
  assert.equal(buildCookieHeader({ meToken: "me-456", ssoToken: "sso-123" }), "");
});

test("normalizeBrowserCookiePayload validates browser_cookie3 output", () => {
  assert.deepEqual(
    normalizeBrowserCookiePayload({
      ok: true,
      source: "chrome",
      cookies: {
        "sso.jd.com": " sso-123 ",
        "": "ignored",
        blank: "",
      },
    }),
    {
      cookies: {
        "sso.jd.com": "sso-123",
      },
      source: "chrome",
      error: "",
    },
  );

  assert.deepEqual(normalizeCookieMap(null), {});
  assert.match(
    normalizeBrowserCookiePayload({ ok: false, error: "not installed" }).error,
    /not installed/,
  );
});
