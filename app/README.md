# Pure Vegi phone app (Android + iPhone)

The app opens the Pure Vegi website inside a native shell and adds push notifications
(order accepted, cooking, ready, on its way, review prompt), opens the right order when a
notification is tapped, handles the Android back button, and sends phone / maps / review
links to the phone's own apps. Card payments stay inside the app (Stripe).

Drivers and kitchen staff don't need a store app: they open the staff web app on their phone
and use the browser's **Add to Home screen** (it installs like an app).

## Try it on your phone (no store needed)

1. Install **Expo Go** from the Play Store or App Store.
2. In the Codespace: open the **Ports** tab, right-click port **5173** → *Port visibility* → **Public**
   (the phone can't log in to GitHub), and copy its address.
3. In the Codespace terminal:
   ```bash
   cd app
   npm install
   npm run setup          # installs the versions that match this Expo SDK
   PV_SITE_URL=https://<your-codespace>-5173.app.github.dev npm run tunnel
   ```
4. Scan the QR code with the camera (iPhone) or Expo Go (Android).

Push notifications don't work inside Expo Go on Android; test them with a preview build (below).

## Build for the stores (EAS)

One-time:
```bash
npm install -g eas-cli
eas login                 # free Expo account
eas init                  # fills extra.eas.projectId in app.json
```
Set the live website address in `app.json` → `extra.siteUrl` once the domain is live.

- **Android test APK**: `eas build -p android --profile preview` → install the APK on any Android phone.
- **Play Store**: `eas build -p android --profile production`, then `eas submit -p android`
  (needs the Google Play developer account, registered as an organisation).
- **App Store**: `eas build -p ios --profile production`, then `eas submit -p ios`
  (needs the Apple Developer Program; EAS creates the certificates).

## Before submitting

- **Icon**: the current icon is upscaled from a small logo and looks soft. Replace `assets/icon.png`
  (1024×1024), `assets/adaptive-icon.png` and `assets/splash-icon.png` with a high-resolution logo.
- **Apple review**: Apple rejects apps that are "just a website" (guideline 4.2). Push notifications
  and order tracking help; if it's rejected, the next step is native screens for tracking/basket.
- Store listings need screenshots, a privacy policy URL and the data-safety / privacy forms.
