// Lets you point the app at a test website without editing app.json:
//   PV_SITE_URL=https://<your-codespace>-5173.app.github.dev npx expo start --tunnel
export default ({ config }) => ({
  ...config,
  extra: { ...config.extra, siteUrl: process.env.PV_SITE_URL || config.extra.siteUrl },
});
