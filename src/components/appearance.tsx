"use client";

import { useEffect } from "react";

/** Applies the saved appearance on broker and driver routes. */
export function Appearance() {
  useEffect(() => {
    const preference = localStorage.getItem("loadwallet-theme");
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = (preference ? preference === "dark" : system.matches) ? "dark" : "light";
    };
    apply();
    if (preference) return;
    const followSystem = () => { if (!localStorage.getItem("loadwallet-theme")) apply(); };
    system.addEventListener("change", followSystem);
    return () => system.removeEventListener("change", followSystem);
  }, []);
  return null;
}
