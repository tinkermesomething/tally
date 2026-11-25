// Draws release notes (a small subset of Markdown) with DOM nodes and
// textContent only. Notes come from a download, so nothing in them is ever
// parsed as HTML: "<img onerror=...>" shows up as that literal text.

/** `code` and **bold** inside one line of text. */
function inline(doc, parent, text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      const el = doc.createElement("code");
      el.textContent = part.slice(1, -1);
      parent.append(el);
    } else if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      const el = doc.createElement("strong");
      el.textContent = part.slice(2, -2);
      parent.append(el);
    } else {
      parent.append(doc.createTextNode(part));
    }
  }
}

export function renderNotes(doc, container, notes) {
  container.replaceChildren();
  let list = null; // the open <ul> or <ol>
  let fence = null; // lines of an open ``` block
  let paragraph = null; // lines of an open paragraph

  const closeList = () => (list = null);
  const flushParagraph = () => {
    if (!paragraph) return;
    const p = doc.createElement("p");
    inline(doc, p, paragraph.join(" "));
    container.append(p);
    paragraph = null;
  };

  for (const raw of String(notes).replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      if (raw.trim().startsWith("```")) {
        const pre = doc.createElement("pre");
        pre.textContent = fence.join("\n");
        container.append(pre);
        fence = null;
      } else {
        fence.push(raw);
      }
      continue;
    }
    const line = raw.trimEnd();
    if (line.trim().startsWith("```")) {
      flushParagraph();
      closeList();
      fence = [];
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const h = doc.createElement(heading[1].length <= 2 ? "h3" : "h4");
      inline(doc, h, heading[2]);
      container.append(h);
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "UL" : "OL";
      if (!list || list.tagName !== tag) {
        list = doc.createElement(tag.toLowerCase());
        container.append(list);
      }
      const li = doc.createElement("li");
      inline(doc, li, (bullet || numbered)[1]);
      list.append(li);
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else if (list && /^\s+\S/.test(line)) {
      // a wrapped line of the last list item
      list.lastElementChild.append(doc.createTextNode(" "));
      inline(doc, list.lastElementChild, line.trim());
    } else {
      closeList();
      (paragraph ??= []).push(line.trim());
    }
  }
  if (fence) {
    const pre = doc.createElement("pre");
    pre.textContent = fence.join("\n");
    container.append(pre);
  }
  flushParagraph();
}
