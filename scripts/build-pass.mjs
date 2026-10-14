#!/usr/bin/env node
// Builds the Apple Wallet business card (card.pkpass) and the vCard fallback
// (contact.vcf) from pass/card.json.
//
//   node scripts/build-pass.mjs            # contact.vcf + signed card.pkpass
//   node scripts/build-pass.mjs --vcard    # contact.vcf only (no certificate needed)
//
// Signing material lives in certs/ (git-ignored, never commit it):
//   certs/pass.p12            Pass Type ID certificate + private key exported from Keychain
//   certs/AppleWWDRCAG4.cer   Apple WWDR G4 intermediate (downloaded automatically if missing)
// The .p12 password is read from the PASS_P12_PASSWORD environment variable.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passDir = path.join(root, 'pass');
const certsDir = path.join(root, 'certs');
const WWDR_URL = 'https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer';

const card = JSON.parse(fs.readFileSync(path.join(passDir, 'card.json'), 'utf8'));
const vcardOnly = process.argv.includes('--vcard');

writeVCard();
if (!vcardOnly) buildPass();

function writeVCard() {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const [given, ...rest] = card.name.split(' ');
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(rest.join(' '))};${esc(given)};;;`,
    `FN:${esc(card.name)}`,
    card.organization && `ORG:${esc(card.organization)}`,
    card.title && `TITLE:${esc(card.title)}`,
    card.email && `EMAIL;TYPE=INTERNET:${card.email}`,
    card.phone && `TEL;TYPE=CELL:${card.phone}`,
    card.website && `URL:${card.website}`,
    card.twitter && `X-SOCIALPROFILE;TYPE=twitter:${card.twitter}`,
    card.linkedin && `X-SOCIALPROFILE;TYPE=linkedin:${encodeURI(card.linkedin)}`,
    'END:VCARD',
  ].filter(Boolean);
  fs.writeFileSync(path.join(root, 'contact.vcf'), lines.join('\r\n') + '\r\n');
  console.log('wrote contact.vcf');
}

function passJson() {
  const link = (key, label, url, text = url) => ({
    key, label, value: text, attributedValue: `<a href="${url}">${text}</a>`,
  });
  const backFields = [
    card.email && link('email', 'Email', `mailto:${card.email}`, card.email),
    card.phone && link('phone', 'Phone', `tel:${card.phone.replace(/[^+\d]/g, '')}`, card.phone),
    card.website && link('website', 'Website', card.website),
    card.twitter && link('twitter', 'X (Twitter)', card.twitter),
    card.linkedin && link('linkedin', 'LinkedIn', encodeURI(card.linkedin), 'LinkedIn profile'),
  ].filter(Boolean);

  return {
    formatVersion: 1,
    passTypeIdentifier: card.passTypeIdentifier,
    teamIdentifier: card.teamIdentifier,
    serialNumber: card.serialNumber,
    organizationName: card.name,
    description: `Business card of ${card.name}`,
    logoText: 'Business Card',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(220, 225, 255)',
    backgroundColor: 'rgb(60, 92, 230)',
    sharingProhibited: false,
    generic: {
      primaryFields: [{ key: 'name', value: card.name }],
      secondaryFields: [{ key: 'title', label: 'Title', value: card.title }],
      auxiliaryFields: [
        card.organization && { key: 'organization', label: 'Organization', value: card.organization },
        card.email && { key: 'contact', label: 'Email', value: card.email },
      ].filter(Boolean),
      backFields,
    },
    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: card.website,
      messageEncoding: 'iso-8859-1',
      altText: card.website.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    }],
  };
}

function buildPass() {
  if (/REPLACE_ME/.test(card.passTypeIdentifier + card.teamIdentifier)) {
    fail('Set passTypeIdentifier and teamIdentifier in pass/card.json first.');
  }
  const p12 = path.join(certsDir, 'pass.p12');
  if (!fs.existsSync(p12)) fail(`Missing ${path.relative(root, p12)} (see README in docs/wallet-pass.md).`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pkpass-'));
  try {
    const bundle = path.join(work, 'bundle');
    fs.mkdirSync(bundle);
    fs.writeFileSync(path.join(bundle, 'pass.json'), JSON.stringify(passJson(), null, 2));
    for (const f of fs.readdirSync(path.join(passDir, 'images')).filter((f) => f.endsWith('.png'))) {
      fs.copyFileSync(path.join(passDir, 'images', f), path.join(bundle, f));
    }

    const manifest = {};
    for (const f of fs.readdirSync(bundle).sort()) {
      manifest[f] = createHash('sha1').update(fs.readFileSync(path.join(bundle, f))).digest('hex');
    }
    fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const { cert, key, wwdr } = extractSigningMaterial(p12, work);
    run('openssl', ['smime', '-sign', '-binary',
      '-signer', cert, '-inkey', key, '-certfile', wwdr,
      '-in', path.join(bundle, 'manifest.json'), '-out', path.join(bundle, 'signature'), '-outform', 'DER']);

    const out = path.join(root, 'card.pkpass');
    fs.rmSync(out, { force: true });
    run('zip', ['-q', '-X', '-j', out, ...fs.readdirSync(bundle).map((f) => path.join(bundle, f))]);
    console.log(`wrote card.pkpass (${fs.statSync(out).size} bytes)`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function extractSigningMaterial(p12, work) {
  const pass = `env:PASS_P12_PASSWORD`;
  process.env.PASS_P12_PASSWORD ??= '';
  const cert = path.join(work, 'cert.pem');
  const key = path.join(work, 'key.pem');
  const pkcs12 = (extra) => {
    // Keychain exports often use legacy algorithms that OpenSSL 3+ only reads with -legacy.
    try { run('openssl', ['pkcs12', '-in', p12, '-passin', pass, ...extra]); }
    catch { run('openssl', ['pkcs12', '-legacy', '-in', p12, '-passin', pass, ...extra]); }
  };
  pkcs12(['-clcerts', '-nokeys', '-out', cert]);
  pkcs12(['-nocerts', '-nodes', '-out', key]);

  const wwdrCer = path.join(certsDir, 'AppleWWDRCAG4.cer');
  if (!fs.existsSync(wwdrCer)) run('curl', ['-fsSL', '-o', wwdrCer, WWDR_URL]);
  const wwdr = path.join(work, 'wwdr.pem');
  run('openssl', ['x509', '-inform', 'DER', '-in', wwdrCer, '-out', wwdr]);
  return { cert, key, wwdr };
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
