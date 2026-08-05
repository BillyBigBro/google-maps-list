"use client";

/**
 * There are no accounts, so a list is only findable by its URL. The browser
 * remembers which lists this person has opened, purely as a convenience —
 * the server never sees it, and clearing it loses nothing but the shortcut.
 */
const KEY = "gmaps-recent-lists";
const LIMIT = 20;

export function getRecentIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function rememberList(id: string): void {
  if (typeof window === "undefined") return;
  const next = [id, ...getRecentIds().filter((v) => v !== id)].slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing or a full quota; the shortcut is optional.
  }
}

export function forgetList(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(getRecentIds().filter((v) => v !== id)));
  } catch {
    // Ignore.
  }
}
