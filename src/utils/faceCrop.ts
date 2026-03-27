/**
 * Utility to crop a face from an image and place it on a white background.
 * Uses face-api.js for precise landmark detection.
 */

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    faceapi: any;
  }
}

const FACEAPI_CDN = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODEL_BASE  = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

async function loadFaceApi(): Promise<void> {
  if (window.faceapi) return;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = FACEAPI_CDN;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load face-api.js"));
    document.head.appendChild(script);
  });
}

async function loadModels(): Promise<void> {
  const faceapi = window.faceapi;
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE),
  ]);
}

export async function processSelfieImage(base64Image: string): Promise<string> {
  await loadFaceApi();
  const faceapi = window.faceapi;
  await loadModels();

  // Create image element to process
  const img = new Image();
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = base64Image;
  });

  // Detect face with landmarks
  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks();

  if (!detection) {
    console.warn("No face detected for cropping. Returning original.");
    return base64Image;
  }

  const landmarks = detection.landmarks;
  const positions = landmarks.positions;

  // 1. Define the clipping path (Face Mask)
  // Jawline is points 0 to 16.
  // We need to complete the loop around the forehead.
  // We'll estimate the forehead by mirroring the jawline or using eyebrows + offset.
  
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return base64Image;

  // Set canvas size (square crop)
  const box = detection.detection.box;
  const size = Math.max(box.width, box.height) * 1.5; // Add padding
  canvas.width = 600;  // Standard size
  canvas.height = 600;

  // Draw white background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Calculate scaling and centering
  const scale = (canvas.width * 0.7) / box.width; // Face should take ~70% of width
  const offsetX = canvas.width / 2 - (box.x + box.width / 2) * scale;
  const offsetY = canvas.height / 2 - (box.y + box.height / 2) * scale;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Create the "Round/Oval Face" clipping path
  ctx.beginPath();
  
  // Start with jawline (0 to 16)
  ctx.moveTo(positions[0].x, positions[0].y);
  for (let i = 1; i <= 16; i++) {
    ctx.lineTo(positions[i].x, positions[i].y);
  }

  // Estimate forehead (creating an oval top)
  // Point 16 is right temple, Point 0 is left temple.
  // We'll use the top of the eyebrows (17-26) and go up.
  const leftEyebrowTop = positions[19].y;
  const rightEyebrowTop = positions[24].y;
  const browAvgY = (leftEyebrowTop + rightEyebrowTop) / 2;
  const faceHeight = positions[8].y - browAvgY;
  const foreheadTop = browAvgY - faceHeight * 0.4; // Estimate forehead height

  // Control points for the top curve
  ctx.bezierCurveTo(
    positions[16].x, positions[16].y - faceHeight * 0.3,
    positions[0].x, positions[0].y - faceHeight * 0.3,
    positions[0].x, positions[0].y
  );

  ctx.closePath();
  ctx.clip();

  // Draw the original image onto the clipped area
  ctx.drawImage(img, 0, 0);

  ctx.restore();

  // Return the processed image
  return canvas.toDataURL("image/jpeg", 0.9);
}
