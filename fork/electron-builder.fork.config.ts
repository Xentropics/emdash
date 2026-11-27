import type { Configuration } from 'electron-builder';
import base from './electron-builder.config.ts';

// The Xentropics build: upstream's packaging, published to the fork's releases.
// Without Apple signing secrets the Mac app is signed ad hoc; Windows is unsigned.
const hasAppleCertificate = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);

const config: Configuration = {
  ...base,
  publish: [{ provider: 'github', owner: 'Xentropics', repo: 'emdash', releaseType: 'release' }],
  mac: {
    ...base.mac,
    // An ad hoc signature cannot carry the hardened runtime without extra entitlements
    // (the app would fail library validation), so it is on only with a real certificate.
    ...(!hasAppleCertificate && { identity: '-', hardenedRuntime: false }),
  },
  linux: {
    ...base.linux,
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
  },
  win: {
    ...base.win,
    target: [{ target: 'nsis', arch: ['x64'] }],
    azureSignOptions: undefined,
  },
};

export default config;
