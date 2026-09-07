"use strict";

const HTML_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const HTML_RAW_TEXT_ELEMENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "xmp",
]);

const HTML_RCDATA_ELEMENTS = new Set(["textarea", "title"]);

const P_CLOSING_START_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "ul",
]);

const HEADING_ELEMENTS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const DEFAULT_SCOPE_BOUNDARIES = new Set([
  "applet",
  "caption",
  "html",
  "marquee",
  "object",
  "table",
  "td",
  "template",
  "th",
]);

const LIST_SCOPE_BOUNDARIES = new Set([
  ...DEFAULT_SCOPE_BOUNDARIES,
  "ol",
  "ul",
]);

// Inner dt/dd start tags belong to the inner dl; they must not pop an outer dd.
const DESCRIPTION_SCOPE_BOUNDARIES = new Set([
  ...DEFAULT_SCOPE_BOUNDARIES,
  "dl",
]);

const TABLE_SCOPE_BOUNDARIES = new Set(["html", "table", "template"]);
const SELECT_SCOPE_BOUNDARIES = new Set(["html", "select", "template"]);
const P_ELEMENTS = new Set(["p"]);
const LIST_ITEM_ELEMENTS = new Set(["li"]);
const DESCRIPTION_ITEM_ELEMENTS = new Set(["dt", "dd"]);
const OPTION_ELEMENTS = new Set(["option"]);
const OPTION_GROUP_ELEMENTS = new Set(["optgroup"]);
const TABLE_CELL_ELEMENTS = new Set(["td", "th"]);
const TABLE_ROW_ELEMENTS = new Set(["tr"]);
const TABLE_SECTION_ELEMENTS = new Set(["tbody", "tfoot", "thead"]);
const RUBY_TEXT_ELEMENTS = new Set(["rp", "rt"]);
const HEAD_ELEMENTS = new Set(["head"]);
const HEAD_CONTENT_ELEMENTS = new Set([
  "base",
  "basefont",
  "bgsound",
  "link",
  "meta",
  "noframes",
  "script",
  "style",
  "template",
  "title",
]);
const CAPTION_ELEMENTS = new Set(["caption"]);
const COLGROUP_ELEMENTS = new Set(["colgroup"]);
const TAGS_AFTER_CAPTION = new Set([
  "colgroup",
  "tbody",
  "tfoot",
  "thead",
  "tr",
]);
const TAGS_AFTER_COLGROUP = new Set([
  "colgroup",
  "tbody",
  "tfoot",
  "thead",
  "tr",
]);

/**
 * Convert an HTML document or fragment into a JSON-serializable syntax tree.
 *
 * The parser intentionally does not use DOMParser, document.createElement,
 * innerHTML, or any third-party DOM implementation. Text and attribute values
 * are kept exactly as written, including character/entity references.
 *
 * @param {*} htmlText Value to convert. Non-string values are safely coerced.
 * @returns {{type: "document", children: Array<object>}}
 */
function html2json(htmlText) {
  const source = safelyConvertToString(htmlText);

  try {
    return parseHtml(source);
  } catch (_unexpectedParserError) {
    // The public boundary is deliberately fail-safe. If an unforeseen parser
    // bug is encountered, returning the source as text is more useful than
    // crashing the page and still preserves all input data.
    return {
      type: "document",
      children: source ? [{ type: "text", value: source }] : [],
    };
  }
}

function safelyConvertToString(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return String(value);
  } catch (_conversionError) {
    return "";
  }
}

function parseHtml(source) {
  const documentNode = { type: "document", children: [] };
  const stack = [
    {
      node: documentNode,
      normalizedName: "#document",
      namespace: "html",
    },
  ];
  const openElements = {
    all: new Map(),
    html: new Map(),
  };

  let cursor = 0;

  while (cursor < source.length) {
    const currentFrame = stack[stack.length - 1];

    if (currentFrame.namespace === "html") {
      if (currentFrame.normalizedName === "plaintext") {
        appendText(currentFrame.node, source.slice(cursor));
        break;
      }

      if (
        HTML_RAW_TEXT_ELEMENTS.has(currentFrame.normalizedName) ||
        HTML_RCDATA_ELEMENTS.has(currentFrame.normalizedName)
      ) {
        const closingTagStart = findRawTextClosingTag(
          source,
          cursor,
          currentFrame.normalizedName
        );

        if (closingTagStart === -1) {
          appendText(currentFrame.node, source.slice(cursor));
          break;
        }

        if (closingTagStart > cursor) {
          appendText(
            currentFrame.node,
            source.slice(cursor, closingTagStart)
          );
          cursor = closingTagStart;
          continue;
        }
      }
    }

    if (source[cursor] !== "<") {
      const nextMarkupStart = source.indexOf("<", cursor);
      const textEnd = nextMarkupStart === -1 ? source.length : nextMarkupStart;
      appendText(currentFrame.node, source.slice(cursor, textEnd));
      cursor = textEnd;
      continue;
    }

    if (source.startsWith("<!--", cursor)) {
      const comment = readComment(source, cursor);
      currentFrame.node.children.push(comment.node);
      cursor = comment.nextCursor;
      continue;
    }

    if (source.startsWith("<![CDATA[", cursor)) {
      const cdata = readCdata(source, cursor);
      currentFrame.node.children.push(cdata.node);
      cursor = cdata.nextCursor;
      continue;
    }

    if (isDoctypeStart(source, cursor)) {
      const doctype = readDoctype(source, cursor);
      currentFrame.node.children.push(doctype.node);
      cursor = doctype.nextCursor;
      continue;
    }

    if (source.startsWith("<?", cursor)) {
      const instruction = readProcessingInstruction(source, cursor);
      currentFrame.node.children.push(instruction.node);
      cursor = instruction.nextCursor;
      continue;
    }

    if (source.startsWith("<!", cursor)) {
      const declaration = readDeclaration(source, cursor);
      currentFrame.node.children.push(declaration.node);
      cursor = declaration.nextCursor;
      continue;
    }

    if (source.startsWith("</", cursor)) {
      const endTag = readEndTag(source, cursor);

      if (endTag) {
        closeElement(stack, openElements, normalizeName(endTag.tagName));
        cursor = endTag.nextCursor;
        continue;
      }
    } else if (isAsciiLetter(source[cursor + 1])) {
      const startTag = readStartTag(source, cursor);

      if (startTag) {
        const normalizedName = normalizeName(startTag.tagName);
        applyImpliedEndTags(stack, openElements, normalizedName);

        const parentFrame = stack[stack.length - 1];
        const namespace = getChildNamespace(parentFrame, normalizedName);
        const elementNode = {
          type: "element",
          tagName: startTag.tagName,
          attributes: startTag.attributes,
          children: [],
        };

        parentFrame.node.children.push(elementNode);

        const isVoid =
          namespace === "html" && HTML_VOID_ELEMENTS.has(normalizedName);
        const closesItself =
          isVoid || (startTag.selfClosing && namespace !== "html");

        if (!closesItself) {
          pushOpenElement(stack, openElements, {
            node: elementNode,
            normalizedName,
            namespace,
          });
        }

        cursor = startTag.nextCursor;
        continue;
      }
    }

    // A '<' that cannot begin a recognized token is ordinary text. Advancing
    // one code unit here also guarantees progress on malformed input.
    appendText(currentFrame.node, "<");
    cursor += 1;
  }

  return documentNode;
}

function readComment(source, start) {
  const contentStart = start + 4;
  const closingStart = source.indexOf("-->", contentStart);

  if (closingStart === -1) {
    return {
      node: { type: "comment", value: source.slice(contentStart) },
      nextCursor: source.length,
    };
  }

  return {
    node: {
      type: "comment",
      value: source.slice(contentStart, closingStart),
    },
    nextCursor: closingStart + 3,
  };
}

function readCdata(source, start) {
  const contentStart = start + 9;
  const closingStart = source.indexOf("]]>", contentStart);

  if (closingStart === -1) {
    return {
      node: { type: "cdata", value: source.slice(contentStart) },
      nextCursor: source.length,
    };
  }

  return {
    node: {
      type: "cdata",
      value: source.slice(contentStart, closingStart),
    },
    nextCursor: closingStart + 3,
  };
}

function readDoctype(source, start) {
  const closingStart = findDeclarationEnd(source, start + 2);
  const contentEnd = closingStart === -1 ? source.length : closingStart;
  const rawDeclaration = source.slice(start + 2, contentEnd);
  const doctypeBody = rawDeclaration.replace(/^doctype(?:\s+|$)/i, "");
  const parsed = parseDoctypeBody(doctypeBody);

  return {
    node: {
      type: "doctype",
      name: parsed.name,
      publicId: parsed.publicId,
      systemId: parsed.systemId,
    },
    nextCursor: closingStart === -1 ? source.length : closingStart + 1,
  };
}

function parseDoctypeBody(body) {
  let cursor = skipWhitespace(body, 0);
  const nameStart = cursor;

  while (cursor < body.length && !isHtmlWhitespace(body[cursor])) {
    cursor += 1;
  }

  const result = {
    name: body.slice(nameStart, cursor),
    publicId: null,
    systemId: null,
  };

  cursor = skipWhitespace(body, cursor);
  const keywordStart = cursor;

  while (cursor < body.length && isAsciiLetter(body[cursor])) {
    cursor += 1;
  }

  const keyword = normalizeName(body.slice(keywordStart, cursor));
  cursor = skipWhitespace(body, cursor);

  if (keyword === "public") {
    const publicIdentifier = readQuotedValue(body, cursor);

    if (publicIdentifier) {
      result.publicId = publicIdentifier.value;
      cursor = skipWhitespace(body, publicIdentifier.nextCursor);
      const systemIdentifier = readQuotedValue(body, cursor);

      if (systemIdentifier) {
        result.systemId = systemIdentifier.value;
      }
    }
  } else if (keyword === "system") {
    const systemIdentifier = readQuotedValue(body, cursor);

    if (systemIdentifier) {
      result.systemId = systemIdentifier.value;
    }
  }

  return result;
}

function readProcessingInstruction(source, start) {
  const contentStart = start + 2;
  let closingStart = source.indexOf("?>", contentStart);
  let closingLength = 2;

  if (closingStart === -1) {
    closingStart = source.indexOf(">", contentStart);
    closingLength = 1;
  }

  const contentEnd = closingStart === -1 ? source.length : closingStart;
  const content = source.slice(contentStart, contentEnd);
  const firstWhitespace = findFirstWhitespace(content);
  const target =
    firstWhitespace === -1 ? content : content.slice(0, firstWhitespace);
  const value =
    firstWhitespace === -1 ? "" : content.slice(firstWhitespace).trimStart();

  return {
    node: { type: "processingInstruction", target, value },
    nextCursor:
      closingStart === -1 ? source.length : closingStart + closingLength,
  };
}

function readDeclaration(source, start) {
  const contentStart = start + 2;
  const closingStart = findDeclarationEnd(source, contentStart);
  const contentEnd = closingStart === -1 ? source.length : closingStart;

  return {
    node: {
      type: "declaration",
      value: source.slice(contentStart, contentEnd),
    },
    nextCursor: closingStart === -1 ? source.length : closingStart + 1,
  };
}

function findDeclarationEnd(source, start) {
  let quote = null;
  let subsetDepth = 0;

  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      subsetDepth += 1;
    } else if (character === "]" && subsetDepth > 0) {
      subsetDepth -= 1;
    } else if (character === ">" && subsetDepth === 0) {
      return cursor;
    }
  }

  return -1;
}

function readEndTag(source, start) {
  let cursor = start + 2;

  if (!isAsciiLetter(source[cursor])) {
    return null;
  }

  const nameStart = cursor;

  while (cursor < source.length && !isTagNameDelimiter(source[cursor])) {
    cursor += 1;
  }

  const tagName = source.slice(nameStart, cursor);
  let quote = null;

  for (; cursor < source.length; cursor += 1) {
    const character = source[cursor];

    if (quote) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return { tagName, nextCursor: cursor + 1 };
    }
  }

  return null;
}

function readStartTag(source, start) {
  let cursor = start + 1;
  const nameStart = cursor;

  while (cursor < source.length && !isTagNameDelimiter(source[cursor])) {
    cursor += 1;
  }

  const tagName = source.slice(nameStart, cursor);
  const attributes = [];
  let selfClosing = false;

  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);

    if (source[cursor] === ">") {
      return { tagName, attributes, selfClosing, nextCursor: cursor + 1 };
    }

    if (source[cursor] === "/") {
      const afterSlash = skipWhitespace(source, cursor + 1);

      if (source[afterSlash] === ">") {
        selfClosing = true;
        return {
          tagName,
          attributes,
          selfClosing,
          nextCursor: afterSlash + 1,
        };
      }
    }

    const attributeNameStart = cursor;

    while (
      cursor < source.length &&
      !isAttributeNameDelimiter(source[cursor])
    ) {
      cursor += 1;
    }

    if (attributeNameStart === cursor) {
      // Recover from an unexpected character without getting stuck.
      cursor += 1;
      continue;
    }

    const name = source.slice(attributeNameStart, cursor);
    cursor = skipWhitespace(source, cursor);
    let value = null;

    if (source[cursor] === "=") {
      cursor = skipWhitespace(source, cursor + 1);

      if (source[cursor] === '"' || source[cursor] === "'") {
        const quote = source[cursor];
        const valueStart = cursor + 1;
        const valueEnd = source.indexOf(quote, valueStart);

        if (valueEnd === -1) {
          return null;
        }

        value = source.slice(valueStart, valueEnd);
        cursor = valueEnd + 1;
      } else {
        const valueStart = cursor;

        while (
          cursor < source.length &&
          !isHtmlWhitespace(source[cursor]) &&
          source[cursor] !== ">"
        ) {
          cursor += 1;
        }

        value = source.slice(valueStart, cursor);
      }
    }

    attributes.push({ name, value });
  }

  return null;
}

function applyImpliedEndTags(stack, openElements, incomingName) {
  const currentFrame = stack[stack.length - 1];

  if (currentFrame.namespace !== "html") {
    return;
  }

  if (incomingName !== "head" && !HEAD_CONTENT_ELEMENTS.has(incomingName)) {
    closeOpenElement(
      stack,
      openElements,
      HEAD_ELEMENTS,
      DEFAULT_SCOPE_BOUNDARIES
    );
  }

  if (TAGS_AFTER_CAPTION.has(incomingName)) {
    closeOpenElement(
      stack,
      openElements,
      CAPTION_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
  }

  if (TAGS_AFTER_COLGROUP.has(incomingName)) {
    closeOpenElement(
      stack,
      openElements,
      COLGROUP_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
  }

  if (P_CLOSING_START_TAGS.has(incomingName)) {
    closeOpenElement(
      stack,
      openElements,
      P_ELEMENTS,
      DEFAULT_SCOPE_BOUNDARIES
    );
  }

  if (incomingName === "li") {
    closeOpenElement(
      stack,
      openElements,
      LIST_ITEM_ELEMENTS,
      LIST_SCOPE_BOUNDARIES
    );
  } else if (incomingName === "dt" || incomingName === "dd") {
    closeOpenElement(
      stack,
      openElements,
      DESCRIPTION_ITEM_ELEMENTS,
      DESCRIPTION_SCOPE_BOUNDARIES
    );
  } else if (HEADING_ELEMENTS.has(incomingName)) {
    closeOpenElement(
      stack,
      openElements,
      HEADING_ELEMENTS,
      DEFAULT_SCOPE_BOUNDARIES
    );
  } else if (incomingName === "option") {
    closeOpenElement(
      stack,
      openElements,
      OPTION_ELEMENTS,
      SELECT_SCOPE_BOUNDARIES
    );
  } else if (incomingName === "optgroup") {
    closeOpenElement(
      stack,
      openElements,
      OPTION_ELEMENTS,
      SELECT_SCOPE_BOUNDARIES
    );
    closeOpenElement(
      stack,
      openElements,
      OPTION_GROUP_ELEMENTS,
      SELECT_SCOPE_BOUNDARIES
    );
  } else if (incomingName === "rp" || incomingName === "rt") {
    closeOpenElement(
      stack,
      openElements,
      RUBY_TEXT_ELEMENTS,
      DEFAULT_SCOPE_BOUNDARIES
    );
  } else if (incomingName === "td" || incomingName === "th") {
    closeOpenElement(
      stack,
      openElements,
      TABLE_CELL_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
  } else if (incomingName === "tr") {
    closeOpenElement(
      stack,
      openElements,
      TABLE_CELL_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
    closeOpenElement(
      stack,
      openElements,
      TABLE_ROW_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
  } else if (
    incomingName === "tbody" ||
    incomingName === "tfoot" ||
    incomingName === "thead"
  ) {
    closeOpenElement(
      stack,
      openElements,
      TABLE_CELL_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
    closeOpenElement(
      stack,
      openElements,
      TABLE_ROW_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
    closeOpenElement(
      stack,
      openElements,
      TABLE_SECTION_ELEMENTS,
      TABLE_SCOPE_BOUNDARIES
    );
  }
}

function closeOpenElement(stack, openElements, targetNames, boundaryNames) {
  if (!hasAnyOpenElement(openElements.html, targetNames)) {
    return false;
  }

  for (let index = stack.length - 1; index > 0; index -= 1) {
    const frame = stack[index];

    if (frame.namespace !== "html") {
      return false;
    }

    if (targetNames.has(frame.normalizedName)) {
      truncateOpenElements(stack, openElements, index);
      return true;
    }

    if (boundaryNames.has(frame.normalizedName)) {
      return false;
    }
  }

  return false;
}

function closeElement(stack, openElements, normalizedName) {
  if (!openElements.all.has(normalizedName)) {
    return;
  }

  for (let index = stack.length - 1; index > 0; index -= 1) {
    if (stack[index].normalizedName === normalizedName) {
      truncateOpenElements(stack, openElements, index);
      return;
    }
  }
}

function pushOpenElement(stack, openElements, frame) {
  stack.push(frame);
  incrementCount(openElements.all, frame.normalizedName);

  if (frame.namespace === "html") {
    incrementCount(openElements.html, frame.normalizedName);
  }
}

function truncateOpenElements(stack, openElements, newLength) {
  while (stack.length > newLength) {
    const frame = stack.pop();
    decrementCount(openElements.all, frame.normalizedName);

    if (frame.namespace === "html") {
      decrementCount(openElements.html, frame.normalizedName);
    }
  }
}

function hasAnyOpenElement(counts, names) {
  for (const name of names) {
    if (counts.has(name)) {
      return true;
    }
  }

  return false;
}

function incrementCount(counts, name) {
  counts.set(name, (counts.get(name) || 0) + 1);
}

function decrementCount(counts, name) {
  const nextCount = counts.get(name) - 1;

  if (nextCount === 0) {
    counts.delete(name);
  } else {
    counts.set(name, nextCount);
  }
}

function getChildNamespace(parentFrame, childName) {
  if (
    isMathTextIntegrationPoint(parentFrame) &&
    (childName === "malignmark" || childName === "mglyph")
  ) {
    return "mathml";
  }

  if (
    parentFrame.namespace === "html" ||
    isHtmlIntegrationPoint(parentFrame)
  ) {
    if (childName === "svg") {
      return "svg";
    }

    if (childName === "math") {
      return "mathml";
    }

    return "html";
  }

  return parentFrame.namespace;
}

function isHtmlIntegrationPoint(frame) {
  if (
    frame.namespace === "svg" &&
    (frame.normalizedName === "foreignobject" ||
      frame.normalizedName === "desc" ||
      frame.normalizedName === "title")
  ) {
    return true;
  }

  if (isMathTextIntegrationPoint(frame)) {
    return true;
  }

  if (
    frame.namespace === "mathml" &&
    frame.normalizedName === "annotation-xml"
  ) {
    const encoding = frame.node.attributes.find(
      (attribute) => normalizeName(attribute.name) === "encoding"
    );
    const normalizedEncoding = encoding
      ? normalizeName(encoding.value || "")
      : "";

    return (
      normalizedEncoding === "text/html" ||
      normalizedEncoding === "application/xhtml+xml"
    );
  }

  return false;
}

function isMathTextIntegrationPoint(frame) {
  return (
    frame.namespace === "mathml" &&
    (frame.normalizedName === "mi" ||
      frame.normalizedName === "mo" ||
      frame.normalizedName === "mn" ||
      frame.normalizedName === "ms" ||
      frame.normalizedName === "mtext")
  );
}

function findRawTextClosingTag(source, start, normalizedName) {
  let searchFrom = start;

  while (searchFrom < source.length) {
    const candidate = source.indexOf("</", searchFrom);

    if (candidate === -1) {
      return -1;
    }

    const nameStart = candidate + 2;
    const nameEnd = nameStart + normalizedName.length;
    const candidateName = source.slice(nameStart, nameEnd);
    const boundary = source[nameEnd];

    if (
      normalizeName(candidateName) === normalizedName &&
      (boundary === ">" || boundary === "/" || isHtmlWhitespace(boundary))
    ) {
      return candidate;
    }

    searchFrom = candidate + 2;
  }

  return -1;
}

function appendText(parentNode, value) {
  if (!value) {
    return;
  }

  const previousNode = parentNode.children[parentNode.children.length - 1];

  if (previousNode && previousNode.type === "text") {
    previousNode.value += value;
  } else {
    parentNode.children.push({ type: "text", value });
  }
}

function isDoctypeStart(source, cursor) {
  const marker = "<!doctype";

  if (normalizeName(source.slice(cursor, cursor + marker.length)) !== marker) {
    return false;
  }

  const boundary = source[cursor + marker.length];
  return boundary === ">" || isHtmlWhitespace(boundary);
}

function readQuotedValue(source, cursor) {
  const quote = source[cursor];

  if (quote !== '"' && quote !== "'") {
    return null;
  }

  const valueEnd = source.indexOf(quote, cursor + 1);

  if (valueEnd === -1) {
    return null;
  }

  return {
    value: source.slice(cursor + 1, valueEnd),
    nextCursor: valueEnd + 1,
  };
}

function findFirstWhitespace(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (isHtmlWhitespace(value[index])) {
      return index;
    }
  }

  return -1;
}

function skipWhitespace(source, start) {
  let cursor = start;

  while (cursor < source.length && isHtmlWhitespace(source[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function isHtmlWhitespace(character) {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\f" ||
    character === "\r"
  );
}

function isAsciiLetter(character) {
  if (!character) {
    return false;
  }

  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameDelimiter(character) {
  return (
    character === undefined ||
    isHtmlWhitespace(character) ||
    character === "/" ||
    character === ">"
  );
}

function isAttributeNameDelimiter(character) {
  return (
    character === undefined ||
    isHtmlWhitespace(character) ||
    character === "=" ||
    character === "/" ||
    character === ">"
  );
}

function normalizeName(value) {
  return value.toLowerCase();
}

function convertHtml2JsonAndSet() {
  const htmlTextAreaValue = document.getElementById("html").value;
  const jsonObj = html2json(htmlTextAreaValue);
  const jsonArea = document.getElementById("json");

  try {
    jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
  } catch (_serializationError) {
    jsonArea.textContent = JSON.stringify(
      {
        type: "error",
        message: "The resulting tree is too deeply nested to display.",
      },
      null,
      2
    );
  }
}

function showExample1() {
  const htmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`;

  document.getElementById("html").value = htmlExample;
  document.getElementById("json").textContent = JSON.stringify(
    html2json(htmlExample),
    null,
    2
  );
}

function showExample2() {
  const htmlExample = `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`;

  document.getElementById("html").value = htmlExample;
  document.getElementById("json").textContent = JSON.stringify(
    html2json(htmlExample),
    null,
    2
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = html2json;
  module.exports.html2json = html2json;
}
