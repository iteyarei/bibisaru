/**
 * Open/close wiring for the 「熱門搜尋商品」 panel under the search box.
 *
 * The panel opens when the box gains focus, or when it is clicked. The X hides
 * it and latches it shut. It comes back when the user returns to the box: a
 * click always reopens, and so does a focus after the box was left. A focus
 * that arrives while the box never lost focus (phones re-focusing the field
 * they kept, or our own focus() call) is the tail of the same visit and does
 * not reopen it, and neither does a focus in the first moments after the X,
 * which is the same tap bouncing back. Escape, submit and click-outside stay
 * plain hides that do not latch.
 */
export interface HotPopOptions {
  /** The panel, or null when the page has none. */
  panel: HTMLElement | null;
  input: HTMLInputElement;
  /** False when there is no keyword data, so the panel never opens. */
  enabled?: boolean;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** How long after the X a focus still counts as the same tap bouncing back. */
  refocusGuardMs?: number;
}

export interface CloseOptions {
  /**
   * Put the caret back in the search box. Keyboard users need this, or hiding
   * the panel drops focus onto the page body.
   */
  restoreFocus?: boolean;
}

export interface HotPopController {
  /** The box gained focus. Opens unless the panel is waiting for the user to return. */
  onFocus(): void;
  /** The box was clicked or tapped. Always reopens. */
  onClickBox(): void;
  /** The box lost focus, so a later focus counts as the user coming back. */
  onBlur(): void;
  /** The X was pressed: hide now and keep it hidden until the user returns. */
  close(options?: CloseOptions): void;
  /** Hide without latching (Escape, submit, click outside). */
  hide(): void;
  isOpen(): boolean;
}

export function createHotPop({
  panel,
  input,
  enabled = true,
  now = Date.now,
  refocusGuardMs = 300,
}: HotPopOptions): HotPopController {
  // The X was used and the user has not come back to the box yet.
  let latched = false;
  // The X was used while the box kept focus, so only a click or a new visit reopens.
  let closedWithFocus = false;
  // Whether the box holds focus, as far as the events we see tell us.
  let boxHasFocus = false;
  // Set only around our own input.focus() call, so it cannot undo the close.
  let closing = false;
  // When the X was last pressed.
  let closedAt = 0;

  function setOpen(open: boolean): void {
    if (panel) panel.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function onFocus(): void {
    const keptFocus = boxHasFocus;
    boxHasFocus = true;
    if (!enabled || closing) return;
    if (latched) {
      // Same tap coming back: either the box never lost focus, or the phone
      // refocused it right after the X.
      if ((closedWithFocus && keptFocus) || now() - closedAt <= refocusGuardMs) return;
    }
    latched = false;
    closedWithFocus = false;
    setOpen(true);
  }

  function onClickBox(): void {
    boxHasFocus = true;
    if (!enabled) return;
    latched = false;
    closedWithFocus = false;
    setOpen(true);
  }

  function onBlur(): void {
    boxHasFocus = false;
    // The box was left, so the next focus is a genuine return.
    closedWithFocus = false;
  }

  function close({ restoreFocus = true }: CloseOptions = {}): void {
    const wasOpen = panel === null || !panel.hidden;
    setOpen(false);
    // Nothing was showing: do not latch, or the next focus would be swallowed.
    if (!wasOpen) return;
    latched = true;
    closedWithFocus = boxHasFocus;
    closedAt = now();
    if (!restoreFocus) return;
    closing = true;
    try {
      input.focus({ preventScroll: true });
    } finally {
      closing = false;
    }
    boxHasFocus = true;
    closedWithFocus = true;
  }

  function hide(): void {
    setOpen(false);
  }

  // The markup ships hidden with aria-expanded="false"; keep both in sync from the start.
  setOpen(false);

  return { onFocus, onClickBox, onBlur, close, hide, isOpen: () => panel !== null && !panel.hidden };
}

/**
 * Wire the panel's X to the controller. `click` covers mouse, touch and keyboard.
 * Cancelling `mousedown` leaves the caret in the search box on a mouse click, so
 * closing the panel does not also slam the phone keyboard shut.
 */
export function bindHotPopClose(button: HTMLButtonElement, pop: HotPopController): void {
  button.type = "button";
  button.addEventListener("mousedown", (event: MouseEvent) => event.preventDefault());
  button.addEventListener("click", (event: MouseEvent) => {
    // detail 0 means Enter or Space on the button, where no mousedown happened.
    pop.close({ restoreFocus: event.detail === 0 });
  });
}
