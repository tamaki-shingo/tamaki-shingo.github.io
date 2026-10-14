# Apple Wallet business card

The NFC card points at `https://tamaki-shingo.github.io/`. On iPhone, iPad and Mac the page shows an
**Add to Apple Wallet** badge that links to `card.pkpass`. Tapping it opens Safari's pass preview,
and the visitor chooses **Add** or **Cancel**. Nothing is added without their consent. Other
platforms get `contact.vcf` instead.

| Path | What it is |
| --- | --- |
| `pass/card.json` | Card content and pass identifiers. Edit this file. |
| `pass/images/` | Pass artwork (icon, logo, thumbnail at @1x/@2x/@3x). Regenerate with `scripts/make-pass-images.sh` or replace it with your own. |
| `scripts/build-pass.mjs` | Generates `contact.vcf`, and signs and zips `card.pkpass`. |
| `certs/` | Signing material. **Git-ignored, never commit it** (this repo is public). |

## One-time setup

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list/passTypeId),
   register a **Pass Type ID**, for example `pass.io.github.tamaki-shingo.business-card`.
2. Create a certificate for that Pass Type ID with a CSR from Keychain Access, then download and
   double-click it.
3. In Keychain Access, export the certificate *together with its private key* as
   `certs/pass.p12`, and set a password.
4. Fill in `passTypeIdentifier` and `teamIdentifier` (your 10-character Team ID) in `pass/card.json`,
   and optionally `email` and `phone`. Everything in that file becomes public.
5. Download the official badge artwork from the
   [Add to Apple Wallet guidelines](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/)
   and save the black US-UK SVG as `assets/add-to-apple-wallet.svg`. Until it exists, the page shows a
   plain text button. The guidelines don't allow redrawn badges.

## Build

```sh
PASS_P12_PASSWORD='…' node scripts/build-pass.mjs
open card.pkpass   # macOS shows the Wallet preview, or an error if signing failed
```

Commit `card.pkpass` and `contact.vcf`. Apple's WWDR G4 intermediate is downloaded to `certs/` on
the first run.

## After deploying

```sh
curl -sI https://tamaki-shingo.github.io/card.pkpass | grep -i content-type
# expect: application/vnd.apple.pkpass
```

Safari only offers to add the pass when it's served with this content type.

## Notes

- The pass is static. There's no `webServiceURL`, so installed passes don't auto-update. Wallet
  identifies a pass by `passTypeIdentifier` + `serialNumber`, so keep `serialNumber` unchanged when
  you edit the content. A visitor who adds the rebuilt pass then replaces their old copy instead of
  getting a second card. Change the serial only for a deliberately separate card.
- The Pass Type ID certificate expires after about a year. Passes that are already installed keep
  working, but new builds need a renewed certificate.
