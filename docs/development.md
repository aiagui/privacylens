# Development and testing

Use Node.js 24 and the committed npm lockfile. `npm ci` installs the exact dependency
tree. `npm run dev` binds the development server to `127.0.0.1`; do not expose it
through a tunnel or a public interface.

Tests use synthetic HTML and loopback servers. Browser integration tests assert
that redirect destinations receive zero hits and cookie values/query strings do
not enter reports. Route tests prove production denial, fixed fixture selection
and rejection of prototype-property fixture IDs.

`npm run test:e2e` starts the built application on an ephemeral loopback port,
opens it with Chromium and checks the sample report, disabled endpoints, security
headers and absence of external browser requests. Run `npm run build` first.

No runtime secrets or local environment files are needed. Agent instruction file
generation is disabled in Next.js; any personal tooling configuration stays local
and untracked. For a new public file, update `.public-files`, stage it, inspect the
diff, then run the publication guard and secret scanner. CI inspects staged content
from a fresh checkout.
