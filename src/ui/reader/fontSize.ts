export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 30;

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}
