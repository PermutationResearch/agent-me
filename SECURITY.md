# Security policy

## Supported versions

Security fixes target the latest release on `main`.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** flow. Do not disclose exploitable details in a public issue. Include affected version, reproduction steps, impact, and a suggested fix if available.

Do not send real credentials or private user data in a report. Maintainers will acknowledge a complete report, investigate it, and coordinate a fix and disclosure.

## Operator responsibilities

This reference implementation cannot make private documents safe to publish. Operators must review
knowledge content, configure rate limiting and TLS, protect provider credentials, and publish an
accurate privacy notice for their deployment. The shipped data flows and limitations are documented
in [docs/TRUST.md](docs/TRUST.md).

## Automated checks

GitHub Actions and Dependabot are turned off in this repository. The CI and CodeQL workflow files
under `.github/workflows/` are kept for anyone who enables Actions, but they do not run here. Before
merging, run the same checks locally: `make lint`, `make test`, `make evaluate`, and `make audit`.
Secret scanning and push protection are enabled on the public repository.

`make audit` runs `npm run audit:deps` against the locked dependency graph, including development
dependencies, and fails on moderate-or-higher known advisories or an unavailable audit service.
Run it after `npm ci`. Audit results depend on the registry's current
advisory data; a clean result is not a guarantee that undisclosed vulnerabilities do not exist.
Dependency updates must preserve lint, typecheck, regression tests and production builds.

These checks complement review, locked dependency audits, threat modeling, and deployment controls.
A green scan does not prove that knowledge content is publishable or that an operator's ingress,
rate limits, credentials, and privacy notice are correctly configured.
