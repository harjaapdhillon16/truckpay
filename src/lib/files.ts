import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

const SAFE = /^[A-Za-z0-9._-]+$/;

export function uploadsDir(loadId: string) {
  const dir = path.join(config.dataDir, "uploads", loadId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Saves an upload and returns its public name (served by /api/files/<loadId>/<name>). */
export function saveUpload(loadId: string, name: string, data: Buffer) {
  if (!SAFE.test(name)) throw new Error("unsafe file name");
  writeFileSync(path.join(uploadsDir(loadId), name), data);
  return name;
}

export function readUpload(loadId: string, name: string): Buffer | null {
  if (!SAFE.test(loadId) || !SAFE.test(name)) return null;
  try {
    return readFileSync(path.join(config.dataDir, "uploads", loadId, name));
  } catch {
    return null;
  }
}

export function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "jpg";
}

export function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
    }[ext ?? ""] ?? "application/octet-stream"
  );
}
