import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Audio, Video, ResizeMode } from "expo-av";
import YoutubePlayer from "react-native-youtube-iframe";
import * as ScreenOrientation from "expo-screen-orientation";
import { useKeepAwake } from "expo-keep-awake";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

const GIST_URL =
  "https://gist.githubusercontent.com/arifulatwork/22a771aa1e054bca05dd0b620ac2612e/raw/tv.json";

type ChannelType = "m3u8" | "youtube";
interface Channel {
  image: string;
  text: string;
  videoUrl: string;
  type: ChannelType;
}
type Payload = Record<string, Channel[]>;
interface SectionData {
  title: string;
  data: Channel[];
}

const extractYouTubeId = (url: string): string | null => {
  try {
    const patterns = [
      /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
      /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{6,})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/,
      /youtube\.com\/v\/([a-zA-Z0-9_-]{6,})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1]) return m[1];
    }
    const u = new URL(url);
    return u.searchParams.get("v");
  } catch {
    return null;
  }
};

const { width } = Dimensions.get("window");

/** Card **/
const ChannelCard: React.FC<{
  item: Channel;
  onPress: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}> = ({ item, onPress, isFavorite, onToggleFavorite }) => (
  <Pressable onPress={onPress} style={{ flex: 1 }}>
    <LinearGradient
      colors={["#12172b", "#0b1020"]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.thumbWrap}>
        <Image source={{ uri: item.image }} style={styles.thumb} resizeMode="contain" />
      </View>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>{item.text}</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: item.type === "m3u8" ? "#16a34a" : "#ef4444" }]}>
            <Text style={styles.badgeText}>{item.type === "m3u8" ? "LIVE (HLS)" : "YouTube"}</Text>
          </View>
          <Pressable onPress={onToggleFavorite} hitSlop={8} style={styles.favBtn}>
            <Text style={[styles.favText, isFavorite && styles.favActive]}>
              {isFavorite ? "★" : "☆"}
            </Text>
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  </Pressable>
);

/** Player Modal **/
const PlayerModal: React.FC<{
  visible: boolean;
  channel: Channel | null;
  onClose: () => void;
}> = ({ visible, channel, onClose }) => {
  useKeepAwake();
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      if (visible) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      } else {
        await ScreenOrientation.unlockAsync();
      }
    })();
  }, [visible]);

  useEffect(() => setLoading(true), [channel?.videoUrl]);

  if (!channel) return null;

  const isYouTube = channel.type === "youtube";
  const ytId = isYouTube ? extractYouTubeId(channel.videoUrl) : null;
  const playerHeight = Math.min(Platform.OS === "web" ? 540 : 360, width * 0.7);

  const hint = isYouTube
    ? "Tip: Press Home → PiP to keep YouTube playing"
    : "Tip: Lock screen → audio keeps playing in background";

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={[styles.modalRoot, { paddingTop: insets.top }]}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{channel.text}</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.playerBox}>
          {isYouTube ? (
            ytId ? (
              <YoutubePlayer
                height={playerHeight}
                width={width}
                play
                videoId={ytId}
                onReady={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  Alert.alert(
                    "YouTube Error",
                    "Can't play inline. Open in YouTube?",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Open", onPress: () => Linking.openURL(channel.videoUrl) },
                    ]
                  );
                }}
                webViewProps={{
                  allowsFullscreenVideo: true,
                  allowsInlineMediaPlayback: true,
                  mediaPlaybackRequiresUserAction: false,
                }}
              />
            ) : (
              <View style={styles.center}>
                <Text style={styles.errorText}>Invalid YouTube URL</Text>
                <Pressable onPress={() => Linking.openURL(channel.videoUrl)}>
                  <Text style={styles.linkText}>Open in YouTube</Text>
                </Pressable>
              </View>
            )
          ) : (
            <Video
              style={{ width, height: playerHeight, backgroundColor: "black" }}
              source={{ uri: channel.videoUrl }}
              useNativeControls
              shouldPlay
              isMuted={false}
              resizeMode={ResizeMode.CONTAIN}
              progressUpdateIntervalMillis={500}
              onError={() => {
                setLoading(false);
                Alert.alert(
                  "Playback Error",
                  "This stream can't be played right now.",
                  [
                    { text: "Close", style: "cancel" },
                    { text: "Open in Browser", onPress: () => Linking.openURL(channel.videoUrl) },
                  ]
                );
              }}
              onLoadStart={() => setLoading(true)}
              onReadyForDisplay={() => setLoading(false)}
            />
          )}

          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#60a5fa" />
              <Text style={{ color: "#cbd5e1", marginTop: 8 }}>Loading…</Text>
            </View>
          )}
        </View>

        <Text style={styles.streamHint}>{hint}</Text>
      </View>
    </Modal>
  );
};

/** Main **/
const AppInner = () => {
  const [sections, setSections] = useState<SectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [playerOpen, setPlayerOpen] = useState(false);
  const [current, setCurrent] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);

  // ✅ Background audio — keeps playing when screen locks
  useEffect(() => {
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          interruptionModeIOS: 1,
          interruptionModeAndroid: 2,
        });
      } catch (e) {
        console.warn("Audio mode error:", e);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("@favorites");
        if (raw) setFavorites(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  const saveFavorites = async (next: string[]) => {
    setFavorites(next);
    try { await AsyncStorage.setItem("@favorites", JSON.stringify(next)); } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(GIST_URL, { cache: "no-store" as any });
        const payload: Payload = await res.json();
        const list: SectionData[] = Object.keys(payload).map((title) => ({
          title,
          data: payload[title] || [],
        }));

        const favChannels: Channel[] = [];
        for (const sec of list)
          for (const ch of sec.data)
            if (favorites.includes(ch.text)) favChannels.push(ch);

        const finalSections = favChannels.length
          ? [{ title: "⭐ Favorites", data: favChannels }, ...list]
          : list;

        setSections(finalSections);
      } catch {
        Alert.alert("Load Error", "Couldn't load channel list. Check your network.");
      } finally {
        setLoading(false);
      }
    })();
  }, [favorites]);

  const filtered = useMemo(() => {
    if (!query.trim()) return sections;
    const q = query.toLowerCase();
    return sections
      .map((s) => ({
        ...s,
        data: s.data.filter(
          (c) => c.text.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.data.length > 0);
  }, [sections, query]);

  const handleOpen = (ch: Channel) => { setCurrent(ch); setPlayerOpen(true); };
  const toggleFavorite = (name: string) => {
    saveFavorites(
      favorites.includes(name) ? favorites.filter((n) => n !== name) : [...favorites, name]
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={["#0f1534", "#0b1020"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <Text style={styles.appTitle}>Nazat Stream</Text>
        <Text style={styles.appSubtitle}>Live. Global. Yours</Text>
        <View style={styles.searchWrap}>
          <TextInput
            placeholder="Search channels…"
            placeholderTextColor="#9aa4b2"
            value={query}
            onChangeText={setQuery}
            style={styles.search}
          />
        </View>
      </LinearGradient>

      {loading ? (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator size="large" color="#60a5fa" />
          <Text style={{ color: "#94a3b8", marginTop: 8 }}>Loading channels…</Text>
        </View>
      ) : (
        <SectionList
          sections={filtered}
          keyExtractor={(item) => `${item.text}-${item.videoUrl}`}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{title}</Text>
            </View>
          )}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={{ marginBottom: 12 }}>
              <ChannelCard
                item={item}
                onPress={() => handleOpen(item)}
                isFavorite={favorites.includes(item.text)}
                onToggleFavorite={() => toggleFavorite(item.text)}
              />
            </View>
          )}
          renderSectionFooter={() => <View style={{ height: 12 }} />}
        />
      )}

      <PlayerModal
        visible={playerOpen}
        channel={current}
        onClose={() => setPlayerOpen(false)}
      />
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

/** Styles **/
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1020" },

  header: {
    paddingTop: Platform.OS === "android" ? 52 : 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e293b",
  },
  appTitle: { fontSize: 22, fontWeight: "700", color: "white" },
  appSubtitle: { fontSize: 13, color: "#9aa4b2", marginTop: 2 },

  searchWrap: {
    marginTop: 12,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  search: { color: "white", fontSize: 15 },

  sectionHeader: { marginTop: 16, marginBottom: 8, paddingHorizontal: 4 },
  sectionTitle: { color: "#cbd5e1", fontSize: 16, fontWeight: "700" },

  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1f2a44",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  thumbWrap: {
    width: 66, height: 66, borderRadius: 12,
    backgroundColor: "#0f172a",
    alignItems: "center", justifyContent: "center",
    overflow: "hidden", marginRight: 12,
  },
  thumb: { width: 64, height: 64 },
  meta: { flex: 1 },
  title: { color: "white", fontSize: 16, fontWeight: "600" },
  badgeRow: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: "white", fontSize: 12, fontWeight: "700" },
  favBtn: { marginLeft: "auto", padding: 4 },
  favText: { color: "#94a3b8", fontSize: 18 },
  favActive: { color: "#fbbf24" },

  modalRoot: { flex: 1, backgroundColor: "#0b1020" },
  modalHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2937",
  },
  modalTitle: { color: "white", fontSize: 16, fontWeight: "700", flex: 1 },
  closeBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: "#24324a", backgroundColor: "#0f172a",
  },
  closeText: { color: "#cbd5e1", fontWeight: "700" },

  playerBox: { alignItems: "center", justifyContent: "center", marginTop: 10 },
  loadingOverlay: {
    position: "absolute", alignItems: "center", justifyContent: "center",
    inset: 0 as any, backgroundColor: "rgba(0,0,0,0.25)",
  },
  streamHint: { textAlign: "center", color: "#9aa4b2", marginTop: 12, fontSize: 12 },

  center: { alignItems: "center", justifyContent: "center" },
  errorText: { color: "#ef4444", marginBottom: 8 },
  linkText: { color: "#60a5fa", textDecorationLine: "underline" },
});