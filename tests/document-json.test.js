import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { gzipSync } from "node:zlib";
import express from "express";
import { createDocumentJsonParser, DOCUMENT_JSON_LIMIT_BYTES } from "../server-document-json.js";

test("document parser enforces finite byte limits, including chunked and inflated bodies, with safe diagnostics", async (t) => {
  const app = express();
  const logs = [];
  let handlerCalls = 0;
  app.post("/api/quotes/preview-pdf", createDocumentJsonParser({ logger: { warn: (...args) => logs.push(args) } }), (_req, res) => {
    handlerCalls++;
    res.json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/quotes/preview-pdf?private=do-not-log`;
  const exact = JSON.stringify({ notes: "x".repeat(DOCUMENT_JSON_LIMIT_BYTES - Buffer.byteLength(JSON.stringify({ notes: "" }))) });
  const post = (body, headers = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
  assert.equal((await post(exact)).status, 200);
  const oversized = exact.replace('"notes"', '"notess"');
  assert.equal((await post(oversized)).status, 413);
  const compressed = await post(gzipSync(oversized), { "Content-Encoding": "gzip" });
  assert.equal(compressed.status, 413);
  assert.deepEqual(await compressed.json(), { error: "PDF preview payload is too large." });
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.write(oversized.slice(0, 1024));
    req.end(oversized.slice(1024));
  });
  assert.equal(chunked, 413);
  assert.equal(handlerCalls, 1);
  assert.equal(logs.length, 3);
  for (const [message, details] of logs) {
    assert.equal(message, "[document-json] Request exceeded size limit");
    assert.deepEqual(Object.keys(details), ["endpoint", "contentLength", "limitBytes", "exceededAllowedSize"]);
    assert.equal(details.endpoint, "/api/quotes/preview-pdf");
    assert.equal(details.limitBytes, DOCUMENT_JSON_LIMIT_BYTES);
    assert.equal(details.exceededAllowedSize, true);
  }
  assert.equal(logs[0][1].contentLength, DOCUMENT_JSON_LIMIT_BYTES + 1);
  assert.equal(logs[2][1].contentLength, null);
});
