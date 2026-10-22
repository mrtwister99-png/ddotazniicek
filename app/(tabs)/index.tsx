import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrutalButton } from "@/components/BrutalButton";
import { BrutalCard } from "@/components/BrutalCard";
import { Text, View } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors, { FONTS, NEO } from "@/constants/Colors";
import { isAdminUser, setAuthSession } from "@/lib/auth-session";

type LoginFeedback = {
  type: "error" | "success";
  message: string;
};

function isLoginResponse(
  value: unknown,
): value is { session: object; user: object } {
  return (
    typeof value === "object" &&
    value !== null &&
    "session" in value &&
    typeof value.session === "object" &&
    value.session !== null &&
    "user" in value &&
    typeof value.user === "object" &&
    value.user !== null
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const passwordInput = useRef<TextInput>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<LoginFeedback | null>(null);

  const handleLogin = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFeedback(null);

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      setFeedback({
        type: "error",
        message: "Přihlášení není nakonfigurované. Chybí nastavení Supabase.",
      });
      setIsSubmitting(false);
      return;
    }

    let response: Response;
    try {
      response = await fetch(
        `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/login-with-identifier`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ identifier: identifier.trim(), password }),
        },
      );
    } catch {
      setFeedback({
        type: "error",
        message:
          "Nepodařilo se spojit se serverem. Zkontrolujte připojení a zkuste to znovu.",
      });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFeedback({
        type: "error",
        message:
          "Přihlášení se nepodařilo. Zkontrolujte údaje a zkuste to znovu.",
      });
      setIsSubmitting(false);
      return;
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      setFeedback({
        type: "error",
        message: "Server vrátil neplatnou odpověď. Zkuste to znovu později.",
      });
      setIsSubmitting(false);
      return;
    }

    if (!isLoginResponse(result)) {
      setFeedback({
        type: "error",
        message: "Server vrátil neplatnou odpověď. Zkuste to znovu později.",
      });
      setIsSubmitting(false);
      return;
    }

    // Uložíme session do paměti a pošleme uživatele do správného menu (admin / uživatel).
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAuthSession(result);
    setIsSubmitting(false);
    router.replace(isAdminUser(result.user) ? "/admin" : "/user");
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: "#BABABA" }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <BrutalCard bg="#fff" style={styles.form} rotate="0.5deg">
            <Text style={[styles.title, FONTS.brutalTitle]}>PŘIHLÁŠENÍ</Text>
            <Text style={[styles.subtitle, { color: "#000", ...FONTS.mono }]}>
              Přihlas se do Dotazníčku.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.label, FONTS.brutalTitle]}>
                E-mail nebo přezdívka
              </Text>
              <View style={styles.inputWrap}>
                <View
                  style={[styles.inputShadow, { backgroundColor: NEO.black }]}
                />
                <TextInput
                  accessibilityLabel="E-mail nebo přezdívka"
                  autoCapitalize="none"
                  autoComplete="username"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={setIdentifier}
                  onSubmitEditing={() => passwordInput.current?.focus()}
                  placeholder="Zadejte e-mail nebo přezdívku"
                  placeholderTextColor="#666"
                  returnKeyType="next"
                  style={[
                    styles.input,
                    { borderColor: NEO.black, color: "#000" },
                  ]}
                  value={identifier}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, FONTS.brutalTitle]}>Heslo</Text>
              <View style={styles.inputWrap}>
                <View
                  style={[styles.inputShadow, { backgroundColor: NEO.black }]}
                />
                <TextInput
                  ref={passwordInput}
                  accessibilityLabel="Heslo"
                  autoComplete="current-password"
                  onChangeText={setPassword}
                  onSubmitEditing={handleLogin}
                  placeholder="Zadejte heslo"
                  placeholderTextColor="#666"
                  returnKeyType="done"
                  secureTextEntry={!isPasswordVisible}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    { borderColor: NEO.black, color: "#000" },
                  ]}
                  value={password}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Zobrazit heslo podržením"
                  onPressIn={() => setIsPasswordVisible(true)}
                  onPressOut={() => setIsPasswordVisible(false)}
                  style={styles.passwordVisibilityButton}
                >
                  <Ionicons
                    name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
                    size={22}
                    color="#000"
                  />
                </Pressable>
              </View>
            </View>

            <BrutalButton
              title={isSubmitting ? "Přihlašuji…" : "Přihlásit se"}
              variant="black"
              onPress={handleLogin}
              disabled={isSubmitting}
              loading={isSubmitting}
              style={{ marginTop: 8, width: "100%", alignSelf: "stretch" }}
            />
            <BrutalButton
              title="Vytvořit účet"
              variant="yellow"
              onPress={() => router.push("/register")}
              disabled={isSubmitting}
              style={{ marginTop: 12, width: "100%", alignSelf: "stretch" }}
            />

            {feedback ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.feedback,
                  {
                    color: feedback.type === "error" ? "#FDA29B" : "#B42318",
                  },
                ]}
              >
                {feedback.message}
              </Text>
            ) : null}
          </BrutalCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#BABABA",
  },
  form: { alignSelf: "center", maxWidth: 440, width: "100%" },
  title: { fontSize: 30, marginBottom: 8 },
  subtitle: { fontSize: 14, marginBottom: 24, fontFamily: "SpaceMono-Regular" },
  field: { marginBottom: 18 },
  label: { fontSize: 13, marginBottom: 8 },
  inputWrap: { position: "relative" },
  inputShadow: { position: "absolute", top: 4, left: 4, right: -3, bottom: -3 },
  input: {
    borderRadius: 0,
    borderWidth: 3,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
    fontFamily: "SpaceMono-Regular",
  },
  passwordInputContainer: {
    justifyContent: "center",
  },
  passwordInput: {
    paddingRight: 56,
  },
  passwordVisibilityButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    width: 48,
  },
  hint: {
    fontSize: 14,
    marginTop: 8,
  },
  button: {
    alignItems: "center",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 52,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  feedback: {
    fontSize: 15,
    marginTop: 20,
  },
});
