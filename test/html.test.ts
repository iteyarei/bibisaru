import { describe, expect, it } from "vitest";
import { escapeHtml, escapeXml, safeUrl, scriptJson } from "../shared/html";

describe("escapeHtml", () => {
  it("escapes the five characters that break markup", () => {
    expect(escapeHtml(`<img src=x onerror="alert('hi')"> & more`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot;&gt; &amp; more",
    );
  });

  it("leaves ordinary Chinese text alone", () => {
    expect(escapeHtml("除濕機 12L 特價")).toBe("除濕機 12L 特價");
  });
});

describe("escapeXml", () => {
  it("escapes the same characters plus apostrophes", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  });
});

describe("safeUrl", () => {
  it("keeps http and https links", () => {
    expect(safeUrl("https://www.momoshop.com.tw/goods/x")).toBe("https://www.momoshop.com.tw/goods/x");
    expect(safeUrl(" http://a.example/x ")).toBe("http://a.example/x");
  });

  it("rejects javascript:, data: and junk", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("//evil.example/x")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
});

describe("scriptJson", () => {
  it("cannot close the script element", () => {
    expect(scriptJson({ a: "</script><b>" })).toBe('{"a":"\\u003c/script>\\u003cb>"}');
  });
});
