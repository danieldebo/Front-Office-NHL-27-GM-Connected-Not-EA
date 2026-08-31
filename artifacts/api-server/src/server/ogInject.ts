/**
 * Poor-man's SSR: inject per-league OpenGraph/Twitter tags into the built
 * frontend's index.html shell before serving it, so a link to a public
 * league's page unfurls correctly in Discord/Slack/etc. (those crawlers
 * don't execute JavaScript, so client-side document.title tricks don't
 * satisfy this — the tags have to be in the initial HTML response).
 *
 * Deliberately scoped: this only rewrites the handful of tags
 * front-office/index.html already ships with static placeholder values.
 * It does not attempt full SSR of the React tree — the client still
 * hydrates and takes over exactly as it does today.
 */
export interface OgValues {
  title: string;
  description: string;
  url: string;
  image?: string | null;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function injectOgTags(html: string, values: OgValues): string {
  const title = escapeAttr(values.title);
  const description = escapeAttr(values.description);
  const url = escapeAttr(values.url);

  let out = html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`);

  if (!/<meta property="og:url"/.test(out)) {
    out = out.replace(/<meta property="og:type"[^>]*>/, (m) => `${m}\n    <meta property="og:url" content="${url}" />`);
  } else {
    out = out.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`);
  }

  if (values.image) {
    const image = escapeAttr(values.image);
    if (!/<meta property="og:image"/.test(out)) {
      out = out.replace(/<meta property="og:type"[^>]*>/, (m) => `${m}\n    <meta property="og:image" content="${image}" />`);
    } else {
      out = out.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${image}$2`);
    }
    if (!/<meta name="twitter:image"/.test(out)) {
      out = out.replace(/<meta name="twitter:card"[^>]*>/, (m) => `${m}\n    <meta name="twitter:image" content="${image}" />`);
    }
  }

  return out;
}
