import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

type LoginFeedback = {
  type: 'error' | 'success';
  message: string;
};

function isLoginResponse(value: unknown): value is { session: object; user: object } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'session' in value &&
    typeof value.session === 'object' &&
    value.session !== null &&
    'user' in value &&
    typeof value.user === 'object' &&
    value.user !== null
  );
}

export default function LoginScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const passwordInput = useRef<TextInput>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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
        type: 'error',
        message: 'Přihlášení není nakonfigurované. Chybí nastavení Supabase.',
      });
      setIsSubmitting(false);
      return;
    }

    let response: Response;
    try {
      response = await fetch(
        `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/login-with-identifier`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifier: identifier.trim(), password }),
        },
      );
    } catch {
      setFeedback({
        type: 'error',
        message: 'Nepodařilo se spojit se serverem. Zkontrolujte připojení a zkuste to znovu.',
      });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      setFeedback({
        type: 'error',
        message: 'Přihlášení se nepodařilo. Zkontrolujte údaje a zkuste to znovu.',
      });
      setIsSubmitting(false);
      return;
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      setFeedback({
        type: 'error',
        message: 'Server vrátil neplatnou odpověď. Zkuste to znovu později.',
      });
      setIsSubmitting(false);
      return;
    }

    if (!isLoginResponse(result)) {
      setFeedback({
        type: 'error',
        message: 'Server vrátil neplatnou odpověď. Zkuste to znovu později.',
      });
      setIsSubmitting(false);
      return;
    }

    setFeedback({
      type: 'success',
      message: 'Přihlášení proběhlo úspěšně. Relace se zatím neukládá.',
    });
    setIsSubmitting(false);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text style={styles.title}>Přihlášení</Text>
            <Text style={[styles.subtitle, { color: theme.text }]}>
              Přihlaste se do Dotazníčku.
            </Text>

            <View style={styles.field}>
              <Text style={styles.label}>E-mail nebo přezdívka</Text>
              <TextInput
                accessibilityLabel="E-mail nebo přezdívka"
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={setIdentifier}
                onSubmitEditing={() => passwordInput.current?.focus()}
                placeholder="Zadejte e-mail nebo přezdívku"
                placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#666'}
                returnKeyType="next"
                style={[styles.input, { borderColor: theme.tabIconDefault, color: theme.text }]}
                value={identifier}
              />
              <Text style={[styles.hint, { color: theme.text }]}>
                Pro administrátorský účet nechte toto pole prázdné.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Heslo</Text>
              <TextInput
                ref={passwordInput}
                accessibilityLabel="Heslo"
                autoComplete="current-password"
                onChangeText={setPassword}
                onSubmitEditing={handleLogin}
                placeholder="Zadejte heslo"
                placeholderTextColor={colorScheme === 'dark' ? '#aaa' : '#666'}
                returnKeyType="done"
                secureTextEntry
                style={[styles.input, { borderColor: theme.tabIconDefault, color: theme.text }]}
                value={password}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitting || password.length === 0 }}
              disabled={isSubmitting || password.length === 0}
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? '#115E59' : '#0F766E' },
                (isSubmitting || password.length === 0) && styles.buttonDisabled,
              ]}>
              <Text style={styles.buttonText}>
                {isSubmitting ? 'Přihlašuji…' : 'Přihlásit se'}
              </Text>
            </Pressable>

            {feedback ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.feedback,
                  {
                    color:
                      feedback.type === 'error'
                        ? colorScheme === 'dark'
                          ? '#FDA29B'
                          : '#B42318'
                        : colorScheme === 'dark'
                          ? '#6CE9A6'
                          : '#067647',
                  },
                ]}>
                {feedback.message}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  form: {
    alignSelf: 'center',
    maxWidth: 440,
    width: '100%',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  hint: {
    fontSize: 14,
    marginTop: 8,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 52,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  feedback: {
    fontSize: 15,
    marginTop: 20,
  },
});
