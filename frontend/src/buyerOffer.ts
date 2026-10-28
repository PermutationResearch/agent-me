/** Currency inputs have exactly two minor-unit places. No floating-point rounding. */
export function parseOfferAmount(value: string): number | null {
  const input = value.trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor >= 1 && minor <= 1_000_000_000 ? minor : null;
}

