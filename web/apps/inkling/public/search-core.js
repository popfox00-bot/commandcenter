// Search logic shared by the Node server (search.js) and the browser
// (GitHub Pages / bring-your-own-key mode). No Node- or DOM-specific APIs here.

export const DEFAULT_MODEL = "claude-opus-5-5";
export const MAX_SKETCHES = 6;
const MAX_CONTINUATIONS = 4;

export const SYSTEM_PROMPT = `You are the engine behind Inkling, a private, freeform search tool. Instead of typing keywords, the user describes what they are looking for with one or more hand-drawn sketches and/or free text.

Your job:
1. Interpret the sketches and text together. Sketches are rough, made with a mouse or finger — read them for intent (shapes, proportions, distinctive features, arrangement), not artistic quality. Highlighter strokes usually mark the features the user cares most about. When several sketches are given, they usually show different features or views of the SAME thing; combine them. Each sketch may carry its own caption.
2. Decide what kind of thing is being searched for: a product, a movie/show/book/game (e.g. a drawn scene plus a plot description), a place, a person, an artwork, a plant/animal, a logo, etc.
3. Use web search to find real candidates that match. Search several angles (distinctive features, likely names, retailers, databases like IMDb/Wikipedia) and verify promising candidates before recommending them.
4. Rank the best matches by how well they fit the described features.

When you are done searching, reply with ONLY a JSON object in a \`\`\`json fenced block, with this shape:
{
  "interpretation": "One or two sentences describing what you understood the user is looking for.",
  "category": "product | movie | tv | book | game | music | place | person | art | nature | other",
  "features": ["key feature you identified", "..."],
  "queries": ["search query you used", "..."],
  "results": [
    {
      "title": "Name of the matching item",
      "url": "https://best page for this item (product page, IMDb page, etc.)",
      "image_url": "https://direct image URL if you saw one in the results, else null",
      "snippet": "Short description of the item.",
      "why": "Why it matches the sketches/text, referencing specific features.",
      "matched_features": ["feature from the list above that this matches"],
      "confidence": 0.0
    }
  ],
  "follow_up": "Optional: a short tip on what extra detail would narrow the search, or null."
}

Return up to 8 results, best first. Only include URLs you actually found via search. confidence is 0-1.`;

export class UserError extends Error {}

/** Validate and normalise a search request. Throws UserError on bad input. */
export function parseSearchRequest(body) {
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : "";
  const rawSketches = Array.isArray(body?.sketches) ? body.sketches : [];
  if (rawSketches.length > MAX_SKETCHES) {
    throw new UserError(`Too many sketches (max ${MAX_SKETCHES}).`);
  }
  const sketches = rawSketches.map((s, i) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(s?.image ?? "");
    if (!match) throw new UserError(`Sketch ${i + 1} is not a valid image.`);
    return {
      mediaType: `image/${match[1]}`,
      data: match[2],
      caption: typeof s.caption === "string" ? s.caption.trim().slice(0, 500) : "",
    };
  });
  if (!text && sketches.length === 0) {
    throw new UserError("Draw something or describe what you're looking for.");
  }
  return { text, sketches };
}

function buildUserContent({ text, sketches }) {
  const content = [];
  sketches.forEach((s, i) => {
    content.push({ type: "text", text: `Sketch ${i + 1} of ${sketches.length}${s.caption ? ` — caption: "${s.caption}"` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: s.mediaType, data: s.data } });
  });
  content.push({
    type: "text",
    text: text
      ? `Description from the user:\n${text}`
      : "The user gave no text description — work from the sketches alone.",
  });
  return content;
}

/**
 * Run the search with an Anthropic SDK client (Node or browser build).
 * Returns the normalised result, without thumbnails.
 */
export async function searchWithClient(client, request, { signal, model = DEFAULT_MODEL } = {}) {
  const messages = [{ role: "user", content: buildUserContent(request) }];
  const allContent = []; // search results can land in any turn, including paused ones
  let response;

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await client.beta.messages
      .stream(
        {
          model,
          max_tokens: 32000,
          system: SYSTEM_PROMPT,
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          messages,
        },
        { signal },
      )
      .finalMessage();

    allContent.push(...response.content);
    // Long server-side tool loops pause; resend with the assistant turn so the server resumes.
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") {
    throw new UserError("The search engine declined this request. Try rephrasing it.");
  }

  const sources = collectSources(allContent);
  const finalText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJson(finalText);
  const result = parsed
    ? normaliseResult(parsed)
    : {
        interpretation: finalText.trim().slice(0, 2000) || "No answer was produced.",
        category: "other",
        features: [],
        queries: [],
        results: [],
        follow_up: null,
      };

  // Fall back to the raw search hits if the model returned no structured results.
  if (result.results.length === 0 && sources.length > 0) {
    result.results = sources.slice(0, 8).map((s) => ({
      title: s.title,
      url: s.url,
      image_url: null,
      snippet: "",
      why: "",
      matched_features: [],
      confidence: null,
    }));
  }

  result.sources = sources;
  result.truncated = response.stop_reason === "pause_turn" || response.stop_reason === "max_tokens";
  return result;
}

function collectSources(content) {
  const seen = new Map();
  for (const block of content) {
    // A successful search's content is a list; an error is a single object.
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r.type === "web_search_result" && safeHttpUrl(r.url) && !seen.has(r.url)) {
        seen.set(r.url, { title: r.title || r.url, url: r.url });
      }
    }
  }
  return [...seen.values()];
}

function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object") return obj;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const str = (v, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v, max = 20) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max) : []);

function normaliseResult(obj) {
  const results = (Array.isArray(obj.results) ? obj.results : [])
    .filter((r) => r && safeHttpUrl(r.url))
    .slice(0, 8)
    .map((r) => ({
      title: str(r.title, 300) || r.url,
      url: r.url,
      image_url: safeHttpUrl(r.image_url) ? r.image_url : null,
      snippet: str(r.snippet),
      why: str(r.why),
      matched_features: strList(r.matched_features),
      confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : null,
    }));
  return {
    interpretation: str(obj.interpretation, 2000),
    category: str(obj.category, 40) || "other",
    features: strList(obj.features),
    queries: strList(obj.queries),
    results,
    follow_up: str(obj.follow_up, 1000) || null,
  };
}

export function safeHttpUrl(u) {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
