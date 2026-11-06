// Every account keeps one hue everywhere it appears, so files and quotas are recognisable at a glance.
const HUES = [207, 152, 28, 340, 265, 178, 48, 0, 295, 120];

export function accountHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
export const accountColor = (id: string, l = 42) => `hsl(${accountHue(id)} 62% ${l}%)`;
