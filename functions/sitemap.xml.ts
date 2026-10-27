import { buildSitemap } from "../shared/sitemap";

export const onRequestGet: PagesFunction = async (context) => {
  const body = buildSitemap(new URL(context.request.url).origin);
  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
