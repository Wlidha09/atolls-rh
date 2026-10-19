import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonResponse } from '../lib/http-client.js';
test('valid JSON API responses are decoded', async () => {
  assert.deepEqual(await readJsonResponse(Response.json({ ok: true })), { ok: true });
});
test('empty API responses show HTTP status and useful diagnostics', async () => {
  await assert.rejects(() => readJsonResponse(new Response('', { status: 502 })), /empty response \(HTTP 502\).*Netlify/);
});
test('HTML error pages are not mistaken for JSON or exposed as raw HTML', async () => {
  await assert.rejects(() => readJsonResponse(new Response('<h1>Gateway error</h1>', { status: 500 })), /non-JSON response \(HTTP 500\)/);
});
