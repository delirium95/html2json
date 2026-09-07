"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html2json = require("../html2json");

function childElements(node) {
  return node.children.filter((child) => child.type === "element");
}

test("exports the converter for both direct and named CommonJS imports", () => {
  assert.equal(typeof html2json, "function");
  assert.equal(html2json.html2json, html2json);
});

test("runs as a classic browser script and updates the supplied UI", () => {
  const elements = {
    html: { value: "<p>browser smoke test</p>" },
    json: { textContent: "" },
  };
  const context = {
    document: {
      getElementById(id) {
        return elements[id];
      },
    },
  };
  const script = fs.readFileSync(
    path.join(__dirname, "..", "html2json.js"),
    "utf8"
  );

  vm.runInNewContext(script, context);
  context.convertHtml2JsonAndSet();

  const renderedResult = JSON.parse(elements.json.textContent);
  assert.equal(renderedResult.children[0].tagName, "p");
  assert.equal(renderedResult.children[0].children[0].value, "browser smoke test");
});

test("returns an empty document for empty, null, or undefined input", () => {
  const emptyDocument = { type: "document", children: [] };

  assert.deepEqual(html2json(""), emptyDocument);
  assert.deepEqual(html2json(null), emptyDocument);
  assert.deepEqual(html2json(undefined), emptyDocument);
});

test("safely coerces other primitives and hostile objects", () => {
  assert.deepEqual(html2json(42), {
    type: "document",
    children: [{ type: "text", value: "42" }],
  });

  const hostileValue = {
    [Symbol.toPrimitive]() {
      throw new Error("conversion failed");
    },
  };

  assert.doesNotThrow(() => html2json(hostileValue));
  assert.deepEqual(html2json(hostileValue), {
    type: "document",
    children: [],
  });
});

test("preserves mixed-content order", () => {
  assert.deepEqual(html2json("<p>Hello <strong>world</strong>!</p>"), {
    type: "document",
    children: [
      {
        type: "element",
        tagName: "p",
        attributes: [],
        children: [
          { type: "text", value: "Hello " },
          {
            type: "element",
            tagName: "strong",
            attributes: [],
            children: [{ type: "text", value: "world" }],
          },
          { type: "text", value: "!" },
        ],
      },
    ],
  });
});

test("preserves attribute order, spelling, duplicate names, and boolean values", () => {
  const documentNode = html2json(
    `<input DISABLED empty="" data-label='a > b' bare=value duplicate=1 duplicate=2>`
  );
  const input = documentNode.children[0];

  assert.deepEqual(input.attributes, [
    { name: "DISABLED", value: null },
    { name: "empty", value: "" },
    { name: "data-label", value: "a > b" },
    { name: "bare", value: "value" },
    { name: "duplicate", value: "1" },
    { name: "duplicate", value: "2" },
  ]);
});

test("keeps whitespace and character references source-faithful", () => {
  const source = "  <p>&copy; Tom &amp; Jerry &#x1F42D;</p>\n";
  const documentNode = html2json(source);

  assert.equal(documentNode.children[0].value, "  ");
  assert.equal(documentNode.children[1].children[0].value, "&copy; Tom &amp; Jerry &#x1F42D;");
  assert.equal(documentNode.children[2].value, "\n");
});

test("parses doctype identifiers, comments, declarations, and processing instructions", () => {
  const source =
    `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "about:legacy>compat">` +
    `<!--note--><?xml version="1.0"?><!custom "a>b">`;
  const nodes = html2json(source).children;

  assert.deepEqual(nodes[0], {
    type: "doctype",
    name: "html",
    publicId: "-//W3C//DTD HTML 4.01//EN",
    systemId: "about:legacy>compat",
  });
  assert.deepEqual(nodes[1], { type: "comment", value: "note" });
  assert.deepEqual(nodes[2], {
    type: "processingInstruction",
    target: "xml",
    value: `version="1.0"`,
  });
  assert.deepEqual(nodes[3], {
    type: "declaration",
    value: `custom "a>b"`,
  });
});

test("treats script, style, title, and textarea bodies as text", () => {
  const source =
    `<script>if (a < b) out = "<div>";</SCRIPT>` +
    `<style>.x::before { content: "<tag>"; }</style>` +
    `<title>A <b>title</b></title>` +
    `<textarea><b>&amp;</b></textarea>`;
  const elements = childElements(html2json(source));

  assert.equal(elements[0].children[0].value, `if (a < b) out = "<div>";`);
  assert.equal(elements[1].children[0].value, `.x::before { content: "<tag>"; }`);
  assert.equal(elements[2].children[0].value, "A <b>title</b>");
  assert.equal(elements[3].children[0].value, "<b>&amp;</b>");
});

test("treats everything after a plaintext start tag as text", () => {
  const plaintext = html2json("<plaintext><div>not markup</div>").children[0];

  assert.deepEqual(plaintext.children, [
    { type: "text", value: "<div>not markup</div>" },
  ]);
});

test("handles HTML void elements without swallowing following siblings", () => {
  const elements = childElements(
    html2json("<p>before<br>after<img src=x></p><hr><p>end</p>")
  );

  assert.deepEqual(elements.map((element) => element.tagName), ["p", "hr", "p"]);
  assert.deepEqual(
    elements[0].children.map((child) => child.tagName || child.value),
    ["before", "br", "after", "img"]
  );
});

test("honors foreign-content self-closing syntax and HTML integration points", () => {
  const svg = html2json(
    `<svg viewBox="0 0 10 10">` +
      `<foreignObject><div>HTML<br>content</div><svg><path /></svg></foreignObject>` +
      `<circle cx="5" cy="5" r="4" />` +
      `<![CDATA[a < b]]>` +
      `</svg>`
  ).children[0];

  assert.equal(svg.tagName, "svg");
  assert.deepEqual(
    childElements(svg).map((element) => element.tagName),
    ["foreignObject", "circle"]
  );
  assert.equal(svg.children[2].type, "cdata");
  assert.equal(svg.children[2].value, "a < b");
});

test("follows HTML's rule that '/>' does not close non-void HTML elements", () => {
  const div = html2json("<div/>still inside</div><span>outside</span>").children[0];

  assert.deepEqual(div.children, [{ type: "text", value: "still inside" }]);
});

test("applies common optional-end-tag rules", () => {
  const list = html2json("<ul><li>one<li>two<li>three</ul>").children[0];
  assert.deepEqual(
    childElements(list).map((item) => item.children[0].value),
    ["one", "two", "three"]
  );

  const paragraphDocument = html2json("<p>intro<section>body</section>tail");
  assert.deepEqual(
    paragraphDocument.children.map((node) => node.tagName || node.value),
    ["p", "section", "tail"]
  );

  const select = html2json("<select><option>A<option>B</select>").children[0];
  assert.equal(childElements(select).length, 2);

  const table = html2json(
    "<table><tbody><tr><td>A<td>B<tr><td>C</table>"
  ).children[0];
  const rows = childElements(childElements(table)[0]);
  assert.equal(rows.length, 2);
  assert.equal(childElements(rows[0]).length, 2);
  assert.equal(childElements(rows[1]).length, 1);
});

test("closes optional head, caption, colgroup, and ruby text elements", () => {
  const html = html2json(
    "<html><head><title>x</title><body><p>body</p></body></html>"
  ).children[0];
  assert.deepEqual(
    childElements(html).map((element) => element.tagName),
    ["head", "body"]
  );

  const table = html2json(
    "<table><caption>Title<colgroup><col><tbody><tr><td>Cell</table>"
  ).children[0];
  assert.deepEqual(
    childElements(table).map((element) => element.tagName),
    ["caption", "colgroup", "tbody"]
  );

  const ruby = html2json("<ruby>字<rt>ji<rt>zì</ruby>").children[0];
  assert.equal(childElements(ruby).length, 2);
});

test("closes mismatched open elements deterministically", () => {
  const documentNode = html2json("<div><span>x</div><p>y</p>");

  assert.deepEqual(
    childElements(documentNode).map((element) => element.tagName),
    ["div", "p"]
  );
  assert.equal(documentNode.children[0].children[0].tagName, "span");
});

test("does not throw on truncated or malformed input", () => {
  const cases = [
    "<",
    "</",
    "<div",
    `<div class="unterminated`,
    "<!--unterminated",
    "<!DOCTYPE html PUBLIC 'unterminated",
    "<script>const x = '<p>';",
    "<div><span><em>open",
    "\0\ud800</not-open>",
    "<".repeat(20_000),
  ];

  for (const source of cases) {
    assert.doesNotThrow(() => html2json(source));
    assert.equal(html2json(source).type, "document");
  }
});

test("handles large and deeply nested inputs iteratively", () => {
  const largeText = "content < not-a-tag &amp; ".repeat(20_000);
  const largeResult = html2json(`<article>${largeText}</article>`);
  assert.equal(largeResult.children[0].children[0].value, largeText);

  const depth = 5_000;
  const deepResult = html2json("<div>".repeat(depth) + "leaf");
  let current = deepResult;

  for (let index = 0; index < depth; index += 1) {
    current = current.children[0];
    assert.equal(current.tagName, "div");
  }

  assert.equal(current.children[0].value, "leaf");
});

test("all checked-in HTML samples convert and serialize", () => {
  const samplesDirectory = path.join(__dirname, "..", "html_samples");
  const sampleNames = fs
    .readdirSync(samplesDirectory)
    .filter((name) => name.endsWith(".html"));

  assert.ok(sampleNames.length >= 3);

  for (const sampleName of sampleNames) {
    const source = fs.readFileSync(path.join(samplesDirectory, sampleName), "utf8");
    const result = html2json(source);

    assert.equal(result.type, "document", sampleName);
    assert.doesNotThrow(() => JSON.stringify(result), sampleName);
  }
});
