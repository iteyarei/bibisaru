import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import mainTs from "../src/main.ts?raw";
import { messages } from "../shared/i18n";
import {
  bindHotChipLoading,
  CHIP_LOADING_CLASS,
  createHotLoading,
  hotChipOf,
  HOT_CHIP_SELECTOR,
  HOT_LOADING_SAFETY_MS,
  loadingMessage,
  startsNavigation,
  type HotChip,
  type HotTimer,
} from "../src/hot-loading";

/** Vite sends a `?raw` CSS import through its CSS pipeline, so read the file itself. */
const stylesCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

/** Just enough anchor for the controller: a class list and attributes. */
function chip(label: string): HotChip & { classes: Set<string>; attrs: Map<string, string> } {
  const classes = new Set<string>(["hot-chip"]);
  const attrs = new Map<string, string>();
  return {
    textContent: label,
    classes,
    attrs,
    classList: {
      add: (name) => {
        classes.add(name);
      },
      remove: (name) => {
        classes.delete(name);
      },
    },
    setAttribute: (name, value) => {
      attrs.set(name, value);
    },
    removeAttribute: (name) => {
      attrs.delete(name);
    },
  };
}

/** The only parts of the status <p> the controller touches. */
function statusLine(): HTMLElement & { hidden: boolean; textContent: string } {
  return { hidden: true, textContent: "" } as unknown as HTMLElement & { hidden: boolean; textContent: string };
}

/** A DOM stub for the delegated listener: only closest() is used. */
function clickable(chipNode: HotChip | null) {
  return {
    closest(selector: string) {
      return selector === HOT_CHIP_SELECTOR ? chipNode : null;
    },
  };
}

function clickEvent(target: unknown, over: Record<string, unknown> = {}) {
  return { target, button: 0, defaultPrevented: false, ...over } as unknown as MouseEvent;
}

describe("hot chip loading", () => {
  it("marks the tapped chip and prints the waiting line", () => {
    const status = statusLine();
    const controller = createHotLoading({ status });
    const node = chip("除濕機");
    controller.start(node, "除濕機");

    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(true);
    // A screen reader is told the tap was heard.
    expect(node.attrs.get("aria-busy")).toBe("true");
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("正在取得「除濕機」的比價資料…");
  });

  it("moves the mark when another chip is tapped", () => {
    const status = statusLine();
    const controller = createHotLoading({ status });
    const first = chip("除濕機");
    const second = chip("洗碗機");
    controller.start(first, "除濕機");
    controller.start(second, "洗碗機");

    expect(first.classes.has(CHIP_LOADING_CLASS)).toBe(false);
    expect(first.attrs.has("aria-busy")).toBe(false);
    expect(second.classes.has(CHIP_LOADING_CLASS)).toBe(true);
    expect(status.textContent).toBe("正在取得「洗碗機」的比價資料…");
  });

  it("clears everything on reset, so coming back never leaves a spinner", () => {
    const status = statusLine();
    const controller = createHotLoading({ status });
    const node = chip("除濕機");
    controller.start(node, "除濕機");
    expect(controller.isLoading()).toBe(true);

    controller.reset();
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(false);
    expect(node.attrs.has("aria-busy")).toBe(false);
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(controller.isLoading()).toBe(false);
  });

  it("survives a page with no status line", () => {
    const controller = createHotLoading({ status: null });
    const node = chip("除濕機");
    expect(() => controller.start(node, "除濕機")).not.toThrow();
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(true);
    expect(() => controller.reset()).not.toThrow();
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(false);
  });

  it("falls back to the generic line for a chip with no keyword", () => {
    expect(loadingMessage("")).toBe(messages.hotLoadingGeneric);
    expect(loadingMessage("  ")).toBe(messages.hotLoadingGeneric);
    expect(loadingMessage(" 除濕機 ")).toBe("正在取得「除濕機」的比價資料…");
    expect(messages.hotLoadingGeneric).toBe("正在取得比價資料…");
  });
});

describe("which clicks deserve feedback", () => {
  it("treats a plain left click as a navigation", () => {
    expect(startsNavigation({ button: 0 })).toBe(true);
    expect(startsNavigation({})).toBe(true);
  });

  it("ignores clicks that open another tab and leave this page alone", () => {
    expect(startsNavigation({ button: 1 })).toBe(false);
    expect(startsNavigation({ button: 0, metaKey: true })).toBe(false);
    expect(startsNavigation({ button: 0, ctrlKey: true })).toBe(false);
    expect(startsNavigation({ button: 0, shiftKey: true })).toBe(false);
    expect(startsNavigation({ button: 0, altKey: true })).toBe(false);
    expect(startsNavigation({ button: 0, defaultPrevented: true })).toBe(false);
  });

  it("only reacts to taps that landed on a chip", () => {
    const node = chip("除濕機");
    expect(hotChipOf(clickable(node))).toBe(node);
    expect(hotChipOf(clickable(null))).toBeNull();
    expect(hotChipOf(null)).toBeNull();
    expect(hotChipOf({})).toBeNull();
  });
});

/** Timers the controller arms, fired by hand so no test waits. */
function fakeTimer() {
  let nextId = 1;
  const pending = new Map<number, { ms: number; callback: () => void }>();
  const delays: number[] = [];
  const timer: HotTimer = {
    set(callback, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { ms, callback });
      delays.push(ms);
      return id;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  function fireWhere(match: (ms: number) => boolean) {
    for (const [id, entry] of [...pending]) {
      if (!match(entry.ms)) continue;
      pending.delete(id);
      entry.callback();
    }
  }
  return {
    timer,
    armedWith: () => delays,
    pending: () => pending.size,
    /** Fire only the timers armed with this delay. */
    fire(ms: number) {
      fireWhere((delay) => delay === ms);
    },
    /** How many live timers were armed with this delay. */
    live(ms: number) {
      return [...pending.values()].filter((entry) => entry.ms === ms).length;
    },
  };
}

describe("bindHotChipLoading", () => {
  function harness() {
    const listeners = new Map<string, Array<(event: MouseEvent) => void>>();
    const nodes: HotChip[] = [];
    const root = {
      addEventListener(type: string, listener: (event: MouseEvent) => void) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
    };
    const pageEvents: Array<(event?: { persisted?: boolean }) => void> = [];
    const status = statusLine();
    const clock = fakeTimer();
    let panelHides = 0;
    const controller = bindHotChipLoading({
      root: root as unknown as HTMLElement,
      status,
      hidePanel: () => {
        panelHides += 1;
      },
      events: {
        addEventListener: (type: string, listener: (event?: { persisted?: boolean }) => void) =>
          type === "pageshow" && pageEvents.push(listener),
      },
      timer: clock.timer,
    });
    return {
      controller,
      status,
      nodes,
      clock,
      panelHides: () => panelHides,
      click(target: unknown, over: Record<string, unknown> = {}) {
        for (const listener of listeners.get("click") ?? []) listener(clickEvent(target, over));
      },
      /** `persisted: true` is a back/forward cache restore; false is a first load. */
      pageShow(persisted?: boolean) {
        for (const listener of pageEvents) listener({ persisted });
      },
    };
  }

  it("reacts inside the click itself, before the browser navigates", () => {
    const h = harness();
    const node = chip("除濕機");
    h.click(clickable(node));
    // Synchronous: no awaits, no requestAnimationFrame. This is the whole point.
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(true);
    expect(h.status.hidden).toBe(false);
    expect(h.status.textContent).toContain("除濕機");
  });

  it("closes the panel a tick later, never during the click itself", () => {
    const h = harness();
    h.click(clickable(chip("除濕機")));
    // Hiding the link's ancestor mid-dispatch can swallow the navigation.
    expect(h.panelHides()).toBe(0);
    h.clock.fire(0);
    expect(h.panelHides()).toBe(1);
  });

  it("clears the spinner when the reader comes back", () => {
    const h = harness();
    const node = chip("除濕機");
    h.click(clickable(node));
    h.pageShow();
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(false);
    expect(h.status.hidden).toBe(true);
  });

  it("does nothing for a click on the panel that is not a chip", () => {
    const h = harness();
    h.click(clickable(null));
    expect(h.status.hidden).toBe(true);
    expect(h.clock.pending()).toBe(0);
    expect(h.panelHides()).toBe(0);
  });

  it("does nothing when a modified click opens a new tab", () => {
    const h = harness();
    const node = chip("除濕機");
    h.click(clickable(node), { metaKey: true });
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(false);
    expect(h.status.hidden).toBe(true);
  });

  it("does nothing on a middle click", () => {
    const h = harness();
    const node = chip("除濕機");
    h.click(clickable(node), { button: 1 });
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(false);
  });

  it("puts the line away on its own if the page never leaves", () => {
    const h = harness();
    const node = chip("除濕機");
    h.click(clickable(node));
    expect(h.clock.armedWith()).toContain(HOT_LOADING_SAFETY_MS);

    // A cancelled navigation: the reader is still here, so the spinner must go.
    h.clock.fire(HOT_LOADING_SAFETY_MS);
    expect(node.classes.has(CHIP_LOADING_CLASS)).toBe(false);
    expect(h.status.hidden).toBe(true);
    expect(h.clock.pending()).toBe(0);
  });

  it("keeps one safety timer, not one per tap", () => {
    const h = harness();
    h.click(clickable(chip("除濕機")));
    h.click(clickable(chip("洗碗機")));
    expect(h.clock.live(HOT_LOADING_SAFETY_MS)).toBe(1);
  });

  it("disarms every timer once the reader comes back", () => {
    const h = harness();
    h.click(clickable(chip("除濕機")));
    h.pageShow();
    expect(h.clock.pending()).toBe(0);
  });

  it("finishes closing the panel when the page comes back from the cache", () => {
    const h = harness();
    h.click(clickable(chip("除濕機")));
    // The page left before the deferred hide could run.
    h.pageShow(true);
    expect(h.panelHides()).toBe(1);
  });

  it("leaves the panel alone on a first load", () => {
    const h = harness();
    h.pageShow(false);
    expect(h.panelHides()).toBe(0);
    expect(h.status.hidden).toBe(true);
  });

  it("works on a page with no chip container", () => {
    const status = statusLine();
    expect(() => bindHotChipLoading({ root: null, status, events: null })).not.toThrow();
  });
});

describe("the shipped page carries the waiting line", () => {
  it("ships a polite live region outside the panel, so the panel can close over it", () => {
    expect(indexHtml).toMatch(/<p class="hot-status" id="hot-status" role="status" aria-live="polite" hidden><\/p>/);
    // After the panel's closing tags: the line is not inside the popover.
    const pop = indexHtml.indexOf('<div class="hot-pop" id="hot-pop"');
    expect(pop).toBeGreaterThan(-1);
    expect(indexHtml.indexOf('id="hot-status"')).toBeGreaterThan(indexHtml.indexOf('id="hot-groups"'));
  });

  it("is wired in main.ts", () => {
    expect(mainTs).toContain('document.querySelector<HTMLElement>("#hot-status")');
    expect(mainTs).toMatch(/bindHotChipLoading\(\{/);
    expect(mainTs).toMatch(/hidePanel: hideHotPop/);
  });

  it("keeps the panel title untouched", () => {
    expect(indexHtml).toMatch(/🔥<\/span> 熱門搜尋商品 <span aria-hidden="true">🔥/);
  });

  it("spins only when the reader has not asked for less motion", () => {
    const start = stylesCss.indexOf(".hot-status {");
    const end = stylesCss.indexOf("@keyframes hot-spin");
    const block = stylesCss.slice(start, end);
    // The spinner and its animation sit inside the no-preference query ...
    expect(block).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[^}]*\.hot-status::before \{[^}]*animation: hot-spin/);
    // ... so a reduced-motion reader gets no spinner at all, only the text.
    expect(stylesCss.slice(0, start)).not.toContain(".hot-status::before");
    expect(stylesCss).toContain(".hot-status[hidden] { display: none; }");
  });
});
