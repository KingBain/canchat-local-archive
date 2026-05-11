import { getAllSearchDocs, withStore } from "./db.js";

export function includesAllTerms(text, terms) {
  return terms.every((t) => text.includes(t));
}

export function snippet(text, terms) {
  const idx = terms.map((t) => text.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  return text.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, " ").trim();
}

export async function searchChats(origin, query) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const docs = await getAllSearchDocs(origin);
  const matches = [];

  for (const doc of docs) {
    const hay = `${doc.titleLower || ""} ${doc.contentLower || ""}`;
    if (!includesAllTerms(hay, terms)) continue;
    const chat = await withStore("chats", "readonly", (store) =>
      new Promise((resolve, reject) => {
        const r = store.get(doc.id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
    );

    const status = chat?.localOnly ? "local-only" : chat?.restored ? "restored" : "still-on-server";
    matches.push({ id: doc.id, title: chat?.title || "Untitled", status, snippet: snippet(hay, terms) });
  }

  return matches.slice(0, 50);
}
