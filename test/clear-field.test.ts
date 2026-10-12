import { describe, expect, it } from "vitest";
import { messages } from "../shared/i18n";
import { bindClearButton, showsClearButton } from "../src/clear-field";

describe("showsClearButton", () => {
  it("stays hidden until the field has text", () => {
    expect(showsClearButton("")).toBe(false);
    expect(showsClearButton("鬼武者")).toBe(true);
    expect(showsClearButton(" ")).toBe(true);
  });
});

describe("bindClearButton", () => {
  function harness(value = "") {
    const inputListeners = new Map<string, Array<() => void>>();
    const clicks: Array<() => void> = [];
    let searched = false;
    const field = {
      value,
      focused: false,
      focus() {
        this.focused = true;
      },
      addEventListener(type: string, listener: () => void) {
        const list = inputListeners.get(type) ?? [];
        list.push(listener);
        inputListeners.set(type, list);
      },
      emit(type: string) {
        for (const listener of inputListeners.get(type) ?? []) listener();
      },
    };
    const button = {
      hidden: false,
      type: "submit",
      label: "",
      setAttribute(name: string, next: string) {
        if (name === "aria-label") this.label = next;
      },
      addEventListener(type: string, listener: () => void) {
        if (type === "click") clicks.push(listener);
      },
      click() {
        for (const listener of clicks) listener();
      },
    };
    const sync = bindClearButton(
      field as unknown as HTMLInputElement,
      button as unknown as HTMLButtonElement,
    );
    return {
      field,
      button,
      sync,
      searched: () => searched,
    };
  }

  it("shows the button only while there is text, and labels it 清除", () => {
    const { field, button } = harness("");
    expect(button.hidden).toBe(true);
    expect(button.type).toBe("button");
    expect(button.label).toBe("清除");
    expect(messages.clear).toBe("清除");

    field.value = "耳機";
    field.emit("input");
    expect(button.hidden).toBe(false);
    expect(field.focused).toBe(false);

    field.value = "";
    field.emit("input");
    expect(button.hidden).toBe(true);
  });

  it("clears the text, returns focus, and does not search", () => {
    const { field, button, searched } = harness("鬼武者 ns2");
    expect(button.hidden).toBe(false);

    button.click();

    expect(field.value).toBe("");
    expect(field.focused).toBe(true);
    expect(button.hidden).toBe(true);
    expect(searched()).toBe(false);
  });
});
