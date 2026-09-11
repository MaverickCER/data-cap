/**
 * The filesystem capability `data-cap/build` requires from its caller.
 *
 * `./build` is a **library surface**: it must not acquire filesystem access
 * implicitly (no `node:fs` import anywhere under `src/` outside `src/cli/`).
 * Every public options object in `build/index.ts` carries a required `fs`
 * field of this type, and the caller supplies a concrete adapter -- the
 * `data-cap` CLI builds one over `node:fs/promises` (`src/cli/filesystem.ts`);
 * a test builds either that same real adapter or an in-memory fake. See ADR
 * 0058.
 *
 * "Ambient-fs-free" means specifically: `./build` never reaches for
 * `node:fs` itself. It still performs real filesystem operations -- the
 * capability is always handed in.
 *
 * The shape is modeled on `node:fs/promises`'s own signatures so a thin
 * adapter is a drop-in value, but uses minimal structural types
 * ({@link BuildDirent}/{@link BuildStats}) rather than Node's `Dirent`/
 * `Stats` -- the capability boundary shouldn't leak Node's type surface just
 * because the concrete adapter happens to be Node-backed. Only the
 * operations `src/build/**` actually calls are here.
 *
 * **Not shared with `@maverickcer/env-cap`.** The two packages are
 * independent products with no runtime coupling; a shared types package to
 * dedupe six signatures would add real cross-package coupling for negligible
 * benefit. env-cap has its own, structurally-identical interface.
 */
export interface BuildFileSystem {
  /** Read a UTF-8 text file. Rejects if the path doesn't exist or isn't readable. */
  readonly readFile: (path: string, encoding: "utf8") => Promise<string>
  /** Write a UTF-8 text file, creating or truncating it. The parent directory must already exist. */
  readonly writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>
  /** Create a directory and every missing parent. A no-op if it already exists. */
  readonly mkdir: (path: string, options: { readonly recursive: true }) => Promise<void>
  /** List a directory's entries with their file-type info. */
  readonly readdir: (
    path: string,
    options: { readonly withFileTypes: true },
  ) => Promise<readonly BuildDirent[]>
  /** Stat a path (following symlinks). Rejects if the path doesn't exist. */
  readonly stat: (path: string) => Promise<BuildStats>
  /** Resolve a path to its canonical, symlink-free absolute form. */
  readonly realpath: (path: string) => Promise<string>
}

/** One directory entry from {@link BuildFileSystem.readdir} -- the subset of Node's `Dirent` `src/build/**` reads. */
export interface BuildDirent {
  readonly name: string
  readonly isDirectory: () => boolean
  readonly isFile: () => boolean
}

/** A path's stat info from {@link BuildFileSystem.stat} -- the subset of Node's `Stats` `src/build/**` reads. */
export interface BuildStats {
  readonly isFile: () => boolean
  /** Size in bytes -- read by the package-schema resolver to enforce a size ceiling. */
  readonly size: number
}
