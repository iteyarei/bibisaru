import { fill, formatPrice, messages, unavailableNote } from "../shared/i18n";
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

export function renderNotices(
  root: HTMLElement,
  notices: readonly PlatformReport[],
  colo = "",
  fetchColo = "",
): void {
  root.replaceChildren();
  for (const notice of notices) {
    const platform = platformById(notice.id);
    const card = el("div", "notice");
    card.style.setProperty("--c", platform.color);
    const dot = el("i", "dot");
    const copy = el("div", "copy");
    copy.append(
      el(
        "p",
        undefined,
        fill(notice.status === "empty" ? messages.platformEmpty : messages.unavailable, { name: platform.name }),
      ),
    );
    if (notice.status === "unavailable") {
      const detail = unavailableNote(notice.reason, colo, fetchColo);
      if (detail) copy.append(el("p", "why", detail));
    }
    const link = outbound(notice.searchUrl, "", `${messages.goSearch} ↗`);
    card.append(dot, copy, link);
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
    onSimilar: (title: string) => void;
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
  for (const product of view.products) list.append(productCard(product, view.onSimilar));
  root.append(list);
}

function productCard(product: ShownProduct, onSimilar: (title: string) => void): HTMLElement {
  const platform = platformById(product.platform);
  const card = el("article", product.lowest ? "item best" : "item");
  card.style.setProperty("--c", platform.color);
  const hit = outbound(product.url, "hit", "");
  hit.setAttribute(
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
    hit.append(image);
  } else {
    hit.append(el("div", "ph"));
  }

  const info = el("div", "info");
  if (product.lowest) info.append(el("span", "badge", messages.lowest));
  info.append(el("div", "name", product.title));

  const row = el("div", "row");
  const meta = el("div");
  meta.append(el("div", "price", formatPrice(product.price)), el("span", "tag", platform.name));
  row.append(meta);
  info.append(row);
  hit.append(info);

  const actions = el("div", "actions");
  const buy = outbound(product.url, "go", messages.buy);
  const similar = el("button", "same", messages.similar);
  similar.type = "button";
  similar.addEventListener("click", () => onSimilar(product.title));
  actions.append(buy, similar);
  card.append(hit, actions);
  return card;
}
