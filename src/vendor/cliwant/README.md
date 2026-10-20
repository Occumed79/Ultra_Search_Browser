# Procurement data adapters (third-party, MIT)

This directory contains upstream connector source files from **@cliwant/mcp-sam-gov** (version 1.17.0), copyright 2026 Cliwant and contributors.

Original project: https://github.com/cliwant/mcp-sam-gov
Source: https://github.com/cliwant/mcp-sam-gov/tree/main/src
License: [MIT](./LICENSE)

Vendored modules: `opengov.ts`, `bonfire.ts`, `sam-gov/client.ts`, `sam-gov/types.ts`, and their original `datasource.ts`, `errors.ts`, `meta.ts`, `coerce.ts` dependencies.

Upstream request, parsing, and error-handling logic is retained; local relative `.js` import suffixes were adjusted to extensionless imports for the existing Next.js/Turbopack build. Ultra Search's locally authored `authoritative-procurement.ts` is only an application adapter that calls the existing connectors and applies conservative ID/status matching. The third-party source is not itself an official government endorsement or a guarantee of availability.

Upstream changes are not automatically applied; review licensing, API changes and tests before updating this vendor snapshot.