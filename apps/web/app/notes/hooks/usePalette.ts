// usePalette: the user's custom swatches (max 16), saved to the API.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { MSG } from "../constants";

// Used by: useNotesPage → NoteBoard / NoteDialog colour palettes.
export function usePalette(setNotice: (m: string) => void) {
  const [palette, setPalette] = useState<string[]>([]);
  useEffect(() => {
    api("/palette").then(r => setPalette(Array.isArray(r?.colors) ? r.colors : []), () => {});
  }, []);

  // Optimistic: show the new swatches now, adopt the server's cleaned list when it replies.
  const savePalette = (next: string[]) => {
    setPalette(next);
    api("/palette", { method: "PUT", body: JSON.stringify({ colors: next }) }).then(
      r => Array.isArray(r?.colors) && setPalette(r.colors), () => setNotice(MSG.paletteFailed));
  };
  const addCustom = (hex: string) => { if (!palette.includes(hex)) savePalette([...palette, hex].slice(-16)); };
  const removeCustom = (hex: string) => savePalette(palette.filter(c => c !== hex));

  return { palette, addCustom, removeCustom };
}
