export function initials(name: string, fallback = "") {
  const parts = (name.trim() || fallback).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
