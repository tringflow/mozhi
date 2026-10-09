// Resolver hook for `npm test`.
//
// The app is written for a bundler, so local imports are extensionless (`./audio`), and Next
// resolves them. Node's ESM loader requires a real file, so without this hook `node --test`
// cannot follow any import between source files. The hook appends the TypeScript extension,
// leaving the application code idiomatic instead of bending it to the test runner.
//
// Node runs the `.ts` files directly via its built-in type stripping, so there is no compile
// step and no test-framework dependency. `--conditions=react-server` (see package.json) makes
// `server-only` resolve to its no-op build, exactly as it does in a React Server Component.

import { registerHooks } from "node:module";

const EXTENSIONS = [".ts", ".tsx"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[cm]?[jt]sx?$|\.json$/i.test(specifier);

    if (isRelative && !hasExtension) {
      for (const extension of EXTENSIONS) {
        try {
          return nextResolve(specifier + extension, context);
        } catch {
          // Try the next extension, then fall through to the default resolution so the
          // original, more useful error is what surfaces.
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
