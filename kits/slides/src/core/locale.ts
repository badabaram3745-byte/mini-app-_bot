export type SupportedLocale =
  | "de"
  | "en"
  | "es"
  | "fr"
  | "ja"
  | "ko"
  | "pt"
  | "zh-CN"
  | "zh-TW";

export function resolveLocale(requestedLocale?: string): SupportedLocale {
  const browserLocale =
    typeof navigator === "undefined"
      ? undefined
      : (navigator.languages?.[0] ?? navigator.language);
  const normalized = (requestedLocale ?? browserLocale ?? "en")
    .replace("_", "-")
    .toLowerCase();

  if (normalized.startsWith("zh-")) {
    return /-(hk|mo|tw)(-|$)/.test(normalized) ? "zh-TW" : "zh-CN";
  }

  const language = normalized.split("-")[0];
  if (
    language === "de" ||
    language === "en" ||
    language === "es" ||
    language === "fr" ||
    language === "ja" ||
    language === "ko" ||
    language === "pt"
  ) {
    return language;
  }
  return "en";
}
