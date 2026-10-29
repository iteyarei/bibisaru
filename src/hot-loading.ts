import { fill, messages } from "../shared/i18n";

/**
 * Loading feedback for the 「熱門搜尋商品」 chips.
 *
 * A chip is a real link to /k/<slug>/, which is server rendered and can take a
 * second or two. On a phone that looks exactly like a dead button: nothing
 * happens, and the reader taps again. So the moment a chip is tapped we mark
 * that chip and print a line saying the prices are being fetched. Both happen
 * synchronously inside the click handler, before the browser starts the
 * navigation, because anything asynchronous would lose the race with it.
 *
 * The one thing that is deliberately *not* synchronous is closing the panel:
 * hiding the link's ancestor mid-dispatch can swallow the navigation itself.
 * It goes one tick later, which nobody can see. A safety timer takes the line
 * down if the tap somehow never leads anywhere, and a back/forward cache
 * restore clears it too, so no reader is ever left watching a spinner.
 */

export const HOT_CHIP_SELECTOR = ".hot-chip";
export const CHIP_LOADING_CLASS = "is-loading";

/** The bits of an anchor we touch. Deliberately narrow so tests need no DOM. */
export interface HotChip {
  classList: { add(name: string): void; remove(name: string): void };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  textContent?: string | null;
}

/** The bits of a click we read. */
export interface ClickLike {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
}

/**
 * Whether this click will actually navigate this tab. A middle click or a
 * modifier click opens a new tab and leaves this page alone, so it must not
 * leave the chip spinning forever.
 */
export function startsNavigation(event: ClickLike): boolean {
  if (event.defaultPrevented) return false;
  if ((event.button ?? 0) !== 0) return false;
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The chip a click landed on, or null when it landed somewhere else. */
export function hotChipOf(target: unknown): HotChip | null {
  const node = target as { closest?: (selector: string) => unknown } | null | undefined;
  if (!node || typeof node.closest !== "function") return null;
  return (node.closest(HOT_CHIP_SELECTOR) as HotChip | null) ?? null;
}

/** The line shown while the landing page is on its way. */
export function loadingMessage(keyword: string): string {
  const word = keyword.trim();
  return word ? fill(messages.hotLoading, { word }) : messages.hotLoadingGeneric;
}

export interface HotLoadingController {
  /** Mark one chip as loading and show the line. Safe to call more than once. */
  start(chip: HotChip | null, keyword?: string): void;
  /** Drop every loading mark. Used when the reader comes back (bfcache, back). */
  reset(): void;
  isLoading(): boolean;
}

export interface HotLoadingOptions {
  /** The line that says the prices are being fetched. */
  status: HTMLElement | null;
}

export function createHotLoading({ status }: HotLoadingOptions): HotLoadingController {
  // Every chip currently marked, so reset() can clear one this controller
  // marked earlier even if the reader tapped around in between.
  const marked = new Set<HotChip>();

  function start(chip: HotChip | null, keyword?: string): void {
    for (const previous of marked) {
      previous.classList.remove(CHIP_LOADING_CLASS);
      previous.removeAttribute("aria-busy");
    }
    marked.clear();
    if (chip) {
      chip.classList.add(CHIP_LOADING_CLASS);
      // aria-busy tells a screen reader the tap was heard, and that the page
      // is about to be replaced.
      chip.setAttribute("aria-busy", "true");
      marked.add(chip);
    }
    if (!status) return;
    // Unhide first, then write the text, so the live region announces it.
    status.hidden = false;
    status.textContent = loadingMessage(keyword ?? "");
  }

  function reset(): void {
    for (const chip of marked) {
      chip.classList.remove(CHIP_LOADING_CLASS);
      chip.removeAttribute("aria-busy");
    }
    marked.clear();
    if (!status) return;
    status.hidden = true;
    status.textContent = "";
  }

  return { start, reset, isLoading: () => marked.size > 0 };
}

/** The only part of a pageshow event we read. */
export interface PageShowLike {
  /** True when the page came back from the back/forward cache. */
  persisted?: boolean;
}

/** Timer hooks, so the safety net can be tested without really waiting. */
export interface HotTimer {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimer: HotTimer = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * How long the spinner may stay up without the page going away. A tap that the
 * browser cancels (a dropped gesture, an extension eating the click) would
 * otherwise leave the chip spinning forever, and a reader staring at a dead
 * line is worse than one with no line at all.
 */
export const HOT_LOADING_SAFETY_MS = 15_000;

export interface HotLoadingBindings {
  /** Container the chips live in, normally #hot-groups. */
  root: HTMLElement | null;
  /** The status line, normally #hot-status. */
  status: HTMLElement | null;
  /**
   * Closes the keyword panel. The panel is absolutely positioned right under
   * the search box and would cover the status line on a phone, so it steps
   * aside once a keyword has been chosen.
   */
  hidePanel?: () => void;
  /** Where pageshow is listened for. Defaults to window; injectable for tests. */
  events?: { addEventListener(type: string, listener: (event?: PageShowLike) => void): void } | null;
  /** Replaced in tests only. */
  timer?: HotTimer;
  /** Replaced in tests only. */
  safetyMs?: number;
}

/**
 * Delegated click listener on the chip container, plus the pageshow that
 * clears the spinner once the reader comes back from the landing page.
 * `click` covers mouse, touch and Enter on a link, so all three get feedback.
 */
export function bindHotChipLoading({
  root,
  status,
  hidePanel,
  events = typeof window === "undefined" ? null : window,
  timer = realTimer,
  safetyMs = HOT_LOADING_SAFETY_MS,
}: HotLoadingBindings): HotLoadingController {
  const controller = createHotLoading({ status });
  // Armed on every tap and disarmed on a reset, so at most one is ever live.
  let safety: unknown = null;
  let pendingHide: unknown = null;

  function disarm(): void {
    if (safety !== null) {
      timer.clear(safety);
      safety = null;
    }
    if (pendingHide !== null) {
      timer.clear(pendingHide);
      pendingHide = null;
    }
  }

  function start(chip: HotChip, keyword: string): void {
    controller.start(chip, keyword);
    disarm();
    if (safetyMs > 0) {
      safety = timer.set(() => {
        safety = null;
        disarm();
        controller.reset();
      }, safetyMs);
    }
    if (!hidePanel) return;
    // The panel is closed on the next tick rather than inside the click itself:
    // hiding the link's ancestor while its click is being dispatched can swallow
    // the navigation on some phone browsers. A tick later is still invisible.
    pendingHide = timer.set(() => {
      pendingHide = null;
      hidePanel();
    }, 0);
  }

  root?.addEventListener("click", (event: MouseEvent) => {
    if (!startsNavigation(event)) return;
    const chip = hotChipOf(event.target);
    if (!chip) return;
    start(chip, chip.textContent ?? "");
  });

  events?.addEventListener("pageshow", (event) => {
    disarm();
    controller.reset();
    // A page restored from the back/forward cache comes back exactly as it was
    // left, panel and all. The panel was on its way out when the reader left,
    // so finish that job: a reopened panel over a cleared waiting line is a
    // puzzle. A first load has nothing to finish, so it is left alone.
    if (event?.persisted !== false) hidePanel?.();
  });

  return controller;
}
