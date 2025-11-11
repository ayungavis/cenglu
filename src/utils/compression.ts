import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

let zlib: typeof import("node:zlib") | undefined;
try {
  zlib = require("node:zlib");
} catch {
  // zlib is optional for zero-dependency
}

export async function compressFile(inputPath: string, outputPath: string): Promise<void> {
  if (!zlib) {
    throw new Error("Compression requuires Node.js zlib module");
  }

  const gzip = zlib.createGzip({ level: 9 });
  const source = createReadStream(inputPath);
  const destination = createWriteStream(outputPath);

  await pipeline(source, gzip, destination);
  await unlink(inputPath); // remove original file after compression
}

export async function decompressFile(inputPath: string, outputPath: string): Promise<void> {
  if (!zlib) {
    throw new Error("Compression requuires Node.js zlib module");
  }

  const gunzip = zlib.createGunzip();
  const source = createReadStream(inputPath);
  const destination = createWriteStream(outputPath);

  await pipeline(source, gunzip, destination);
}

export function isCompressionAvailable(): boolean {
  return !!zlib;
}

export function getCompressedFilename(filename: string): string {
  return `${filename}.gz`;
}
