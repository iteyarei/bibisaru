import { fill, formatPrice, messages } from "../shared/i18n";
import { platformById } from "../shared/platforms";
import type { PlatformReport, Product } from "../shared/types";

const OUTBOUND_REL = "noopener nofollow sponsored";

export interface ShownProduct extends Product {
  lowest: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function outbound(href: string, className: string, text: string): HTMLAnchorElement {
  const link = el("a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = OUTBOUND_REL;
  return link;
}

export function renderNotices(root: HTMLElement, notices: readonly PlatformReport[]): void {
  root.replaceChildren();
  for (const notice of notices) {
    const platform = platformById(notice.id);
    const card = el("div", "notice");
    card.style.setProperty("--c", platform.color);
    const dot = el("i", "dot");
    const text = el(
      "p",
      undefined,
      fill(notice.status === "empty" ? messages.platformEmpty : messages.unavailable, { name: platform.name }),
    );
    const link = outbound(notice.searchUrl, "", `${messages.goSearch} ↗`);
    card.append(dot, text, link);
    root.append(card);
  }
}

export function renderStage(
  root: HTMLElement,
  view: {
    loading: boolean;
    error: string | null;
    searched: boolean;
    products: readonly ShownProduct[];
    filtersHidResults: boolean;
    nothingFetched: boolean;
    onReset: () => void;
  },
): void {
  root.replaceChildren();
  root.setAttribute("aria-busy", view.loading ? "true" : "false");

  if (view.loading) {
    const list = el("div", "results");
    list.setAttribute("aria-label", messages.loading);
    for (let index = 0; index < 4; index += 1) {
      const card = el("div", "sk");
      const lines = el("span");
      lines.append(el("b"), el("b"), el("b"));
      card.append(el("i"), lines);
      list.append(card);
    }
    root.append(list);
    return;
  }

  if (view.error) {
    root.append(el("p", "message", view.error));
    return;
  }

  if (!view.searched) {
    const intro = el("div", "empty");
    const image = el("img");
    image.src = "/mascot.png";
    image.alt = "";
    image.width = 168;
    image.height = 168;
    intro.append(image, el("p", "intro-title", messages.introTitle), el("p", undefined, messages.introBody));
    root.append(intro);
    return;
  }

  if (!view.products.length) {
    const box = el("div", "message");
    const image = el("img");
    image.src = "/mascot.png";
    image.alt = "";
    image.width = 140;
    image.height = 140;
    const copy = el("p", undefined, view.filtersHidResults ? messages.empty : messages.noData);
    const reset = el("button", "reset", messages.reset);
    reset.type = "button";
    reset.addEventListener("click", view.onReset);
    box.append(image, copy, reset);
    root.append(box);
    return;
  }

  const list = el("div", "results");
  for (const product of view.products) list.append(productCard(product));
  root.append(list);
}

function productCard(product: ShownProduct): HTMLAnchorElement {
  const platform = platformById(product.platform);
  const card = outbound(product.url, product.lowest ? "item best" : "item", "");
  card.style.setProperty("--c", platform.color);
  card.setAttribute(
    "aria-label",
    fill(messages.openProduct, {
      lowest: product.lowest ? `${messages.lowestLabel}，` : "",
      name: platform.name,
      title: product.title,
      price: formatPrice(product.price),
    }),
  );

  if (product.image) {
    const image = el("img");
    image.src = product.image;
    image.alt = "";
    image.width = 88;
    image.height = 88;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.replaceWith(el("div", "ph")));
    card.append(image);
  } else {
    card.append(el("div", "ph"));
  }

  const info = el("div", "info");
  if (product.lowest) info.append(el("span", "badge", messages.lowest));
  info.append(el("div", "name", product.title));

  const row = el("div", "row");
  const meta = el("div");
  meta.append(el("div", "price", formatPrice(product.price)), el("span", "tag", platform.name));
  row.append(meta, el("span", "go", `${messages.buy} ↗`));
  info.append(row);
  card.append(info);
  return card;
}
