// Central registry of supported source languages. To add a language, add one entry here.
// Safe to import from both client and server code (no secrets).

export interface LanguageConfig {
  /** Stable key stored in the DB and sent between client and server. */
  id: string;
  /** English display name. */
  name: string;
  /** Name in its own script. */
  nativeName: string;
  /** Sarvam language code (BCP-47). */
  code: string;
  transcription: {
    model: string;
    mode: string;
  };
  translation: {
    model: string;
    targetCode: string;
  };
}

const defaults = {
  transcription: { model: "saaras:v3", mode: "transcribe" },
  translation: { model: "sarvam-translate:v1", targetCode: "en-IN" },
};

export const LANGUAGES = {
  ta: { id: "ta", name: "Tamil", nativeName: "தமிழ்", code: "ta-IN", ...defaults },
  te: { id: "te", name: "Telugu", nativeName: "తెలుగు", code: "te-IN", ...defaults },
} as const satisfies Record<string, LanguageConfig>;

export type LanguageId = keyof typeof LANGUAGES;

export const DEFAULT_LANGUAGE: LanguageId = "ta";

export const LANGUAGE_LIST: LanguageConfig[] = Object.values(LANGUAGES);

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, value);
}

/** Returns the config for a client-supplied value, or null if unsupported. */
export function resolveLanguage(value: unknown): LanguageConfig | null {
  return isLanguageId(value) ? LANGUAGES[value] : null;
}

/** For records saved before the `language` column existed. */
export function languageOrDefault(value: unknown): LanguageConfig {
  return resolveLanguage(value) ?? LANGUAGES[DEFAULT_LANGUAGE];
}
