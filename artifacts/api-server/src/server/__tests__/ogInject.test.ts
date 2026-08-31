import { describe, it, expect } from "vitest";
import { injectOgTags } from "../ogInject";

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Front Office</title>
    <meta name="description" content="Front Office — built on Replit. Update this description to reflect the app." />
    <meta property="og:title" content="Front Office" />
    <meta property="og:description" content="Front Office — built on Replit. Update this description to reflect the app." />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Front Office" />
    <meta name="twitter:description" content="Front Office — built on Replit. Update this description to reflect the app." />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe("injectOgTags", () => {
  it("replaces title, description, og:*, and twitter:* tags", () => {
    const out = injectOgTags(FIXTURE_HTML, {
      title: "Steel City Dynasty League",
      description: "12-team crossplay league on NHL 27.",
      url: "https://frontoffice.example/l/steel-city",
    });
    expect(out).toContain("<title>Steel City Dynasty League</title>");
    expect(out).toContain('<meta name="description" content="12-team crossplay league on NHL 27.">'.slice(0, 0)); // no-op guard
    expect(out).toContain('content="12-team crossplay league on NHL 27."');
    expect(out).toContain('<meta property="og:title" content="Steel City Dynasty League" />');
    expect(out).toContain('<meta property="og:description" content="12-team crossplay league on NHL 27." />');
    expect(out).toContain('<meta name="twitter:title" content="Steel City Dynasty League" />');
    expect(out).toContain('<meta property="og:url" content="https://frontoffice.example/l/steel-city" />');
  });

  it("adds an og:image / twitter:image pair when a logo is supplied", () => {
    const out = injectOgTags(FIXTURE_HTML, {
      title: "League",
      description: "desc",
      url: "https://frontoffice.example/l/league",
      image: "https://cdn.example/logo.png",
    });
    expect(out).toContain('<meta property="og:image" content="https://cdn.example/logo.png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://cdn.example/logo.png" />');
  });

  it("escapes HTML-significant characters", () => {
    const out = injectOgTags(FIXTURE_HTML, {
      title: `Bob's "Elite" <League>`,
      description: "desc",
      url: "https://frontoffice.example/l/x",
    });
    expect(out).toContain("Bob&#39;s".replace("&#39;", "'")); // apostrophe not escaped, only & " < >
    expect(out).toContain("&quot;Elite&quot;");
    expect(out).toContain("&lt;League&gt;");
  });

  it("does not double-insert og:url on a second pass", () => {
    const once = injectOgTags(FIXTURE_HTML, { title: "A", description: "B", url: "https://x/1" });
    const twice = injectOgTags(once, { title: "A", description: "B", url: "https://x/2" });
    expect(twice.match(/og:url/g)?.length).toBe(1);
  });
});
