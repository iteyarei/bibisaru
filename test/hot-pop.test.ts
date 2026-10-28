import { describe, expect, it } from "vitest";
import mainTs from "../src/main.ts?raw";
import indexHtml from "../index.html?raw";
import { bindHotPopClose, createHotPop } from "../src/hot-pop";

function harness(options: { enabled?: boolean; start?: number } = {}) {
  let clock = options.start ?? 1_000;
  const panel = { hidden: true };
  const attrs = new Map<string, string>();
  let focusCalls = 0;
  const input = {
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    focus() {
      focusCalls += 1;
      // Browsers fire focus right away; the controller must not reopen on it.
      pop.onFocus();
    },
  };
  const pop = createHotPop({
    panel: panel as unknown as HTMLElement,
    input: input as unknown as HTMLInputElement,
    enabled: options.enabled,
    now: () => clock,
  });
  return {
    panel,
    pop,
    expanded: () => attrs.get("aria-expanded"),
    focusCalls: () => focusCalls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function buttonStub() {
  const clicks: Array<(event: MouseEvent) => void> = [];
  const downs: Array<(event: MouseEvent) => void> = [];
  let prevented = 0;
  return {
    type: "submit",
    addEventListener(type: string, listener: (event: MouseEvent) => void) {
      if (type === "click") clicks.push(listener);
      if (type === "mousedown") downs.push(listener);
    },
    /** detail 1 = mouse or touch, detail 0 = Enter or Space. */
    click(detail = 1) {
      for (const listener of clicks) listener({ detail } as MouseEvent);
    },
    down() {
      for (const listener of downs) listener({ preventDefault: () => (prevented += 1) } as unknown as MouseEvent);
    },
    prevented: () => prevented,
  };
}

describe("hot popover close button", () => {
  it("sits inside the panel as a real button with a label", () => {
    const form = indexHtml.slice(
      indexHtml.indexOf('<form id="search-form"'),
      indexHtml.indexOf("</form>", indexHtml.indexOf('<form id="search-form"')),
    );
    const panel = form.slice(form.indexOf('<div class="hot-pop" id="hot-pop"'), form.indexOf('id="hot-groups"'));
    expect(panel).toMatch(/<button type="button" class="hot-pop-close" id="hot-pop-close" aria-label="關閉熱門搜尋">/);
    expect(panel).toContain("<svg");
    // The X comes before the title so the tab order reaches it before the chips.
    expect(panel.indexOf('id="hot-pop-close"')).toBeLessThan(panel.indexOf('class="hot-pop-title"'));
    // Title copy is unchanged; its red bold base+2px look lives in the stylesheet.
    expect(panel).toMatch(/🔥<\/span> 熱門搜尋商品 <span aria-hidden="true">🔥/);
  });

  it("is wired in main.ts and hides the panel when pressed", () => {
    expect(mainTs).toContain('document.querySelector<HTMLButtonElement>("#hot-pop-close")');
    expect(mainTs).toMatch(/bindHotPopClose\(hotPopClose, hotPop\)/);

    const h = harness();
    const button = buttonStub();
    bindHotPopClose(button as unknown as HTMLButtonElement, h.pop);
    expect(button.type).toBe("button");

    h.pop.onFocus();
    expect(h.panel.hidden).toBe(false);
    expect(h.expanded()).toBe("true");

    button.click();
    expect(h.panel.hidden).toBe(true);
    expect(h.expanded()).toBe("false");
    // A tap leaves the caret where it was, so the phone keyboard stays away.
    expect(h.focusCalls()).toBe(0);
    expect(h.panel.hidden).toBe(true);
  });

  it("ignores a focus right after the tap that closed it", () => {
    const h = harness();
    h.pop.onFocus();
    // A phone blurs the field as the X is tapped, then refocuses it at once.
    h.pop.close({ restoreFocus: false });
    h.pop.onBlur();
    h.advance(50);
    h.pop.onFocus();
    expect(h.pop.isOpen()).toBe(false);
  });

  it("keeps the caret in the box on mousedown so the keyboard does not close", () => {
    const h = harness();
    const button = buttonStub();
    bindHotPopClose(button as unknown as HTMLButtonElement, h.pop);
    button.down();
    expect(button.prevented()).toBe(1);
  });

  it("stays shut while the box keeps focus, and returns on a new visit", () => {
    const h = harness();
    h.pop.onFocus();
    h.pop.close({ restoreFocus: false });
    expect(h.pop.isOpen()).toBe(false);

    // Phones firing more focus events on a box that never blurred: still shut.
    h.pop.onFocus();
    h.pop.onFocus();
    expect(h.pop.isOpen()).toBe(false);

    // Leaving the box and coming back is a new visit, once the tap is over.
    h.advance(1_000);
    h.pop.onBlur();
    h.pop.onFocus();
    expect(h.pop.isOpen()).toBe(true);
  });

  it("returns the caret to the box for a keyboard press without reopening", () => {
    const h = harness();
    h.pop.onFocus();
    h.pop.close({ restoreFocus: true });
    expect(h.pop.isOpen()).toBe(false);
    // focus() fired onFocus, which must not reopen the panel it just closed.
    expect(h.focusCalls()).toBe(1);
    expect(h.pop.isOpen()).toBe(false);
  });

  it("reopens on a click on the box right after closing", () => {
    const h = harness();
    h.pop.onFocus();
    h.pop.close({ restoreFocus: false });
    expect(h.pop.isOpen()).toBe(false);

    h.pop.onClickBox();
    expect(h.pop.isOpen()).toBe(true);
    expect(h.expanded()).toBe("true");
  });

  it("leaves Escape and click-outside as plain hides", () => {
    const h = harness();
    h.pop.onFocus();
    h.pop.hide();
    expect(h.pop.isOpen()).toBe(false);
    expect(h.expanded()).toBe("false");

    // hide() does not latch, so the next focus is a normal open.
    h.pop.onFocus();
    expect(h.pop.isOpen()).toBe(true);
  });

  it("does not latch when the panel is already shut", () => {
    const h = harness();
    h.pop.hide();
    h.pop.close({ restoreFocus: false });
    // A close that had nothing to close must not swallow the next focus.
    h.pop.onFocus();
    expect(h.pop.isOpen()).toBe(true);
  });

  it("never opens without keyword data", () => {
    const h = harness({ enabled: false });
    h.pop.onFocus();
    h.pop.onClickBox();
    expect(h.pop.isOpen()).toBe(false);
    expect(h.expanded()).toBe("false");
  });
});
