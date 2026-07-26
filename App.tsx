import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Linking,
  Platform,
  Pressable,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  useWindowDimensions,
  AppState,
  BackHandler,
  Easing,
  PanResponder,
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

type ChannelType = "m3u8" | "youtube" | "radio";
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

// ── Palette ──────────────────────────────────────────────
const C = {
  bg:       "#08090f",
  surface:  "#0e1018",
  card:     "#111520",
  border:   "#1c2238",
  accent:   "#4f8ef7",
  accentSoft:"#1a2a4a",
  live:     "#22c55e",
  liveSoft: "#0d2318",
  yt:       "#ff3b30",
  ytSoft:   "#2a0d0b",
  radio:    "#a855f7",
  radioSoft:"#241a3a",
  star:     "#f59e0b",
  textPri:  "#f0f4ff",
  textSec:  "#6b7a9a",
  textMute: "#3a4260",
};

/** Animated Card **/
const ChannelCard: React.FC<{
  item: Channel;
  onPress: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  index: number;
}> = ({ item, onPress, isFavorite, onToggleFavorite, index }) => {
  const scale = React.useRef(new Animated.Value(1)).current;
  const accent =
    item.type === "m3u8" ? C.live : item.type === "radio" ? C.radio : C.yt;
  const accentSoft =
    item.type === "m3u8" ? C.liveSoft : item.type === "radio" ? C.radioSoft : C.ytSoft;
  const label =
    item.type === "m3u8" ? "LIVE" : item.type === "radio" ? "RADIO" : "YouTube";
  const showDot = item.type !== "youtube"; // live + radio pulse, YouTube doesn't

  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.card}
      >
        {/* Left accent strip */}
        <View style={[styles.cardStrip, { backgroundColor: accent }]} />

        {/* Logo */}
        <View style={[styles.logoBox, { backgroundColor: accentSoft }]}>
          <Image source={{ uri: item.image }} style={styles.logo} resizeMode="contain" />
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.text}</Text>

          <View style={styles.cardMeta}>
            {/* Live/Radio dot / YT label */}
            <View style={[styles.pill, { backgroundColor: accentSoft }]}>
              {showDot && <View style={[styles.liveDot, { backgroundColor: accent }]} />}
              <Text style={[styles.pillText, { color: accent }]}>
                {label}
              </Text>
            </View>
          </View>
        </View>

        {/* Favorite */}
        <Pressable onPress={onToggleFavorite} hitSlop={12} style={styles.starBtn}>
          <Text style={[styles.starIcon, isFavorite && styles.starActive]}>
            {isFavorite ? "★" : "☆"}
          </Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
};

/** Player Overlay — mini docked player that expands to full screen **/
const MINI_MARGIN = 12;

const PlayerOverlay: React.FC<{
  channel: Channel | null;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}> = ({ channel, expanded, onExpand, onCollapse, onClose }) => {
  useKeepAwake();
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  // Live screen size — updates automatically when we lock to landscape,
  // unlike a one-time Dimensions.get() snapshot which goes stale after rotation.
  const { width, height } = useWindowDimensions();

  // Drives the smooth morph between the small docked bar and the full-screen
  // player. The <Video>/<YoutubePlayer> underneath never remounts during this
  // transition — only this container's geometry animates — so playback
  // continues without a reload or buffering blip.
  const expandAnim = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(expandAnim, {
      toValue: expanded ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded]);

  // Free-drag offset for the mini player — lets the user pick it up and
  // move it anywhere on screen (e.g. into the middle). It's ignored once
  // fully expanded (see dragFade below), and reset whenever a new channel
  // is opened so it starts back at its default docked spot.
  const pan = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragStartRef = React.useRef({ x: 0, y: 0, t: 0 });
  const boundsRef = React.useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const expandedRef = React.useRef(expanded);
  expandedRef.current = expanded;
  const onExpandRef = React.useRef(onExpand);
  onExpandRef.current = onExpand;

  const panResponder = React.useRef(
    PanResponder.create({
      // Only the mini player is draggable — full screen ignores gestures here
      // so the native video controls and header buttons work normally.
      onStartShouldSetPanResponder: () => !expandedRef.current,
      onMoveShouldSetPanResponder: (_, g) =>
        !expandedRef.current && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
      onPanResponderGrant: () => {
        dragStartRef.current = {
          x: (pan.x as any)._value,
          y: (pan.y as any)._value,
          t: Date.now(),
        };
      },
      onPanResponderMove: (_, g) => {
        const b = boundsRef.current;
        const nx = Math.min(b.maxX, Math.max(b.minX, dragStartRef.current.x + g.dx));
        const ny = Math.min(b.maxY, Math.max(b.minY, dragStartRef.current.y + g.dy));
        pan.setValue({ x: nx, y: ny });
      },
      onPanResponderRelease: (_, g) => {
        // A tap (barely any movement, released quickly) expands to full
        // screen — anything more deliberate is treated as a drag.
        const moved = Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
        const quick = Date.now() - dragStartRef.current.t < 400;
        if (!moved && quick) onExpandRef.current();
      },
    })
  ).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (expanded) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else if (!cancelled) {
          await ScreenOrientation.unlockAsync();
        }
      } catch (e) {
        // Some devices/tablets can reject a lock request — fail silently
        // rather than leaving the player in a broken state.
        console.warn("Orientation lock error:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  // Always restore portrait + unlock if the component ever unmounts while
  // still locked to landscape (e.g. app crash recovery, fast navigation away).
  useEffect(() => {
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  const isYouTube = channel?.type === "youtube";
  const ytId = isYouTube && channel ? extractYouTubeId(channel.videoUrl) : null;

  const videoRef = React.useRef<Video>(null);
  const userPausedRef = React.useRef(false);
  const retryCountRef = React.useRef(0);
  const hasStartedRef = React.useRef(false);
  const [buffering, setBuffering] = useState(false);

  // Radio (audio-only http streams) plays through expo-av's Audio.Sound
  // rather than <Video>, since there's no picture to render. It shares the
  // same background-audio session as the m3u8 channels (see
  // Audio.setAudioModeAsync in AppInner), so it keeps playing on lock
  // screen / while backgrounded in exactly the same way.
  const isRadio = channel?.type === "radio";
  const radioSoundRef = React.useRef<Audio.Sound | null>(null);
  const [radioPlaying, setRadioPlaying] = useState(true);

  const toggleRadioPlay = async () => {
    const sound = radioSoundRef.current;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        userPausedRef.current = true;
        setRadioPlaying(false);
        await sound.pauseAsync();
      } else {
        userPausedRef.current = false;
        setRadioPlaying(true);
        await sound.playAsync();
      }
    } catch {}
  };

  // Load/unload the radio stream whenever the channel changes (including
  // switching away from radio or closing the player entirely).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (radioSoundRef.current) {
        try {
          await radioSoundRef.current.unloadAsync();
        } catch {}
        radioSoundRef.current = null;
      }

      if (cancelled || !channel || channel.type !== "radio") return;

      setLoading(true);
      setBuffering(false);
      hasStartedRef.current = false;
      retryCountRef.current = 0;
      userPausedRef.current = false;
      setRadioPlaying(true);

      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: channel.videoUrl },
          { shouldPlay: true, progressUpdateIntervalMillis: 500 },
          (status: any) => {
            if (cancelled || !status.isLoaded) return;
            userPausedRef.current = !status.shouldPlay;

            if (status.isPlaying) {
              hasStartedRef.current = true;
              retryCountRef.current = 0;
            }

            if (status.isBuffering) {
              hasStartedRef.current ? setBuffering(true) : setLoading(true);
              return;
            }
            setBuffering(false);
            setLoading(false);

            if (
              status.shouldPlay &&
              !status.isPlaying &&
              !status.didJustFinish &&
              retryCountRef.current < 5
            ) {
              retryCountRef.current += 1;
              radioSoundRef.current?.playAsync().catch(() => {});
            }
          }
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        radioSoundRef.current = sound;
      } catch (e) {
        console.warn("Radio load error:", e);
        setLoading(false);
        Alert.alert("Playback Error", "Radio stream unavailable right now.", [
          { text: "Close", style: "cancel" },
          { text: "Open in Browser", onPress: () => Linking.openURL(channel.videoUrl) },
        ]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel?.videoUrl, channel?.type]);

  // Belt-and-braces: release the sound if this whole overlay ever unmounts.
  useEffect(() => {
    return () => {
      radioSoundRef.current?.unloadAsync().catch(() => {});
      radioSoundRef.current = null;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setBuffering(false);
    retryCountRef.current = 0;
    userPausedRef.current = false;
    hasStartedRef.current = false;
    pan.setValue({ x: 0, y: 0 });
  }, [channel?.videoUrl]);

  // Background audio for live (m3u8) channels is the whole point of this
  // app (see Audio.setAudioModeAsync + UIBackgroundModes: audio in
  // app.json) — so we must NOT pause playback just because the app
  // backgrounds. We only step in when returning to the foreground, to
  // recover from a real interruption (e.g. a phone call stole audio focus)
  // if the stream actually stopped and the user didn't pause it themselves.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || userPausedRef.current) return;
      if (isRadio) {
        radioSoundRef.current?.playAsync().catch(() => {});
      } else if (videoRef.current && !isYouTube) {
        videoRef.current.playAsync().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [isYouTube, isRadio]);

  // Once the stream has rendered its first frame, brief re-buffering blips
  // (completely normal for live HLS — segments download in small bursts)
  // should NOT bring back the full "Connecting…" overlay hiding the video
  // underneath. That overlay is only for the initial connect; afterwards we
  // show a small unobtrusive spinner instead.
  const onPlaybackStatusUpdate = (status: any) => {
    if (!status.isLoaded) return;
    userPausedRef.current = !status.shouldPlay;

    if (status.isPlaying) {
      hasStartedRef.current = true;
      retryCountRef.current = 0;
    }

    if (status.isBuffering) {
      if (hasStartedRef.current) {
        setBuffering(true);
      } else {
        setLoading(true);
      }
      return;
    }
    setBuffering(false);
    setLoading(false);

    if (
      status.shouldPlay &&
      !status.isPlaying &&
      !status.didJustFinish &&
      retryCountRef.current < 5
    ) {
      retryCountRef.current += 1;
      videoRef.current?.playAsync().catch(() => {});
    }
  };

  // Android hardware back button: while full-screen, collapse to the mini
  // player first (matches the ⌄ button); if already mini, close it entirely.
  useEffect(() => {
    if (!channel) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (expanded) onCollapse();
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [channel, expanded, onCollapse, onClose]);

  if (!channel) return null;

  const miniWidth = width - MINI_MARGIN * 2;
  // Proper 16:9-ish sizing so the video is actually watchable while mini —
  // a thin fixed-height bar squashed the picture down to almost nothing.
  const MINI_HEIGHT = Math.min(240, Math.max(150, Math.round(miniWidth * 9 / 16)));
  const miniTop = height - MINI_HEIGHT - insets.bottom - MINI_MARGIN;

  // Keep the dragged position fully on-screen with a small edge margin,
  // expressed relative to the default docked spot (since pan.x/pan.y are offsets).
  const EDGE = 6;
  boundsRef.current = {
    minX: EDGE - MINI_MARGIN,
    maxX: width - miniWidth - EDGE - MINI_MARGIN,
    minY: insets.top + EDGE - miniTop,
    maxY: height - MINI_HEIGHT - insets.bottom - EDGE - miniTop,
  };

  // Drag offset fades out as the player expands, so it always lands cleanly
  // full-screen regardless of where the mini player was dragged to.
  const dragFade = Animated.subtract(1, expandAnim);

  const containerStyle = {
    position: "absolute" as const,
    left: Animated.add(
      expandAnim.interpolate({ inputRange: [0, 1], outputRange: [MINI_MARGIN, 0] }),
      Animated.multiply(pan.x, dragFade)
    ),
    top: Animated.add(
      expandAnim.interpolate({ inputRange: [0, 1], outputRange: [miniTop, 0] }),
      Animated.multiply(pan.y, dragFade)
    ),
    width: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [miniWidth, width] }),
    height: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [MINI_HEIGHT, height] }),
    borderRadius: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
    borderWidth: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    borderColor: C.border,
    shadowOpacity: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
  };

  const showYouTubeError = isYouTube && expanded && !ytId;

  const badgeColor = isYouTube ? C.yt : isRadio ? C.radio : C.live;
  const badgeSoft = isYouTube ? C.ytSoft : isRadio ? C.radioSoft : C.liveSoft;
  const badgeLabel = isYouTube ? "YouTube" : isRadio ? "RADIO" : "LIVE";
  const showBadgeDot = !isYouTube; // live + radio pulse, YouTube doesn't

  return (
    <Animated.View
      style={[
        styles.overlayBase,
        containerStyle,
        { zIndex: 1000, elevation: 1000 },
      ]}
    >
      <View
        {...panResponder.panHandlers}
        style={StyleSheet.absoluteFillObject}
      >
        {isYouTube ? (
          expanded ? (
            ytId ? (
              <View style={StyleSheet.absoluteFillObject}>
                <YoutubePlayer
                  height={height}
                  width={width}
                  play
                  videoId={ytId}
                  onReady={() => setLoading(false)}
                  onError={() => {
                    setLoading(false);
                    Alert.alert("YouTube Error", "Can't play inline. Open in YouTube?", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Open", onPress: () => Linking.openURL(channel.videoUrl) },
                    ]);
                  }}
                  webViewProps={{
                    allowsFullscreenVideo: true,
                    allowsInlineMediaPlayback: true,
                    mediaPlaybackRequiresUserAction: false,
                  }}
                />
              </View>
            ) : null
          ) : (
            <View style={[StyleSheet.absoluteFillObject, styles.ytPlaceholder]}>
              <Image source={{ uri: channel.image }} style={styles.ytPlaceholderLogo} resizeMode="contain" />
            </View>
          )
        ) : isRadio ? (
          // Radio has no picture, just audio — show the station art on a
          // gradient backdrop, with a big tap target when full-screen.
          // Playback itself is driven by the Audio.Sound effect above.
          <View style={[StyleSheet.absoluteFillObject, styles.radioStage]}>
            <LinearGradient colors={[C.radioSoft, C.bg]} style={StyleSheet.absoluteFillObject} />
            <Image source={{ uri: channel.image }} style={styles.radioArt} resizeMode="contain" />
            {expanded && (
              <Pressable onPress={toggleRadioPlay} style={styles.radioPlayBtn} hitSlop={16}>
                <Text style={styles.radioPlayIcon}>{radioPlaying ? "❚❚" : "►"}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Video
            ref={videoRef}
            style={StyleSheet.absoluteFillObject}
            source={{ uri: channel.videoUrl }}
            useNativeControls={expanded}
            shouldPlay
            isMuted={false}
            resizeMode={ResizeMode.CONTAIN}
            progressUpdateIntervalMillis={500}
            onLoadStart={() => setLoading(true)}
            onReadyForDisplay={() => {
              setLoading(false);
              hasStartedRef.current = true;
            }}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
            onError={() => {
              setLoading(false);
              Alert.alert("Playback Error", "Stream unavailable right now.", [
                { text: "Close", style: "cancel" },
                { text: "Open in Browser", onPress: () => Linking.openURL(channel.videoUrl) },
              ]);
            }}
          />
        )}

        {showYouTubeError && (
          <View style={[StyleSheet.absoluteFillObject, styles.errorOverlay]}>
            <Text style={styles.errorEmoji}>⚠️</Text>
            <Text style={styles.errorText}>Invalid YouTube URL</Text>
            <Pressable onPress={() => Linking.openURL(channel.videoUrl)} style={styles.openBtn}>
              <Text style={styles.openBtnText}>Open in YouTube</Text>
            </Pressable>
          </View>
        )}

        {loading && !isYouTube && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size={expanded ? "large" : "small"} color={C.accent} />
            {expanded && <Text style={styles.loadingText}>Connecting…</Text>}
          </View>
        )}

        {!loading && buffering && !isYouTube && expanded && (
          <View style={styles.bufferBadge} pointerEvents="none">
            <ActivityIndicator size="small" color={C.accent} />
          </View>
        )}

        {/* Mini bar chrome — fades out early in the expand animation */}
        <Animated.View
          pointerEvents={expanded ? "none" : "box-none"}
          style={[
            styles.miniChrome,
            { opacity: expandAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: "clamp" }) },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={10} style={styles.miniCloseBtn}>
            <Text style={styles.miniBtnIcon}>✕</Text>
          </Pressable>

          <View style={styles.miniInfoBar}>
            <LinearGradient colors={["transparent", "rgba(2,3,8,0.92)"]} style={StyleSheet.absoluteFillObject} />
            <View style={[styles.pill, { backgroundColor: badgeSoft }]}>
              {showBadgeDot && <View style={[styles.liveDot, { backgroundColor: badgeColor }]} />}
              <Text style={[styles.pillText, { color: badgeColor }]}>{badgeLabel}</Text>
            </View>
            <Text style={styles.miniTitle} numberOfLines={1}>{channel.text}</Text>
            {isRadio && (
              <Pressable onPress={toggleRadioPlay} hitSlop={10} style={styles.miniRadioBtn}>
                <Text style={styles.miniBtnIcon}>{radioPlaying ? "❚❚" : "►"}</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* Full-screen chrome — a soft gradient fade at the top only, so it
            blends into the video instead of reading as a solid bar. The
            bottom is left clear for the native player's own controls. */}
        {expanded && (
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.fullChrome,
              { opacity: expandAnim.interpolate({ inputRange: [0.6, 1], outputRange: [0, 1], extrapolate: "clamp" }) },
            ]}
          >
            <LinearGradient
              colors={["rgba(2,3,8,0.85)", "transparent"]}
              style={styles.fullHeaderGradient}
              pointerEvents="none"
            />
            <View style={[styles.fullHeaderBar, { paddingTop: insets.top + 10 }]}>
              <View style={styles.modalTitleRow}>
                <View style={[styles.modalBadge, { backgroundColor: badgeSoft }]}>
                  {showBadgeDot && <View style={[styles.liveDotLg, { backgroundColor: badgeColor }]} />}
                  <Text style={[styles.modalBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                </View>
                <Text style={styles.modalTitle} numberOfLines={1}>{channel.text}</Text>
              </View>
              <Pressable onPress={onCollapse} style={styles.fullIconBtn} hitSlop={8}>
                <Text style={styles.fullIconBtnText}>⌄</Text>
              </Pressable>
              <Pressable onPress={onClose} style={styles.fullIconBtn} hitSlop={8}>
                <Text style={styles.fullIconBtnText}>✕</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
};


/** Section Header **/
const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionLine} />
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>
);

/** Main **/
const AppInner = () => {
  const [sections, setSections] = useState<SectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<Channel | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const insets = useSafeAreaInsets();

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
          ? [{ title: "⭐  Favorites", data: favChannels }, ...list]
          : list;
        setSections(finalSections);
      } catch {
        Alert.alert("Load Error", "Couldn't load channels. Check your network.");
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

  // Tapping a channel opens the small docked mini player first; the user
  // taps it to expand to full screen (see PlayerOverlay).
  const handleOpen = (ch: Channel) => { setCurrent(ch); setExpanded(false); };
  const closePlayer = () => { setExpanded(false); setCurrent(null); };
  const toggleFavorite = (name: string) =>
    saveFavorites(favorites.includes(name) ? favorites.filter((n) => n !== name) : [...favorites, name]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* ── Header ── */}
      <LinearGradient
        colors={["#0d1225", C.bg]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.appTitle}>NAZAT</Text>
            <Text style={styles.appSub}>STREAM</Text>
          </View>
          <View style={styles.liveIndicator}>
            <View style={styles.livePulse} />
            <Text style={styles.liveLabel}>ON AIR</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            placeholder="Search channels…"
            placeholderTextColor={C.textMute}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Text style={styles.clearBtn}>✕</Text>
            </Pressable>
          )}
        </View>
      </LinearGradient>

      {/* ── Channel List ── */}
      {loading ? (
        <View style={styles.loadingFull}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={styles.loadingFullText}>Loading channels…</Text>
        </View>
      ) : (
        <SectionList
          sections={filtered}
          keyExtractor={(item) => `${item.text}-${item.videoUrl}`}
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section: { title } }) => <SectionHeader title={title} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <ChannelCard
              item={item}
              index={index}
              onPress={() => handleOpen(item)}
              isFavorite={favorites.includes(item.text)}
              onToggleFavorite={() => toggleFavorite(item.text)}
            />
          )}
          renderSectionFooter={() => <View style={{ height: 8 }} />}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}

      <PlayerOverlay
        channel={current}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
        onClose={closePlayer}
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

/** ── Styles ── **/
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: C.textPri,
    letterSpacing: 6,
  },
  appSub: {
    fontSize: 11,
    fontWeight: "600",
    color: C.accent,
    letterSpacing: 8,
    marginTop: -4,
  },
  liveIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.liveSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1a3d24",
  },
  livePulse: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: C.live,
  },
  liveLabel: {
    fontSize: 11, fontWeight: "800",
    color: C.live, letterSpacing: 2,
  },

  // Search
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  searchIcon: { fontSize: 18, color: C.textSec },
  searchInput: { flex: 1, color: C.textPri, fontSize: 15 },
  clearBtn: { color: C.textSec, fontSize: 14, padding: 2 },

  // Section
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
    backgroundColor: C.bg,
    gap: 10,
  },
  sectionLine: {
    width: 3, height: 16, borderRadius: 2,
    backgroundColor: C.accent,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: "800",
    color: C.textSec, letterSpacing: 2,
    textTransform: "uppercase",
  },

  // Card
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    marginHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardStrip: { width: 3, alignSelf: "stretch" },
  logoBox: {
    width: 62, height: 62,
    margin: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 52, height: 52 },
  cardInfo: { flex: 1, paddingVertical: 14, paddingRight: 8 },
  cardTitle: {
    fontSize: 15, fontWeight: "700",
    color: C.textPri, marginBottom: 6,
  },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, gap: 5,
  },
  liveDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: C.live,
  },
  pillText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  starBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  starIcon: { fontSize: 20, color: C.textMute },
  starActive: { color: C.star },

  // List
  listContent: { paddingBottom: 48 },

  // Loading
  loadingFull: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingFullText: { color: C.textSec, fontSize: 14 },

  // Modal
  modalRoot: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 10,
  },
  modalTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  modalBadge: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, gap: 5,
  },
  liveDotLg: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.live,
  },
  modalBadgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  modalTitle: {
    flex: 1, color: C.textPri,
    fontSize: 15, fontWeight: "700",
  },
  closeBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
    borderColor: C.border, backgroundColor: C.surface,
  },
  closeText: { color: C.textSec, fontWeight: "700", fontSize: 13 },

  // Player
  playerWrapper: { alignItems: "center", justifyContent: "center" },
  playerBox: { position: "relative", alignItems: "center", justifyContent: "center" },
  loadingOverlay: {
    position: "absolute", inset: 0 as any,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(8,9,15,0.7)",
    gap: 10,
  },
  loadingText: { color: C.textSec, fontSize: 13 },
  bufferBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(8,9,15,0.6)",
    borderRadius: 20,
    padding: 6,
  },

  // Error
  errorBox: {
    height: 280,
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  errorEmoji: { fontSize: 36 },
  errorText: { color: "#ef4444", fontSize: 15, fontWeight: "600" },
  openBtn: {
    marginTop: 6, backgroundColor: C.accentSoft,
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: C.accent,
  },
  openBtnText: { color: C.accent, fontWeight: "700" },

  // Hint bar
  hintBar: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center",
    gap: 6, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: C.border,
    marginTop: 10,
  },
  hintIcon: { fontSize: 13 },
  hintText: { color: C.textMute, fontSize: 12 },

  // ── Player overlay (mini docked bar ⇄ full screen) ──
  overlayBase: {
    backgroundColor: C.bg,
    overflow: "hidden",
    shadowColor: "#000",
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  ytPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: C.ytSoft },
  ytPlaceholderLogo: { width: "40%", height: "40%", opacity: 0.85 },
  errorOverlay: { alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: C.bg },

  // Mini card chrome — a small close button top-right, info strip on bottom
  miniChrome: {
    position: "absolute",
    left: 0, right: 0, bottom: 0, top: 0,
  },
  miniCloseBtn: {
    position: "absolute",
    top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  miniInfoBar: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  miniTitle: { flex: 1, color: C.textPri, fontSize: 14, fontWeight: "700" },
  miniBtnIcon: { color: C.textPri, fontSize: 13, fontWeight: "700" },
  miniRadioBtn: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },

  // Radio stage — no video, so we show station art on a gradient with a
  // big tap-to-play/pause button once full-screen.
  radioStage: { alignItems: "center", justifyContent: "center" },
  radioArt: { width: "42%", height: "42%", borderRadius: 20 },
  radioPlayBtn: {
    position: "absolute",
    bottom: "18%",
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  radioPlayIcon: { color: C.textPri, fontSize: 22, fontWeight: "700" },

  // Full-screen chrome — a gradient fade at the top with small circular
  // icon buttons, instead of a solid opaque bar
  fullChrome: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-start" },
  fullHeaderGradient: {
    position: "absolute",
    left: 0, right: 0, top: 0,
    height: 110,
  },
  fullHeaderBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingBottom: 10,
    gap: 8,
  },
  fullIconBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  fullIconBtnText: { color: C.textPri, fontWeight: "700", fontSize: 14 },
});