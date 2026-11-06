// Every account keeps one hue everywhere it appears, so files and quotas are recognisable at a glance.
// Connected accounts get distinct hues in the order they were connected (see registerAccounts); anything
// not registered (e.g. a removed account in the activity log) falls back to a hash of its id.
const HUES = [207, 152, 28, 340, 265, 178, 48, 0, 295, 120];
const assigned = new Map<string, number>();

export function registerAccounts(accounts: { id: string; created_at: string }[]): void {
  const ordered = [...accounts].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  assigned.clear();
  ordered.forEach((a, i) => assigned.set(a.id, HUES[i % HUES.length]));
}

export function accountHue(id: string): number {
  const known = assigned.get(id);
  if (known !== undefined) return known;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
export const accountColor = (id: string, l = 42) => `hsl(${accountHue(id)} 62% ${l}%)`;
