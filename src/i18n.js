/* global chrome */

import { getSettings, updateSettings } from "./settings.js";

// Load manifest or map files dynamically
const BUILTIN_LOCALES = ["en", "fr"];

function deepGet(obj, path) {
  return path
    .split(".")
    .reduce(
      (acc, k) =>
        acc && Object.prototype.hasOwnProperty.call(acc, k)
          ? acc[k]
          : undefined,
      obj,
    );
}

async function loadLocaleFile(locale) {
  try {
    const response = await fetch(
      chrome.runtime.getURL(`locales/${locale}.json`),
    );
    return await response.json();
  } catch (e) {
    console.error(`Failed to load locale: ${locale}`, e);
    return null;
  }
}

export async function getI18nContext() {
  const settings = await getSettings();
  const locale = settings.locale || "en";
  const customLocales = settings.customLocales || {};

  // Load the dictionary: check custom storage first, then fetch file
  let dict = customLocales[locale];
  if (!dict) {
    dict = await loadLocaleFile(locale);
  }

  // Fallback to English if current fails
  if (!dict) {
    dict = await loadLocaleFile("en");
  }

  const t = (key, vars = {}) => {
    const template = deepGet(dict, key) ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, name) =>
      String(vars[name] ?? `{${name}}`),
    );
  };

  // Build the list of available locales (builtin + custom keys)
  const availableLocales = new Set([
    ...BUILTIN_LOCALES,
    ...Object.keys(customLocales),
  ]);

  return {
    locale,
    customLocales,
    t,
    locales: Array.from(availableLocales),
  };
}

export async function setLocale(locale) {
  await updateSettings({ locale });
}

export async function saveCustomLocale(locale, messages) {
  const settings = await getSettings();
  const customLocales = {
    ...(settings.customLocales || {}),
    [locale]: messages,
  };
  await updateSettings({ customLocales });
}
