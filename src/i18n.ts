/**
 * Current UI language. Resolved once at load from ?lang=, then the saved choice,
 * then the browser language; switching keeps ?lang= in the URL so links share it.
 */
import { I18N, LOCALES, PAGE, type Locale, type Text } from './config';

const isLocale = (v: string | null): v is Locale => LOCALES.includes(v as Locale);

// Storage can throw (private mode, blocked site data); the choice then lasts only for this page.
const readSaved = () => {
  try {
    return localStorage.getItem(I18N.storageKey);
  } catch {
    return null;
  }
};

function detect(): Locale {
  const query = new URLSearchParams(location.search).get(I18N.queryParam);
  if (isLocale(query)) return query;
  const saved = readSaved();
  if (isLocale(saved)) return saved;
  return navigator.language.toLowerCase().startsWith(I18N.zhPrefix) ? 'zh-TW' : I18N.fallback;
}

let current: Locale = detect();

export const locale = () => current;

/** The string for the current locale. */
export const t = (text: Text) => text[current];

/** Document-level language state: <html lang> and the tab title. */
export function applyDocumentLocale() {
  document.documentElement.lang = current;
  document.title = t(PAGE.documentTitle);
}

export function setLocale(next: Locale) {
  current = next;
  try {
    localStorage.setItem(I18N.storageKey, next);
  } catch {
    /* see readSaved */
  }
  const url = new URL(location.href);
  url.searchParams.set(I18N.queryParam, next);
  history.replaceState(null, '', url);
  applyDocumentLocale();
}
