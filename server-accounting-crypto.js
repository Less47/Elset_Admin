import crypto from "node:crypto";
import { accountingInfrastructureError } from "./server-accounting-errors.js";

export const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
export function accountingKey(env) {
  const value = env.ACCOUNTING_INTEGRATION_ENCRYPTION_KEY || "";
  if (!value) throw accountingInfrastructureError("missing ACCOUNTING_INTEGRATION_ENCRYPTION_KEY");
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw accountingInfrastructureError("invalid ACCOUNTING_INTEGRATION_ENCRYPTION_KEY: expected 64 hexadecimal characters");
  return Buffer.from(value, "hex");
}
export function encryptCredential(value, context, env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", accountingKey(env), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptCredential(value, context, env) {
  const key = accountingKey(env);
  try {
    const [version, iv, tag, encrypted] = String(value).split(".");
    if (version !== "v1") throw new Error();
    const cipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(encrypted, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw accountingInfrastructureError("unable to decrypt stored accounting credentials; verify the application encryption key and credential integrity", "CREDENTIAL_UNAVAILABLE", 409); }
}
