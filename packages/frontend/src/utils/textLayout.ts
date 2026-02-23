export function truncateTextToWidth(
  text: string,
  maxWidth: number,
  measureWidth: (candidate: string) => number,
  ellipsis = '...'
): string {
  if (maxWidth <= 0) {
    return '';
  }

  if (text.length === 0) {
    return text;
  }

  if (measureWidth(text) <= maxWidth) {
    return text;
  }

  if (measureWidth(ellipsis) > maxWidth) {
    return '';
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (measureWidth(candidate) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${text.slice(0, low)}${ellipsis}`;
}
