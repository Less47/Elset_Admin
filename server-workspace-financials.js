// Shared integer arithmetic for runtime records and offline migration validation.
const QUANTITY_SCALE = 1_000_000;

function decimalParts(value) {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!match) return { sign: 1n, whole: "0", fraction: "" };
  return {
    sign: match[1] ? -1n : 1n,
    whole: match[2] || "0",
    fraction: match[3] || "",
  };
}

export function decimalToScaledInteger(value, scale) {
  const { sign, whole, fraction } = decimalParts(value);
  const scaleBigInt = BigInt(scale);
  const scaleDigits = String(scale).length - 1;
  const wholeUnits = BigInt(whole || "0") * scaleBigInt;
  const normalizedFraction = fraction.padEnd(scaleDigits + 1, "0");
  const kept = normalizedFraction.slice(0, scaleDigits) || "0";
  const nextDigit = Number(normalizedFraction[scaleDigits] || "0");
  const roundedFraction = BigInt(kept) + (nextDigit >= 5 ? 1n : 0n);
  const result = sign * (wholeUnits + roundedFraction);
  const asNumber = Number(result);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`Decimal value is too large to store safely: ${value}`);
  }
  return asNumber;
}

export function moneyToCents(value) {
  return decimalToScaledInteger(value, 100);
}

export function lineTotalCentsFromScaled(quantityMicros, rateCents) {
  const numerator = BigInt(quantityMicros) * BigInt(rateCents);
  const half = BigInt(Math.floor(QUANTITY_SCALE / 2));
  const rounded = numerator >= 0n
    ? (numerator + half) / BigInt(QUANTITY_SCALE)
    : (numerator - half) / BigInt(QUANTITY_SCALE);
  const asNumber = Number(rounded);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error("Line item total is too large to store safely.");
  }
  return asNumber;
}

export function documentSubtotalCents(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const quantityMicros = decimalToScaledInteger(item?.qty ?? 0, QUANTITY_SCALE);
    const rateCents = moneyToCents(item?.rate ?? 0);
    return sum + lineTotalCentsFromScaled(quantityMicros, rateCents);
  }, 0);
}

export function gstCentsFromSubtotal(subtotalCents) {
  return Math.round(Number(subtotalCents || 0) / 10);
}

export function documentTotalCents(items = []) {
  const subtotalCents = documentSubtotalCents(items);
  return subtotalCents + gstCentsFromSubtotal(subtotalCents);
}

