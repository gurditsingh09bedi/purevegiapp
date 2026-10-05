// Pure Vegi phone app (Android + iPhone).
// It shows the Pure Vegi website (menu, checkout, tracking, table QR, booking) inside the app
// and adds what only a native app can do: push notifications for every order update,
// opening the right order when a notification is tapped, the Android back button, and
// sending phone/maps/review links to the phone's own apps.
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};
const SITE_URL = (extra.siteUrl || "https://purevegi.co.uk").replace(/\/$/, "");

const hostOf = (url) => (url.match(/^https?:\/\/([^/?#:]+)/i) || [])[1]?.toLowerCase() || "";
const SITE_HOST = hostOf(SITE_URL);
// Pages that must open inside the app: our site, and Stripe (card checks / 3-D Secure).
const INSIDE = (host) => host === SITE_HOST || host.endsWith(".stripe.com") || host === "stripe.com";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // older SDKs
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function getPushToken() {
  if (!Device.isDevice) return null; // simulators can't receive pushes
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Order updates",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#F2A65A",
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return null;
  const projectId = extra.eas?.projectId || Constants.easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return data;
}

const nativeScript = (token) =>
  `window.PV_NATIVE = ${JSON.stringify({ pushToken: token, platform: Platform.OS, app: "purevegi" })};
   window.dispatchEvent(new Event("pv:native")); true;`;

export default function App() {
  const web = useRef(null);
  const canGoBack = useRef(false);
  const [token, setToken] = useState(null);
  const [failed, setFailed] = useState(false);
  const [startUrl, setStartUrl] = useState(SITE_URL);

  // Push token: ask once, then hand it to the website (it attaches it to orders and accounts).
  useEffect(() => {
    getPushToken().then(setToken).catch(() => setToken(null));
  }, []);
  useEffect(() => {
    if (token) web.current?.injectJavaScript(nativeScript(token));
  }, [token]);

  // Tapping a notification opens that order (or the Google review page).
  const openFromNotification = useCallback((response) => {
    const data = response?.notification?.request?.content?.data || {};
    if (data.kind === "review_prompt" && data.link) return Linking.openURL(data.link);
    if (data.order_id) {
      const path = `/order/${Number(data.order_id)}`;
      if (web.current) web.current.injectJavaScript(`window.location.assign(${JSON.stringify(path)}); true;`);
      else setStartUrl(SITE_URL + path);
    }
    return undefined;
  }, []);
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((r) => r && openFromNotification(r));
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, [openFromNotification]);

  // Android back button goes back inside the site before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  // The website asks for a little haptic tap (add to basket, tab bar) or a success buzz (order placed).
  const onMessage = useCallback((e) => {
    let msg = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.type !== "haptic") return;
    if (msg.kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.impactAsync(msg.kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const onShouldStart = useCallback((req) => {
    const { url } = req;
    if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
    if (/^https?:/i.test(url) && INSIDE(hostOf(url))) return true;
    // tel:, maps, Google reviews, anything else: the phone's own apps
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  if (failed) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.offline}>
          <StatusBar style="light" />
          <Image source={require("./assets/icon.png")} style={styles.logo} />
          <Text style={styles.title}>Can't reach Pure Vegi</Text>
          <Text style={styles.text}>Check your internet connection and try again.</Text>
          <Pressable style={styles.button} onPress={() => setFailed(false)}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      {/* bottom edge is left to the website: its tab bar adds the home-indicator space itself */}
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <StatusBar style="light" backgroundColor="#023E32" />
        <WebView
          ref={web}
          source={{ uri: startUrl }}
          style={styles.web}
          applicationNameForUserAgent="PureVegiApp/1.0"
          injectedJavaScriptBeforeContentLoaded={token ? nativeScript(token) : "true;"}
          onLoadEnd={() => token && web.current?.injectJavaScript(nativeScript(token))}
          onNavigationStateChange={(s) => { canGoBack.current = s.canGoBack; }}
          onShouldStartLoadWithRequest={onShouldStart}
          onMessage={onMessage}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500 && hostOf(e.nativeEvent.url) === SITE_HOST) setFailed(true); }}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          sharedCookiesEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          decelerationRate="normal"
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#023E32" },
  web: { flex: 1, backgroundColor: "#F6F1E4" },
  offline: { flex: 1, backgroundColor: "#023E32", alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { width: 112, height: 112, borderRadius: 24, marginBottom: 20 },
  title: { color: "#F6F1E4", fontSize: 22, fontWeight: "800", marginBottom: 8 },
  text: { color: "#CFE2D7", fontSize: 16, textAlign: "center", marginBottom: 24 },
  button: { backgroundColor: "#F2A65A", paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999 },
  buttonText: { color: "#2B1503", fontSize: 17, fontWeight: "800" },
});
