import path from "node:path"
import type { BuildDirent, BuildFileSystem, BuildStats } from "../../src/build/types.js"
import { nodeBuildFileSystem } from "../../src/node/index.js"

/**
 * The real `node:fs/promises`-backed {@link BuildFileSystem} for tests -- the
 * exact adapter the package publishes as `data-cap/node` (and the
 * `data-cap` CLI's own `fs` capability). Integration/golden tests that need
 * real disk behavior use this; importing it here also gives the published
 * `./node` entry real test coverage.
 */
export const nodeBuildFs: BuildFileSystem = {
  ...nodeBuildFileSystem,
  readFile: (p, encoding) => nodeBuildFileSystem.readFile(p, assertUtf8(encoding)),
  writeFile: (p, data, encoding) => nodeBuildFileSystem.writeFile(p, data, assertUtf8(encoding)),
}

/**
 * The capability reads and writes UTF-8 text only. Node would quietly accept an empty or unknown
 * encoding (a raw buffer read, a default write), so the test doubles reject anything else: a call
 * site that passes the wrong encoding fails here instead of passing unnoticed.
 * @param encoding - the encoding a call site passed.
 * @returns the encoding, once it is known to be `"utf8"`.
 */
function assertUtf8(encoding: string): "utf8" {
  if (encoding !== "utf8") {
    throw new TypeError(`expected the "utf8" encoding, got ${JSON.stringify(encoding)}`)
  }
  return "utf8"
}

/**
 * A minimal in-memory {@link BuildFileSystem} -- a `Map<absolutePath,
 * content>`, no real disk. Proves `src/build/**` depends on the
 * `BuildFileSystem` *contract*, not on `node:fs` (ADR 0058). Not a full
 * POSIX emulator: it covers exactly the operations the build code performs,
 * with straightforward semantics.
 */
export interface InMemoryBuildFs extends BuildFileSystem {
  /** Seed or overwrite a file. Directories are implicit (any path with a matching prefix). */
  set(absolutePath: string, content: string): void
  /** Remove a file. */
  delete(absolutePath: string): void
  /** Every file path currently present. */
  paths(): string[]
}

class MissingError extends Error {
  readonly code = "ENOENT"
  constructor(op: string, p: string) {
    super(`ENOENT: no such file or directory, ${op} '${p}'`)
  }
}

export function createInMemoryBuildFs(seed: Record<string, string> = {}): InMemoryBuildFs {
  const files = new Map<string, string>(
    Object.entries(seed).map(([p, c]) => [path.normalize(p), c]),
  )

  const dirent = (name: string, isDir: boolean): BuildDirent => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  })

  return {
    set(absolutePath, content) {
      files.set(path.normalize(absolutePath), content)
    },
    delete(absolutePath) {
      files.delete(path.normalize(absolutePath))
    },
    paths() {
      return [...files.keys()]
    },
    readFile: async (p, encoding) => {
      assertUtf8(encoding)
      const content = files.get(path.normalize(p))
      if (content === undefined) throw new MissingError("open", p)
      return content
    },
    writeFile: async (p, data, encoding) => {
      assertUtf8(encoding)
      files.set(path.normalize(p), data)
    },
    mkdir: async () => {
      // Directories are implicit -- nothing to do.
    },
    readdir: async (p) => {
      const dir = path.normalize(p).replace(/\/?$/, "/")
      const childDirs = new Set<string>()
      const childFiles: string[] = []
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(dir)) continue
        const rest = filePath.slice(dir.length)
        const slash = rest.indexOf("/")
        if (slash === -1) childFiles.push(rest)
        else childDirs.add(rest.slice(0, slash))
      }
      return [
        ...[...childDirs].sort().map((name) => dirent(name, true)),
        ...childFiles.sort().map((name) => dirent(name, false)),
      ]
    },
    stat: async (p): Promise<BuildStats> => {
      const normalized = path.normalize(p)
      const content = files.get(normalized)
      if (content !== undefined) {
        return { isFile: () => true, size: Buffer.byteLength(content, "utf8") }
      }
      const dir = normalized.replace(/\/?$/, "/")
      if ([...files.keys()].some((f) => f.startsWith(dir))) {
        return { isFile: () => false, size: 0 }
      }
      throw new MissingError("stat", p)
    },
    realpath: async (p) => path.normalize(p),
  }
}
