import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View as RNView,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
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
    setIsBusy(true);
    setMessage(null);
    try {
      const auth = await verifyCode(email.trim(), pin);
      setAuthSession(auth);
      router.replace("/user");
    } catch (error) {
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
    <Text
      accessibilityLiveRegion="polite"
      style={[
        styles.feedback,
        { color: message.error ? "#B42318" : "#067647" },
      ]}
    >
      {message.text}
    </Text>
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

                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy}
                  onPress={submitForm}
                  style={[styles.button, isBusy && styles.disabled]}
                >
                  <Text style={styles.buttonText}>
                    {isBusy ? "Odesílám…" : "Vytvořit účet"}
                  </Text>
                </Pressable>
                {feedback}

                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.back()}
                  style={[styles.outline, { borderColor: "#0F766E" }]}
                >
                  <Text style={styles.outlineText}>Zpět na přihlášení</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.title}>Ověření e-mailu</Text>
                <Text style={styles.subtitle}>
                  Pokud je adresa {email.trim()} v pořádku, poslali jsme na ni
                  kód o {PIN_LENGTH} číslicích. Zadejte ho tady.
                </Text>

                <TextInput
                  accessibilityLabel="Kód z e-mailu"
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  maxLength={PIN_LENGTH}
                  onChangeText={(value) => setPin(value.replace(/\D/g, ""))}
                  onSubmitEditing={submitPin}
                  placeholder={"•".repeat(PIN_LENGTH)}
                  placeholderTextColor={placeholderColor}
                  style={[inputStyle, styles.pinInput]}
                  value={pin}
                />

                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy || pin.length !== PIN_LENGTH}
                  onPress={submitPin}
                  style={[
                    styles.button,
                    (isBusy || pin.length !== PIN_LENGTH) && styles.disabled,
                  ]}
                >
                  <Text style={styles.buttonText}>
                    {isBusy ? "Ověřuji…" : "Ověřit"}
                  </Text>
                </Pressable>
                {feedback}

                <Pressable
                  accessibilityRole="button"
                  disabled={isBusy || cooldown > 0}
                  onPress={resend}
                  style={[
                    styles.outline,
                    { borderColor: "#0F766E" },
                    cooldown > 0 && styles.disabled,
                  ]}
                >
                  <Text style={styles.outlineText}>
                    {cooldown > 0
                      ? `Poslat kód znovu (${cooldown} s)`
                      : "Poslat kód znovu"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setMessage(null);
                    setStep("form");
                  }}
                  style={styles.link}
                >
                  <Text style={styles.linkText}>Změnit údaje</Text>
                </Pressable>
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
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  pinInput: { fontSize: 24, letterSpacing: 8, textAlign: "center" },
  error: { color: "#B42318", fontSize: 14, marginTop: 6 },
  feedback: { fontSize: 15, marginTop: 16 },
  button: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 10,
    justifyContent: "center",
    marginTop: 24,
    minHeight: 52,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  outline: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 52,
  },
  outlineText: { fontSize: 16, fontWeight: "600" },
  link: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 44,
  },
  linkText: { fontSize: 16, textDecorationLine: "underline" },
  disabled: { opacity: 0.55 },
});
