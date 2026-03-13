import CryptoJS from "crypto-js";

export function generateDeviceFingerprint(): string {
  const components = [
    navigator.userAgent,
    navigator.platform,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.hardwareConcurrency?.toString() ?? "0",
  ];

  const raw = components.join("|");
  return CryptoJS.SHA256(raw).toString();
}

export function getStoredFingerprint(): string | null {
  return localStorage.getItem("ensat_device_fp");
}

export function storeFingerprint(fp: string): void {
  localStorage.setItem("ensat_device_fp", fp);
}

export function clearFingerprint(): void {
  localStorage.removeItem("ensat_device_fp");
}
