// 跨环境 SHA-256 / HMAC-SHA256（浏览器 crypto.subtle，Node 回退 node:crypto）
function toBytes(data) {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function nodeCrypto() {
  return import("node:crypto");
}

export async function sha256Hex(data) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", toBytes(data));
    return hex(buf);
  }
  const { createHash } = await nodeCrypto();
  return createHash("sha256").update(toBytes(data)).digest("hex");
}

export async function hmacSha256Hex(key, data) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const k = await globalThis.crypto.subtle.importKey("raw", toBytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await globalThis.crypto.subtle.sign("HMAC", k, toBytes(data));
    return hex(sig);
  }
  const { createHmac } = await nodeCrypto();
  return createHmac("sha256", toBytes(key)).update(toBytes(data)).digest("hex");
}

// 原始字节链式 HMAC：火山签名要求每一层派生用上一层的「原始字节」做 key，
// 而不是 hex 字符串（hex 字符串当 UTF-8 文本会得到完全不同的签名）。
export async function hmacSha256Bytes(key, data) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const k = await globalThis.crypto.subtle.importKey("raw", toBytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await globalThis.crypto.subtle.sign("HMAC", k, toBytes(data));
    return new Uint8Array(sig);
  }
  const { createHmac } = await nodeCrypto();
  return new Uint8Array(createHmac("sha256", toBytes(key)).update(toBytes(data)).digest());
}
