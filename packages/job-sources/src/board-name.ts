/** Employer display identity from agreeing metadata on supported live board roots.
 * Tenant identifiers and historical titles are never invented employer names. */
import { feedFromUrl } from './directory';
import { plain } from './index';
export function publicBoardName(html: string, page: string): string | null {
  const feed = feedFromUrl(page);
  if (
    !feed ||
    new URL(page).pathname.replace(/\/$/, '') !== `/${feed.tenant}` ||
    html.length > 2_000_000
  )
    return null;
  const title = plain(/<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '');
  let og = '';
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map((m) => [
        m[1]!.toLowerCase(),
        m[3]!,
      ]),
    );
    if (attrs.property?.toLowerCase() === 'og:title') og = plain(attrs.content ?? '');
  }
  let name = '';
  if (feed.ats === 'lever' && og === `${title} jobs`) name = title;
  if (feed.ats === 'ashby' && title === og && /^Jobs at /i.test(title)) name = title.slice(8);
  return name &&
    name.length <= 200 &&
    !/^(?:lever|ashby|greenhouse|smartrecruiters|jobs?|careers?|not found|error|page not found)$/i.test(
      name,
    )
    ? name
    : null;
}
