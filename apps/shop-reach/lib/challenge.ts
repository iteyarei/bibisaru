/** Same check as `looksLikeChallenge` in the shop fetcher. A matching page is not a product list. */
export function challengePage(html: string): boolean {
  return /captcha|challenge|verify you are|are you a robot|access denied|請稍後再試|異常流量/i.test(html.slice(0, 200_000));
}
