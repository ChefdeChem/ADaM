import assert from "node:assert/strict";
import test from "node:test";

test("renders the combat trainer shell and current state trackers", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>ADaM Combat Trainer<\/title>/i);
  assert.match(html, /Combat resources/i);
  assert.match(html, /Active effects/i);
  assert.match(html, /ADaM will roll privately for the enemies/i);
  assert.match(html, /exact enemy health/i);
  assert.match(html, /Five upload slots available/i);
  assert.doesNotMatch(html, /codex-preview/i);
});
