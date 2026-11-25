import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// The update window's notes renderer (src-tauri/frontend/notes.js). It runs in
// the app's webview; here a tiny stand-in for the DOM is enough, because the
// renderer only builds elements and sets text.

class Node_ {
  children: Node_[] = [];
  text = "";
  constructor(public tag: string) {}
  append(...n: Node_[]) {
    this.children.push(...n);
  }
  replaceChildren() {
    this.children = [];
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
  get tagName() {
    return this.tag.toUpperCase();
  }
  get lastElementChild(): Node_ | null {
    return [...this.children].reverse().find((c) => c.tag !== "#text") ?? null;
  }
}
const doc = {
  createElement: (t: string) => new Node_(t),
  createTextNode: (t: string) => Object.assign(new Node_("#text"), { text: t }),
};

/** "ul[li[hello], li[b[x]]]"-style outline, easy to assert on. */
function outline(n: Node_): string {
  if (n.tag === "#text") return n.text;
  const inner = n.children.map(outline).join("") + n.text;
  return n.tag === "div" ? inner : `${n.tag}[${inner}]`;
}
const allTags = (n: Node_): string[] => [n.tag, ...n.children.flatMap(allTags)];

let renderNotes: (d: unknown, c: unknown, notes: string) => void;
beforeAll(async () => {
  renderNotes = (await import(/* @vite-ignore */ path.resolve(__dirname, "../src-tauri/frontend/notes.js"))).renderNotes;
});
const render = (notes: string) => {
  const root = new Node_("div");
  renderNotes(doc, root, notes);
  return root;
};

describe("release notes in the update window", () => {
  it("draws headings, bullets, numbered steps, code and bold", () => {
    const root = render("## Fixed\n\n- one\n- two with `code` and **bold**\n\n1. first\n2. second\n\nPlain words.");
    expect(outline(root)).toBe("h3[Fixed]ul[li[one]li[two with code[code] and strong[bold]]]ol[li[first]li[second]]p[Plain words.]");
  });

  it("joins a wrapped list line and a wrapped paragraph", () => {
    expect(outline(render("- long item\n  continues here\n\nsome text\nmore text"))).toBe("ul[li[long item continues here]]p[some text more text]");
  });

  it("keeps a fenced block as plain text, even an unclosed one", () => {
    expect(outline(render("```\nmkdir -p ingest\nchown 1000 ingest\n```"))).toBe("pre[mkdir -p ingest\nchown 1000 ingest]");
    expect(outline(render("```\nunclosed <b>"))).toBe("pre[unclosed <b>]");
  });

  it("never turns text into elements, so markup in the notes stays text", () => {
    const evil = '<img src=x onerror="alert(1)"> <script>alert(2)</script> [click](javascript:alert(3))\n\n- <iframe src=//evil></iframe>';
    const tags = allTags(render(evil));
    expect(tags.filter((t) => !["div", "p", "ul", "li", "#text"].includes(t))).toEqual([]);
    expect(outline(render(evil))).toContain("<img src=x onerror=");
  });

  it("handles empty notes and Windows line endings", () => {
    expect(outline(render(""))).toBe("");
    expect(outline(render("## A\r\n- b\r\n"))).toBe("h3[A]ul[li[b]]");
  });
});
