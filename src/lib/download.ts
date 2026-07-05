/** Triggers a browser download of the given bytes as a file, with no server round-trip. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Defer revocation: some browsers start the download asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
