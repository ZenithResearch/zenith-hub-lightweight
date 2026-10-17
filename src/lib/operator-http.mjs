import { OperatorError } from "./pilot-controller.mjs";
/** Read bytes before decoding, with both a size limit and an absolute deadline. */
export async function readAction(
  request,
  { limit = 2048, deadline = 2000 } = {},
) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new OperatorError("request_too_large", 413);
  if (!request.body) throw new OperatorError("invalid_request");
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  let timer;
  try {
    const completed = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new OperatorError("request_too_large", 413);
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new OperatorError("invalid_request");
      }
    })();
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new OperatorError("request_timeout", 408));
        void reader.cancel().catch(() => {});
      }, deadline);
    });
    return await Promise.race([completed, timedOut]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

/** Next dev reports localhost for numeric-loopback requests. Admit only that exact
 * same-port internal spelling, then validate the effective origin in the controller.
 * Never trust forwarded-host/proto headers or arbitrary URL origins. */
export function normalizeNextRequest(
  request,
  origin = process.env.ZENITH_OPERATOR_ORIGIN || "http://127.0.0.1:4208",
) {
  const expected = new URL(origin),
    actual = new URL(request.url),
    internal = new URL(origin);
  internal.hostname = "localhost";
  if (
    expected.origin !== origin ||
    expected.protocol !== "http:" ||
    expected.hostname !== "127.0.0.1" ||
    !expected.port ||
    request.headers.get("host") !== expected.host ||
    ![expected.origin, internal.origin].includes(actual.origin)
  )
    throw new OperatorError("wrong_host", 403);
  actual.protocol = expected.protocol;
  actual.host = expected.host;
  return { url: actual.href, headers: request.headers };
}
