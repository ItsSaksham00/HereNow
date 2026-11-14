import React from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme/theme';

export function Layout({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.canvas }}>
    {scroll ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>}
  </SafeAreaView>;
}
export function Title({ children }: { children: React.ReactNode }) { return <Text style={styles.title}>{children}</Text>; }
export function Muted({ children, style }: { children: React.ReactNode; style?: any }) { return <Text style={[styles.muted, style]}>{children}</Text>; }
export function Btn({ label, onPress, secondary = false, lime = false, disabled = false, style }: { label: string; onPress: () => void; secondary?: boolean; lime?: boolean; disabled?: boolean; style?: ViewStyle }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.secondary, lime && { backgroundColor: C.lime }, disabled && { opacity: 0.5 }, style]}>
    <Text style={[styles.buttonLabel, (secondary || lime) && { color: C.ink }]}>{label}</Text>
  </Pressable>;
}
export function IconButton({ name, onPress }: { name: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.iconButton}><Ionicons name={name} size={22} color={C.ink}/></Pressable>;
}
export function Field({ label, value, onChangeText, secureTextEntry, placeholder, autoCapitalize, multiline }: {
  label: string; value: string; onChangeText: (text: string) => void; secureTextEntry?: boolean;
  placeholder?: string; autoCapitalize?: 'none' | 'sentences' | 'words'; multiline?: boolean;
}) {
  return <View style={{ marginBottom: 16 }}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={[styles.input, multiline && { height: 110, textAlignVertical: 'top' }]} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#87938A" secureTextEntry={secureTextEntry} autoCapitalize={autoCapitalize} multiline={multiline}/></View>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) { return <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator color={C.green}/><Muted style={{ marginTop: 12 }}>{label}</Muted></View>; }
export function ErrorText({ message }: { message: string | null }) { return message ? <Text style={{ color: '#B73B32', marginVertical: 12 }}>{message}</Text> : null; }
export function LabelChip({ text }: { text: string }) { return <View style={{ backgroundColor: C.pale, borderRadius: 30, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: C.ink, fontWeight: '600', fontSize: 12 }}>{text}</Text></View>; }
export const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44 },
  title: { color: C.ink, fontSize: 30, fontWeight: '800', lineHeight: 35, letterSpacing: -1, marginTop: 24, marginBottom: 10 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  button: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center', marginTop: 12, minHeight: 50, justifyContent: 'center' },
  secondary: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border },
  buttonLabel: { color: 'white', fontSize: 15, fontWeight: '700' },
  iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.pale },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginBottom: 8, color: C.ink },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: 'white', borderRadius: 13, padding: 14, color: C.ink, minHeight: 49, fontSize: 15 },
});
