import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View as RNView,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrutalBadge } from "@/components/BrutalBadge";
import { BrutalButton } from "@/components/BrutalButton";
import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors, { NEO } from "@/constants/Colors";
import {
  AuthError,
  PIN_LENGTH,
  RESERVED_NICKNAMES,
  isNicknameAvailable,
  resendCode,
  signUp,
  verifyCode,
} from "@/lib/auth-api";
import { setAuthSession } from "@/lib/auth-session";

type Errors = {
  email?: string;
  nickname?: string;
  password?: string;
  confirm?: string;
};

const RESEND_SECONDS = 60;

function messageFor(error: unknown): string {
  const code = error instanceof AuthError ? error.code : "failed";
  switch (code) {
    case "network":
      return "Nepodařilo se spojit se serverem. Zkontrolujte připojení.";
    case "rate-limited":
      return "Příliš mnoho pokusů. Zkuste to za chvíli.";
    case "invalid-code":
      return "Kód je neplatný nebo vypršel.";
    case "weak-password":
      return "Heslo je příliš slabé. Zvolte delší nebo složitější.";
    case "nickname":
      return "Přezdívka je obsazená nebo nepovolená.";
    case "confirm-disabled":
      return "Ověření e-mailem není na serveru zapnuté. Registrace byla zastavena.";
    default:
      return "Něco se nepovedlo. Zkontrolujte údaje a zkuste to znovu.";
  }
}

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const placeholderColor = colorScheme === "dark" ? "#aaa" : "#666";
  const inputStyle = [
    styles.input,
    { borderColor: theme.tabIconDefault, color: theme.text },
  ];

  const [step, setStep] = useState<"form" | "pin">("form");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [isPinFocused, setIsPinFocused] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const pinRefs = useRef<(TextInput | null)[]>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 10,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -10,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 8,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 60,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Odpočet před dalším odesláním kódu.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const validate = (): Errors => {
    const found: Errors = {};
    const cleanNick = nickname.trim().replace(/\s+/g, " ");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      found.email = "Zadejte platný e-mail.";
    if (cleanNick.length < 2 || cleanNick.length > 32) {
      found.nickname = "Přezdívka musí mít 2 až 32 znaků.";
    } else if (RESERVED_NICKNAMES.includes(cleanNick.toLowerCase())) {
      found.nickname = "Tuto přezdívku nelze použít.";
    }
    if (password.length < 8) found.password = "Heslo musí mít alespoň 8 znaků.";
    if (confirm !== password) found.confirm = "Hesla se neshodují.";
    return found;
  };

  const submitForm = async () => {
    if (isBusy) return;
    const found = validate();
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length > 0) return;

    setIsBusy(true);
    try {
      const cleanNick = nickname.trim().replace(/\s+/g, " ");
      if (!(await isNicknameAvailable(cleanNick))) {
        setErrors({ nickname: "Přezdívka je obsazená nebo nepovolená." });
        setIsBusy(false);
        return;
      }
      await signUp(email.trim(), password, cleanNick);
      setPin("");
      setCooldown(RESEND_SECONDS);
      setStep("pin");
    } catch (error) {
      setMessage({ error: true, text: messageFor(error) });
    } finally {
      setIsBusy(false);
    }
  };

  const submitPin = async () => {
    if (isBusy || pin.length !== PIN_LENGTH) return;
    // auto-focus pryč po 6. číslici
    pinRefs.current.forEach((r) => r?.blur());
    setFocusedIndex(null);
    setIsBusy(true);
    setMessage(null);
    try {
      const auth = await verifyCode(email.trim(), pin);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage({ error: false, text: "✅ Účet ověřen! Přesměrovávám..." });
      setAuthSession(auth);
      setTimeout(() => {
        router.replace("/user");
      }, 900);
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      triggerShake();
      setMessage({ error: true, text: messageFor(error) });
      setIsBusy(false);
    }
  };

  const resend = async () => {
    if (isBusy || cooldown > 0) return;
    setIsBusy(true);
    setMessage(null);
    try {
      await resendCode(email.trim());
      setCooldown(RESEND_SECONDS);
      setMessage({ error: false, text: "Kód jsme poslali znovu." });
    } catch (error) {
      setMessage({ error: true, text: messageFor(error) });
    } finally {
      setIsBusy(false);
    }
  };

  const feedback = message ? (
    message.error ? (
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.feedback, { color: "#B42318" }]}
      >
        {message.text}
      </Text>
    ) : (
      <View style={{ marginTop: 16, alignItems: "center", gap: 8 }}>
        <BrutalBadge label="HOTOVO" bg={NEO.green} rotate="-2deg" />
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.feedback, { color: "#067647", marginTop: 8 }]}
        >
          {message.text}
        </Text>
      </View>
    )
  ) : null;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background }]}
    >
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.form}>
            {step === "form" ? (
              <>
                <Text style={styles.title}>Vytvořit účet</Text>

                <Text style={styles.label}>E-mail</Text>
                <TextInput
                  accessibilityLabel="E-mail"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="vas@email.cz"
                  placeholderTextColor={placeholderColor}
                  style={inputStyle}
                  value={email}
                />
                {errors.email ? (
                  <Text style={styles.error}>{errors.email}</Text>
                ) : null}

                <Text style={styles.label}>Přezdívka</Text>
                <TextInput
                  accessibilityLabel="Přezdívka"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={32}
                  onChangeText={setNickname}
                  placeholder="Jak vám máme říkat"
                  placeholderTextColor={placeholderColor}
                  style={inputStyle}
                  value={nickname}
                />
                {errors.nickname ? (
                  <Text style={styles.error}>{errors.nickname}</Text>
                ) : null}

                <Text style={styles.label}>Heslo</Text>
                <RNView style={{ justifyContent: "center" }}>
                  <TextInput
                    accessibilityLabel="Heslo"
                    autoComplete="new-password"
                    onChangeText={setPassword}
                    placeholder="Alespoň 8 znaků"
                    placeholderTextColor={placeholderColor}
                    secureTextEntry={!isPasswordVisible}
                    style={[inputStyle, { paddingRight: 56 }]}
                    value={password}
                  />
                  <Pressable
                    onPressIn={() => setIsPasswordVisible(true)}
                    onPressOut={() => setIsPasswordVisible(false)}
                    style={{
                      position: "absolute",
                      right: 2,
                      width: 48,
                      height: 48,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={
                        isPasswordVisible ? "eye-off-outline" : "eye-outline"
                      }
                      size={22}
                      color={theme.text}
                    />
                  </Pressable>
                </RNView>
                {errors.password ? (
                  <Text style={styles.error}>{errors.password}</Text>
                ) : null}

                <Text style={styles.label}>Heslo znovu</Text>
                <RNView style={{ justifyContent: "center" }}>
                  <TextInput
                    accessibilityLabel="Heslo znovu"
                    autoComplete="new-password"
                    onChangeText={setConfirm}
                    onSubmitEditing={submitForm}
                    placeholder="Zopakujte heslo"
                    placeholderTextColor={placeholderColor}
                    secureTextEntry={!isConfirmVisible}
                    style={[inputStyle, { paddingRight: 56 }]}
                    value={confirm}
                  />
                  <Pressable
                    onPressIn={() => setIsConfirmVisible(true)}
                    onPressOut={() => setIsConfirmVisible(false)}
                    style={{
                      position: "absolute",
                      right: 2,
                      width: 48,
                      height: 48,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={
                        isConfirmVisible ? "eye-off-outline" : "eye-outline"
                      }
                      size={22}
                      color={theme.text}
                    />
                  </Pressable>
                </RNView>
                {errors.confirm ? (
                  <Text style={styles.error}>{errors.confirm}</Text>
                ) : null}

                <BrutalButton
                  title={isBusy ? "Odesílám…" : "Vytvořit účet"}
                  variant="black"
                  onPress={submitForm}
                  disabled={isBusy}
                  loading={isBusy}
                  style={{ width: "100%", alignSelf: "stretch", marginTop: 24 }}
                />
                {feedback}

                <BrutalButton
                  title="Zpět na přihlášení"
                  variant="white"
                  onPress={() => router.back()}
                  style={{ width: "100%", alignSelf: "stretch", marginTop: 12 }}
                />
              </>
            ) : (
              <>
                <Text style={styles.title}>Ověření e-mailu</Text>
                <Text style={styles.subtitle}>
                  Pokud je adresa {email.trim()} v pořádku, poslali jsme na ni
                  kód o {PIN_LENGTH} číslicích. Zadejte ho tady.
                </Text>

                <Animated.View
                  style={[
                    styles.pinRow,
                    { transform: [{ translateX: shakeAnim }] },
                  ]}
                >
                  {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                    const digit = pin[i] ?? "";
                    const isFocused = focusedIndex === i;
                    return (
                      <View key={i} style={styles.pinBoxWrap}>
                        <View style={styles.pinBoxShadow} />
                        <TextInput
                          ref={(el) => {
                            pinRefs.current[i] = el;
                          }}
                          accessibilityLabel={`Kód číslice ${i + 1}`}
                          keyboardType="number-pad"
                          maxLength={1}
                          selectionColor="#000"
                          value={digit}
                          onChangeText={(v) => {
                            const clean = v.replace(/\D/g, "").slice(-1);
                            const arr = pin.split("");
                            while (arr.length < PIN_LENGTH) arr.push("");
                            arr[i] = clean;
                            const joined = arr.join("").slice(0, PIN_LENGTH);
                            setPin(joined);
                            if (clean && i < PIN_LENGTH - 1) {
                              pinRefs.current[i + 1]?.focus();
                            }
                            if (joined.length === PIN_LENGTH) {
                              pinRefs.current.forEach((r) => r?.blur());
                              setFocusedIndex(null);
                              setTimeout(() => submitPin(), 80);
                            }
                          }}
                          onKeyPress={({ nativeEvent }) => {
                            if (
                              nativeEvent.key === "Backspace" &&
                              !digit &&
                              i > 0
                            ) {
                              pinRefs.current[i - 1]?.focus();
                            }
                          }}
                          onFocus={() => {
                            setFocusedIndex(i);
                            setIsPinFocused(true);
                          }}
                          onBlur={() => {
                            setFocusedIndex(null);
                            setIsPinFocused(false);
                          }}
                          style={[
                            styles.pinBox,
                            {
                              backgroundColor: isFocused ? "#FFE600" : "#fff",
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </Animated.View>
                <TextInput
                  value={pin}
                  onChangeText={(v) =>
                    setPin(v.replace(/\D/g, "").slice(0, PIN_LENGTH))
                  }
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  keyboardType="number-pad"
                  style={{ height: 0, opacity: 0 }}
                  pointerEvents="none"
                />

                <BrutalButton
                  title={isBusy ? "Ověřuji…" : "Ověřit"}
                  variant="black"
                  onPress={submitPin}
                  disabled={isBusy || pin.length !== PIN_LENGTH}
                  loading={isBusy}
                  style={{ width: "100%", alignSelf: "stretch" }}
                />
                {feedback}

                <BrutalButton
                  title={
                    cooldown > 0
                      ? `Poslat kód znovu (${cooldown} s)`
                      : "Poslat kód znovu"
                  }
                  variant="yellow"
                  onPress={resend}
                  disabled={isBusy || cooldown > 0}
                  style={{ width: "100%", alignSelf: "stretch", marginTop: 12 }}
                />
                <BrutalButton
                  title="Změnit údaje"
                  variant="white"
                  onPress={() => {
                    setMessage(null);
                    setStep("form");
                  }}
                  style={{ width: "100%", alignSelf: "stretch", marginTop: 12 }}
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  form: { alignSelf: "center", maxWidth: 440, width: "100%" },
  title: { fontSize: 30, fontWeight: "700", marginBottom: 16 },
  subtitle: { fontSize: 16, marginBottom: 20 },
  label: { fontSize: 16, fontWeight: "600", marginBottom: 8, marginTop: 12 },
  input: {
    borderRadius: 0,
    borderWidth: 3,
    borderColor: "#000",
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
    fontFamily: "SpaceMono-Regular",
  },
  pinRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 12,
    width: "100%",
  },
  pinBoxWrap: { position: "relative", width: 48, height: 64, flex: 1 },
  pinBoxShadow: {
    position: "absolute",
    top: 6,
    left: 6,
    right: -4,
    bottom: -4,
    backgroundColor: "#000",
  },
  pinBox: {
    borderWidth: 4,
    borderColor: "#000",
    borderRadius: 0,
    backgroundColor: "#fff",
    width: "100%",
    height: 56,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
  },
  pinWrap: { position: "relative", width: "100%", marginTop: 8 },
  pinShadow: {
    position: "absolute",
    top: 8,
    left: 8,
    right: -6,
    bottom: -6,
    backgroundColor: "#000",
  },
  pinInput: {
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    fontWeight: "900",
    fontFamily: "SpaceMono-Regular",
    borderWidth: 4,
    borderColor: "#000",
    borderRadius: 0,
    backgroundColor: "#fff",
    minHeight: 68,
    paddingHorizontal: 14,
    textTransform: "uppercase",
  },
  error: { color: "#B42318", fontSize: 14, marginTop: 6 },
  feedback: { fontSize: 15, marginTop: 16 },
});
