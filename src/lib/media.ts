"use client";

/** Re-encodes a phone photo (often HEIC, 4000px) as a JPEG the verifier and the dashboard can use. */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image. Try a JPEG or PNG."));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await toBlob(canvas, "image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Pulls evenly spaced still frames out of a video in the browser, so the agent can look at the
 * unloading without the server decoding video.
 */
export async function extractFrames(file: Blob, count = 4, maxSide = 960): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await once(video, "loadeddata", 15_000);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth || maxSide, video.videoHeight || maxSide));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
    const ctx = canvas.getContext("2d")!;
    const frames: Blob[] = [];
    const times = duration ? Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count) : [0];
    for (const t of times) {
      if (duration) {
        video.currentTime = Math.min(t, Math.max(duration - 0.05, 0));
        await once(video, "seeked", 8_000);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(await toBlob(canvas, "image/jpeg", 0.8));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encoding failed"))), type, quality),
  );
}

function once(target: HTMLMediaElement, event: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Could not read that video. Try an MP4 under 30 seconds.")), timeoutMs);
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    target.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Could not read that video. Try an MP4 under 30 seconds."));
      },
      { once: true },
    );
  });
}

export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser has no GPS access."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1 ? "Location permission was denied." : "Could not get your location.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  });
}
