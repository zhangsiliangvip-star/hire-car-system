export const MAX_SEAL_DATA_LENGTH = 350_000;

export function isCompanySealDataUrl(value: string) {
  if (value === "") return true;
  if (value.length > MAX_SEAL_DATA_LENGTH || !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const bytes = atob(value.slice("data:image/png;base64,".length));
  if (bytes.length < 45 || bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" ||
    bytes.slice(8, 16) !== "\x00\x00\x00\x0dIHDR" ||
    bytes.slice(-12) !== "\x00\x00\x00\x00IEND\xae\x42\x60\x82") return false;
  const dimension = (offset: number) =>
    bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 +
    bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
  const width = dimension(16), height = dimension(20);
  return width > 0 && height > 0 && width <= 512 && height <= 512;
}
