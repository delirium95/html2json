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

function createBrowserContext(input = "") {
  const elements = {
    html: { value: input },
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
  return { context, elements };
}

test("exports the converter for both direct and named CommonJS imports", () => {
  assert.equal(typeof html2json, "function");
  assert.equal(html2json.html2json, html2json);
});

test("runs as a classic browser script and updates the supplied UI", () => {
  const { context, elements } = createBrowserContext(
    "<p>browser smoke test</p>"
  );
  context.convertHtml2JsonAndSet();

  const renderedResult = JSON.parse(elements.json.textContent);
  assert.equal(renderedResult.children[0].tagName, "p");
  assert.equal(renderedResult.children[0].children[0].value, "browser smoke test");
});

test("both example buttons populate the input and show its conversion", () => {
  const { context, elements } = createBrowserContext();

  for (const example of ["showExample1", "showExample2"]) {
    context[example]();
    const rendered = JSON.parse(elements.json.textContent);

    assert.ok(childElements(rendered).length > 0, example);
    assert.deepEqual(rendered, html2json(elements.html.value), example);

    // The Convert action must agree with the example button's output.
    context.convertHtml2JsonAndSet();
    assert.deepEqual(JSON.parse(elements.json.textContent), rendered, example);
  }
});

test("the UI reports a serialization failure without throwing", () => {
  const { context, elements } = createBrowserContext("<p>example</p>");
  let calls = 0;

  context.JSON = {
    stringify(...args) {
      calls += 1;
      if (calls === 1) throw new RangeError("Maximum call stack size exceeded");
      return JSON.stringify(...args);
    },
  };

  assert.doesNotThrow(() => context.convertHtml2JsonAndSet());
  assert.deepEqual(JSON.parse(elements.json.textContent), {
    type: "error",
    message: "The resulting tree is too deeply nested to display.",
  });
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

test("treats prototype-like attribute names as ordinary data", () => {
  const node = html2json(
    '<div __proto__="data" constructor="ctor" toString="text"></div>'
  ).children[0];

  assert.deepEqual(node.attributes, [
    { name: "__proto__", value: "data" },
    { name: "constructor", value: "ctor" },
    { name: "toString", value: "text" },
  ]);
  assert.equal(Object.getPrototypeOf(node), Object.prototype);
  assert.equal(Object.getPrototypeOf(node.attributes), Array.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(node)), node);
});

test("matches closing tags without changing source spelling or Unicode text", () => {
  const nodes = html2json(
    '<DIV data-label="Київ 🐈"><SpAn>Привіт, 世界!</sPaN></div><BR>tail'
  ).children;

  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].tagName, "DIV");
  assert.equal(nodes[0].attributes[0].value, "Київ 🐈");
  assert.equal(nodes[0].children[0].tagName, "SpAn");
  assert.deepEqual(nodes[0].children[0].children, [
    { type: "text", value: "Привіт, 世界!" },
  ]);
  assert.equal(nodes[1].tagName, "BR");
  assert.deepEqual(nodes[2], { type: "text", value: "tail" });
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

test("requires a complete matching raw-text end-tag name", () => {
  for (const name of ["script", "style", "textarea", "title"]) {
    const body = `before </${name}-extra><b>still text</b> &amp;`;
    const nodes = html2json(
      `<${name}>${body}</${name.toUpperCase()} \n><p>after</p>`
    ).children;

    assert.equal(nodes.length, 2, name);
    assert.deepEqual(nodes[0].children, [{ type: "text", value: body }], name);
    assert.equal(nodes[1].tagName, "p", name);
  }
});

test("does not execute scripts or event attributes from input", () => {
  const { context } = createBrowserContext();
  context.executed = false;
  const result = context.html2json(
    '<script>globalThis.executed = true;</script>' +
      '<img src=x onerror="globalThis.executed = true;">'
  );

  assert.equal(context.executed, false);
  assert.equal(result.children[0].children[0].value, "globalThis.executed = true;");
  assert.equal(result.children[1].attributes[1].name, "onerror");
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

test("all HTML void elements leave following text in the parent", () => {
  const names = [
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ];

  for (const name of names) {
    for (const ending of [">", " />"]) {
      const nodes = html2json(`<${name}${ending}after`).children;
      assert.equal(nodes.length, 2, `${name}${ending}`);
      assert.deepEqual(nodes[0].children, []);
      assert.deepEqual(nodes[1], { type: "text", value: "after" });
    }
  }
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

test("handles MathML self-closing elements and embedded HTML", () => {
  const math = html2json(
    '<math><mi><mglyph src="glyph.svg"/><span>x</span></mi>' +
      '<mspace width="1em"/><mn>1</mn>' +
      '<annotation-xml encoding="TEXT/HTML"><div>a<br>b</div></annotation-xml>' +
      '</math>'
  ).children[0];

  assert.deepEqual(
    childElements(math).map((node) => node.tagName),
    ["mi", "mspace", "mn", "annotation-xml"]
  );
  assert.deepEqual(
    childElements(math.children[0]).map((node) => node.tagName),
    ["mglyph", "span"]
  );
  assert.deepEqual(math.children[1].children, []);
  assert.deepEqual(math.children[2].children, [{ type: "text", value: "1" }]);
  assert.deepEqual(
    math.children[3].children[0].children.map((node) => node.tagName || node.value),
    ["a", "br", "b"]
  );
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

test("keeps omitted li end tags scoped to the nearest list", () => {
  const list = html2json(
    "<ul><li>Outer<ol><li>Inner A<li>Inner B</ol><li>Outer B</ul>"
  ).children[0];
  const items = childElements(list);

  assert.equal(items.length, 2);
  const inner = childElements(items[0])[0];
  assert.equal(inner.tagName, "ol");
  assert.deepEqual(
    childElements(inner).map((item) => item.children[0].value),
    ["Inner A", "Inner B"]
  );
  assert.deepEqual(items[1].children, [{ type: "text", value: "Outer B" }]);
});

test("nested description lists do not close outer descriptions", () => {
  for (const innerMarkup of [
    "<dt>Inner</dt><dd>Definition</dd>",
    "<dt>Inner<dd>Definition",
  ]) {
    const list = html2json(
      `<dl><dt>Outer</dt><dd><dl>${innerMarkup}</dl></dd></dl>`
    ).children[0];
    const items = childElements(list);

    assert.deepEqual(items.map((item) => item.tagName), ["dt", "dd"]);
    const inner = items[1].children[0];
    assert.equal(inner.tagName, "dl");
    assert.deepEqual(
      childElements(inner).map((item) => item.tagName),
      ["dt", "dd"]
    );
    assert.equal(inner.children[0].children[0].value, "Inner");
    assert.equal(inner.children[1].children[0].value, "Definition");
  }
});

test("nested tables keep their rows and cells inside the correct table", () => {
  const table = html2json(
    "<table><tr><td>Outer<table><tr><td>Inner A<td>Inner B</table>" +
      "<td>Outer B</table>"
  ).children[0];
  const cells = childElements(table.children[0]);

  assert.equal(cells.length, 2);
  const inner = childElements(cells[0])[0];
  assert.equal(inner.tagName, "table");
  assert.deepEqual(
    childElements(inner.children[0]).map((cell) => cell.children[0].value),
    ["Inner A", "Inner B"]
  );
  assert.equal(cells[1].children[0].value, "Outer B");
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

  assert.ok(sampleNames.length >= 4);

  for (const sampleName of sampleNames) {
    const source = fs.readFileSync(path.join(samplesDirectory, sampleName), "utf8");
    const result = html2json(source);

    assert.equal(result.type, "document", sampleName);
    assert.ok(childElements(result).length > 0, sampleName);
    assert.doesNotThrow(() => JSON.stringify(result), sampleName);
  }
});
