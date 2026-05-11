import en from "../locales/en.json" assert { type: "json" };
import fr from "../locales/fr.json" assert { type: "json" };
import { getSettings, updateSettings } from "./settings.js";

const BUILTIN_LOCALES = { en, fr };

function deepGet(obj, path) {
  return path.split(".").reduce((acc, k) => (acc && Object.prototype.hasOwnProperty.call(acc, k) ? acc[k] : undefined), obj);
}

export async function getI18nContext() {
  const settings = await getSettings();
  const locale = settings.locale || "en";
  const customLocales = settings.customLocales || {};
  const dict = customLocales[locale] || BUILTIN_LOCALES[locale] || BUILTIN_LOCALES.en;

  const t = (key, vars = {}) => {
    const template = deepGet(dict, key) ?? deepGet(BUILTIN_LOCALES.en, key) ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
  };

  return { locale, customLocales, t, locales: { ...BUILTIN_LOCALES, ...customLocales } };
}

export async function setLocale(locale) {
  await updateSettings({ locale });
}

export async function saveCustomLocale(locale, messages) {
  const settings = await getSettings();
  const customLocales = { ...(settings.customLocales || {}), [locale]: messages };
  await updateSettings({ customLocales });
}
