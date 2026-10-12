import { messages } from "../shared/i18n";

/** Shown only while the field contains text, including spaces. */
export function showsClearButton(value: string): boolean {
  return value.length > 0;
}

/**
 * Wire the in-field clear control.
 * Clicking it empties the field and puts the cursor back. It does not submit or search.
 * Returns a sync function for when script assigns the field value directly.
 */
export function bindClearButton(field: HTMLInputElement, button: HTMLButtonElement): () => void {
  button.type = "button";
  button.setAttribute("aria-label", messages.clear);

  const sync = (): void => {
    button.hidden = !showsClearButton(field.value);
  };

  button.addEventListener("click", () => {
    field.value = "";
    sync();
    field.focus({ preventScroll: true });
  });

  field.addEventListener("input", sync);
  field.addEventListener("search", sync);
  sync();
  return sync;
}
