import "@testing-library/jest-dom/vitest";
import { File as NodeFile } from "node:buffer";
import { fetch as undiciFetch, FormData as UndiciFormData } from "undici";

/**
 * jsdom's global File/Blob/fetch are NOT the same realm/implementation
 * Node's own fetch (undici) expects — a FormData containing a jsdom File,
 * sent through `globalThis.fetch` while the jsdom test environment is
 * active, either hangs indefinitely or gets misparsed server-side as a
 * plain text field ("property file should not exist" — multer/busboy
 * never sees a filename on the part), even when the File is freshly
 * rebuilt with Node's own `node:buffer` File right before the call.
 * Confirmed by elimination: the identical request, byte-for-byte,
 * succeeds immediately (a) as a plain Node script with no test framework
 * involved, and (b) inside this SAME vitest config under `// @vitest-
 * environment node` (no jsdom). Only jsdom-environment + fetch + FormData
 * together breaks. This is purely a test-environment mismatch — the real
 * `api-client.ts` code this exercises is unchanged and works correctly in
 * an actual browser. See DECISIONS.md (step 9.4).
 *
 * Fix: bypass whatever `globalThis.fetch`/`FormData`/`File` resolve to
 * under jsdom entirely for FormData bodies, using `undici`'s own
 * (explicitly imported, realm-stable) implementations instead — the same
 * package Node's built-in fetch is itself built on, imported directly so
 * jsdom's realm can't intercept it.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.body instanceof FormData) {
    const rebuilt = new UndiciFormData();
    for (const [key, value] of init.body.entries()) {
      if (value instanceof Blob) {
        const bytes = new Uint8Array(await value.arrayBuffer());
        const filename = value instanceof File ? value.name : key;
        rebuilt.append(key, new NodeFile([bytes], filename, { type: value.type }));
      } else {
        rebuilt.append(key, value);
      }
    }
    const url = typeof input === "string" ? input : input.toString();
    const res = await undiciFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string> | undefined,
      body: rebuilt,
    });
    return res as unknown as Response;
  }
  return realFetch(input, init);
}) as typeof fetch;
