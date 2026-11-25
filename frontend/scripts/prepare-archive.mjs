import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm, rmdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { get } from "@vercel/blob";

const directory = resolve(".local");
const files = ["archive.json", "player-seasons.json"];

const present = await Promise.all(files.map(async name => {
  try {
    const details = await stat(join(directory, name));
    return details.isFile() && details.size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}));

if (!present.every(Boolean)) {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)) {
    throw new Error("The historical archive is required. Prepare both files in .local or connect the private Vercel Blob store.");
  }

  await mkdir(directory, { recursive: true });
  const staged = await mkdtemp(join(directory, "archive-build-"));
  try {
    for (const name of files) {
      const result = await get(name, { access: "private" });
      if (result?.statusCode !== 200 || !result.stream) {
        throw new Error("The private Vercel Blob store is missing " + name + ".");
      }
      await pipeline(result.stream, createWriteStream(join(staged, name)));
    }
    for (const name of files) await rename(join(staged, name), join(directory, name));
  } finally {
    for (const name of files) await rm(join(staged, name), { force: true });
    await rmdir(staged);
  }
}
