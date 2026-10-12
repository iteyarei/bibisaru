export const onRequestGet: PagesFunction = async (context) => {
  const origin = new URL(context.request.url).origin;
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
