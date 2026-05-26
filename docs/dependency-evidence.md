# Dependency Evidence

Last verified: 2026-05-26.

This note records the package age evidence required before adopting direct dependencies. Evidence
was collected with `bun pm view <pkg>@<version> time --json`. A package version must be at least
seven days old before adoption.

| Package | Version | Role | Publish timestamp | Age on 2026-05-26 |
| --- | --- | --- | --- | --- |
| `commander` | `14.0.3` | runtime | `2026-01-31T01:47:17.592Z` | 114 days |
| `@biomejs/biome` | `2.4.15` | dev | `2026-05-09T17:08:10.962Z` | 16 days |
| `@types/bun` | `1.3.13` | dev | `2026-04-22T15:55:43.685Z` | 33 days |
| `typescript` | `6.0.3` | dev | `2026-04-16T23:38:27.905Z` | 39 days |

## Resolution Notes

- `commander` remains the only runtime dependency and stays pinned at `14.0.3`.
- `@types/bun` is pinned to `1.3.13` to match the repository package manager version,
  `bun@1.3.13`.
- `@biomejs/biome` and `typescript` use the current stable pins from the shared catalog.
- `package.json` keeps exact versions in `workspaces.catalog`; dependency entries reference those
  pins with `catalog:`.
