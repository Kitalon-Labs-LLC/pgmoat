# Name Claims and Launch Checklist

## 1. NPM Placeholder Package

To protect against name-squatting, publish an initial placeholder package `pgmoat@0.0.0`:

```bash
cd tmp/npm-placeholder
npm login
npm publish --access public
```

- [ ] `pgmoat@0.0.0` published to npm (Date: ____________)

## 2. GitHub Repository Settings

Repository: `https://github.com/Kitalon-Labs-LLC/pgmoat`

- [x] Repository initialized and main/dev branches created
- [ ] Branch protection rules configured on `main`:
  - Require a pull request before merging
  - Require status checks to pass before merging (`CI`, `License Check`)
  - Do not allow bypassing the above settings
- [ ] Security analysis features enabled:
  - Secret scanning and push protection enabled
  - Dependabot alerts and security updates enabled
  - CodeQL analysis enabled

## 3. Domain Registration (OD-01)

- [ ] Confirm or register `pgmoat.dev` (or configured fallback domain)

## 4. Trademark Knockout Search (OD-02)

- [ ] Commission trademark knockout search for "pgmoat" prior to filing.
