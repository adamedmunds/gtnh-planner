export function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'build';
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string): void {
  downloadBytes(new TextEncoder().encode(text), filename, 'application/json');
}
