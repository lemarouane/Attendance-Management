import CryptoJS from "crypto-js";

const QR_SECRET = "ENSAT_QR_SECRET_KEY_2024_SECURE";

export interface QRPayload {
  uid: string;
  t: number;
  token: string;
}

export function generateQRPayload(uid: string): QRPayload {
  const t = Math.floor(Date.now() / 1000);
  const token = CryptoJS.SHA256(`${uid}|${t}|${QR_SECRET}`).toString();
  return { uid, t, token };
}

export function validateQRPayload(payload: QRPayload, maxAgeSeconds = 30): boolean {
  const now = Math.floor(Date.now() / 1000);
  const age = now - payload.t;

  if (age < 0 || age > maxAgeSeconds) return false;

  const expectedToken = CryptoJS.SHA256(
    `${payload.uid}|${payload.t}|${QR_SECRET}`
  ).toString();

  return expectedToken === payload.token;
}
