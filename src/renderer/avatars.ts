/**
 * Portrait handling: downscale uploads so saves stay small, and cache decoded
 * images for the renderer.
 */

const PORTRAIT_PX = 256;

/** Read an image file, center-crop it to a square and downscale it to a compact data URL. */
export async function portraitFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2,
    sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(PORTRAIT_PX, side);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // WebP keeps portraits ~10-20 KB; browsers without WebP encoding fall back to PNG automatically.
  return canvas.toDataURL('image/webp', 0.85);
}

const cache = new Map<string, HTMLImageElement>();

/** Get a decoded image for a data URL; calls `onLoad` once when a new one finishes loading. */
export function getPortrait(src: string, onLoad: () => void): HTMLImageElement | null {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
