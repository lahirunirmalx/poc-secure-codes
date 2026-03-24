import { createHmac, randomBytes } from "crypto";

type KeyType = "main" | "sub";

interface ParsedKey {
  type: KeyType;
  key: string;
}

const MAIN_LONG_PREFIX = "MK";
const MAIN_LONG_BODY_LENGTH = 18;
const MAIN_LONG_SIG_LENGTH = 8;
const MAIN_SHORT_LENGTH = 12;
const MAIN_SHORT_BODY_LENGTH = 11;
const LEGACY_SUB_LENGTH = 6;
const LEGACY_SUB_BODY_LENGTH = 5;
const SUB_PREFIX = "S";
const SUB_BODY_LENGTH = 10;
const SUB_SIG_LENGTH = 4;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function requireSecret(): string {
  const secret = process.env.KEY_SIGNING_SECRET;
  if (!secret) {
    throw new Error("Missing KEY_SIGNING_SECRET");
  }
  return secret;
}

function hmacDigest(namespace: string, input: string): Buffer {
  return createHmac("sha256", requireSecret()).update(`${namespace}:${input}`).digest();
}

function checksumDigit(namespace: string, body: string): string {
  const digest = hmacDigest(namespace, body);
  return String(digest[0] % 10);
}

function toBase32(input: Buffer): string {
  let bits = "";
  for (const byte of input) {
    bits += byte.toString(2).padStart(8, "0");
  }

  let output = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

function randomAlphaNumeric(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return out;
}

function deriveMainLongSignature(body: string): string {
  return toBase32(hmacDigest("main-long-signature", body)).slice(0, MAIN_LONG_SIG_LENGTH);
}

function deriveMainShortFromLong(mainLongKey: string): string {
  const body = toBase32(hmacDigest("main-short-derive", mainLongKey)).slice(
    0,
    MAIN_SHORT_BODY_LENGTH
  );
  const check = checksumDigit("main-short-checksum", body);
  return `${body}${check}`;
}

function verifyMainLongKey(key: string): boolean {
  if (!key.startsWith(MAIN_LONG_PREFIX)) {
    return false;
  }
  const raw = key.slice(MAIN_LONG_PREFIX.length);
  if (raw.length !== MAIN_LONG_BODY_LENGTH + MAIN_LONG_SIG_LENGTH) {
    return false;
  }
  const body = raw.slice(0, MAIN_LONG_BODY_LENGTH);
  const signature = raw.slice(MAIN_LONG_BODY_LENGTH);
  return deriveMainLongSignature(body) === signature;
}

function verifyMainShortFormat(key: string): boolean {
  if (!/^[A-Z2-7]+$/.test(key)) {
    return false;
  }
  if (key.length !== MAIN_SHORT_LENGTH) {
    return false;
  }
  const body = key.slice(0, MAIN_SHORT_BODY_LENGTH);
  const check = key.slice(-1);
  return checksumDigit("main-short-checksum", body) === check;
}

function verifySubKeyFormat(key: string): boolean {
  // Backward-compatibility with old numeric sub keys.
  if (/^\d+$/.test(key) && key.length === LEGACY_SUB_LENGTH) {
    const body = key.slice(0, LEGACY_SUB_BODY_LENGTH);
    const check = key.slice(-1);
    return checksumDigit("sub-legacy", body) === check;
  }

  if (!key.startsWith(SUB_PREFIX)) {
    return false;
  }
  if (!/^[A-Z2-7]+$/.test(key)) {
    return false;
  }
  if (key.length !== SUB_PREFIX.length + SUB_BODY_LENGTH + SUB_SIG_LENGTH) {
    return false;
  }
  const body = key.slice(SUB_PREFIX.length, SUB_PREFIX.length + SUB_BODY_LENGTH);
  const signature = key.slice(-SUB_SIG_LENGTH);
  const expected = toBase32(hmacDigest("sub-signature", body)).slice(0, SUB_SIG_LENGTH);
  return expected === signature;
}

export function createMainKeyPair(): { longKey: string; shortKey: string } {
  const body = randomAlphaNumeric(MAIN_LONG_BODY_LENGTH);
  const signature = deriveMainLongSignature(body);
  const longKey = `${MAIN_LONG_PREFIX}${body}${signature}`;
  const shortKey = deriveMainShortFromLong(longKey);
  return { longKey, shortKey };
}

export function createSubKey(): string {
  const body = randomAlphaNumeric(SUB_BODY_LENGTH);
  const signature = toBase32(hmacDigest("sub-signature", body)).slice(0, SUB_SIG_LENGTH);
  return `${SUB_PREFIX}${body}${signature}`;
}

export function parseAndVerifyKey(key: string): ParsedKey | null {
  if (!key || typeof key !== "string") {
    return null;
  }

  const trimmed = key.trim().toUpperCase();

  if (verifyMainLongKey(trimmed) || verifyMainShortFormat(trimmed)) {
    return { type: "main", key: trimmed };
  }

  if (verifySubKeyFormat(trimmed)) {
    return { type: "sub", key: trimmed };
  }

  return null;
}

export function isMainLongKey(key: string): boolean {
  return verifyMainLongKey(key.trim().toUpperCase());
}

export function isMainShortKey(key: string): boolean {
  return verifyMainShortFormat(key.trim().toUpperCase());
}

export function keyLengths() {
  return {
    mainLong: MAIN_LONG_PREFIX.length + MAIN_LONG_BODY_LENGTH + MAIN_LONG_SIG_LENGTH,
    mainShort: MAIN_SHORT_LENGTH,
    sub: SUB_PREFIX.length + SUB_BODY_LENGTH + SUB_SIG_LENGTH,
  };
}
