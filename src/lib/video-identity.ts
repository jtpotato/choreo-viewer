import type { VideoIdentity } from "./types";

const SAMPLE_SIZE = 64 * 1024;

/** Fingerprints the file's metadata and edges without reading a large video into memory. */
export async function identifyVideo(file: File): Promise<VideoIdentity> {
  const head = file.slice(0, SAMPLE_SIZE);
  const tail = file.slice(Math.max(0, file.size - SAMPLE_SIZE));
  const [headBytes, tailBytes] = await Promise.all([head.arrayBuffer(), tail.arrayBuffer()]);
  const metadata = new TextEncoder().encode(`${file.name}:${file.size}:${file.lastModified}`);
  const digestInput = new Uint8Array(headBytes.byteLength + tailBytes.byteLength + metadata.byteLength);
  digestInput.set(new Uint8Array(headBytes), 0);
  digestInput.set(new Uint8Array(tailBytes), headBytes.byteLength);
  digestInput.set(metadata, headBytes.byteLength + tailBytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  const shortHash = [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    key: `choreo-viewer:v1:${shortHash}`,
    name: file.name,
    size: file.size,
    modifiedAt: file.lastModified,
  };
}
