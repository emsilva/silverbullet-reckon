/**
 * Minimal ambient declarations for @silverbulletmd/silverbullet/syscalls.
 *
 * The real package ships raw Deno-style `.ts` source files that import each
 * other with `.ts` extensions and have transitive deps on package-internal
 * `client/` modules that are not present in the npm distribution.  Letting
 * TypeScript follow those import chains produces spurious errors that have
 * nothing to do with our code.
 *
 * This file declares only the subset of the API that plug.ts actually uses so
 * that `tsc --noEmit` stays clean.  The real types live in the SB package and
 * will be enforced at build time by `plugos-bundle` / the SB build tool.
 */

declare module "@silverbulletmd/silverbullet/syscalls" {
  export const editor: {
    getText(): Promise<string>;
    setText(newText: string, isolateHistory?: boolean): Promise<void>;
    showPanel(
      id: "lhs" | "rhs" | "bhs" | "modal",
      mode: number,
      html: string,
      script?: string,
    ): Promise<void>;
    hidePanel(id: "lhs" | "rhs" | "bhs" | "modal"): Promise<void>;
  };
}
