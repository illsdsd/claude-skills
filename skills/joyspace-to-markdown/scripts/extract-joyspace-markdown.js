(async function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const title = (
    document.querySelector(".page-header-title-comp-title")?.textContent ||
    document.title ||
    "Doc"
  ).trim();

  const root =
    document.querySelector(".slate-editor") ||
    document.querySelector(".sl-editor") ||
    document.querySelector(".mf-doc-editor-page");

  if (!root) {
    throw new Error("未找到 JoySpace 文档根节点");
  }

  const scrollContainer =
    document.querySelector(".doc-page-container") || root.parentElement;

  const normalize = (value) =>
    (value || "").replace(/[\s\u200B\uFEFF\u00A0]/g, "");

  const lineId = (element) => {
    let current = element;
    while (current && current !== root) {
      const matched = (current.className || "").match(/lineid-(\S+)/);
      if (matched) {
        return matched[1];
      }
      current = current.parentElement;
    }
    return null;
  };

  const hash = (value) => {
    let hashed = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hashed = ((hashed << 5) + hashed) ^ value.charCodeAt(i);
    }
    return (hashed >>> 0).toString(36);
  };

  const blockKey = (element) => {
    const id = lineId(element);
    if (id) {
      return `l_${id}`;
    }
    return `g_${hash(normalize(element.textContent || "").slice(0, 200))}`;
  };

  const selector = [
    ".sl-highlight-block",
    ".sl-multi-column",
    ".sl-foldable-block",
    "table",
    ".sl-table",
    ".sl-block-code-wrap",
    "ul.sl-list-wrap",
    "ol.sl-list-wrap",
    ".sl-paragraph",
    ".sl-heading",
    ".sl-image",
  ].join(",");

  const ownerSelector = [
    ".sl-multi-column",
    "table",
    ".sl-table",
    ".sl-block-code-wrap",
    ".sl-foldable-block",
    ".sl-highlight-block",
  ].join(",");

  const blocks = new Map();

  const collect = () => {
    root.querySelectorAll(selector).forEach((element) => {
      const owner = element.parentElement?.closest(ownerSelector);
      if (owner) {
        return;
      }

      const text = normalize(element.textContent);
      if (!text && !element.querySelector("img")) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const y = rect.top + (scrollContainer.scrollTop || 0);
      const key = blockKey(element);
      const length = text.length;
      const previous = blocks.get(key);

      if (!previous || length > previous.length) {
        blocks.set(key, {
          html: element.outerHTML,
          y: previous ? Math.min(previous.y, y) : y,
          length,
        });
      } else if (previous && y < previous.y) {
        previous.y = y;
      }
    });
  };

  if (scrollContainer.scrollHeight > scrollContainer.clientHeight) {
    const max = scrollContainer.scrollHeight;
    const step = Math.max(200, (scrollContainer.clientHeight * 0.7) | 0);
    for (let offset = 0; offset <= max + step; offset += step) {
      scrollContainer.scrollTop = offset;
      await sleep(200);
      collect();
    }
    scrollContainer.scrollTop = 0;
    await sleep(200);
    collect();
  } else {
    collect();
  }

  const sorted = [...blocks.values()].sort((left, right) => left.y - right.y);

  const clean = (value) =>
    (value || "")
      .replace(/[\u200B\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const cleanUrl = (value) =>
    clean(value)
      .replace(/^[\$\s]+/, "")
      .replace(/[\$\s]+$/, "");

  const textFromNode = (element) => {
    let result = "";

    const walk = (node) => {
      if (!node) {
        return;
      }

      if (node.nodeType === 3) {
        result += node.textContent;
        return;
      }

      if (node.nodeType !== 1) {
        return;
      }

      const classes = node.classList;
      if (
        classes?.contains("sl-list-prefix") ||
        classes?.contains("sl-line-pocket")
      ) {
        return;
      }

      if (classes?.contains("sl-docfile")) {
        result += `📄 ${clean(node.querySelector(".file-title")?.textContent || "")} `;
        return;
      }

      if (classes?.contains("sl-link")) {
        const url = cleanUrl(node.textContent);
        if (/^https?:\/\//i.test(url)) {
          result += `[${url}](${url}) `;
          return;
        }
      }

      if (node.getAttribute?.("data-slate-string") === "true") {
        result += node.textContent;
        return;
      }

      node.childNodes?.forEach(walk);
    };

    walk(element);
    return clean(result);
  };

  const tableToMarkdown = (table) => {
    const rows = table.querySelectorAll("tr");
    if (!rows.length) {
      return "";
    }

    let output = "";
    rows.forEach((row, index) => {
      const cells = row.querySelectorAll("td,th");
      if (!cells.length) {
        return;
      }

      const values = [...cells].map((cell) => {
        const slateStrings = cell.querySelectorAll("[data-slate-string]");
        const cellText = slateStrings.length
          ? [...slateStrings].map((item) => item.textContent).join("")
          : cell.textContent;
        return clean(cellText).replace(/\|/g, "\\|");
      });

      output += `| ${values.join(" | ")} |\n`;
      if (index === 0) {
        output += `| ${values.map(() => "---").join(" | ")} |\n`;
      }
    });

    return `${output}\n`;
  };

  const codeToMarkdown = (block) => {
    const language = clean(
      block.querySelector(".code-language-label")?.textContent || ""
    ).toLowerCase();

    const lines = block.querySelectorAll(".sl-code-line");
    let code = "";

    if (lines.length) {
      lines.forEach((line) => {
        const slateStrings = line.querySelectorAll("[data-slate-string]");
        code += (
          slateStrings.length
            ? [...slateStrings].map((item) => item.textContent).join("")
            : line.textContent
        ).replace(/[\u200B\uFEFF]/g, "");
        code += "\n";
      });
    } else {
      code = `${(block.textContent || "").replace(/\s+$/, "")}\n`;
    }

    return `\`\`\`${language}\n${code}\`\`\`\n\n`;
  };

  const imageToMarkdown = (wrapper) => {
    const image = wrapper.tagName === "IMG" ? wrapper : wrapper.querySelector("img");
    const src = image?.src;
    if (!src || src.includes("data:")) {
      return "";
    }
    return `![image](${src})\n\n`;
  };

  const isList = (element) => element?.matches?.("ul,ol");

  const listToMarkdown = (list, indent = 0) => {
    const ordered = list.tagName === "OL";
    let index = 1;
    let output = "";

    [...list.children]
      .filter((child) => child.tagName === "LI")
      .forEach((item) => {
        const content = textFromNode(
          item.querySelector(".sl-list-item-content") || item
        ).replace(/^[•◦·\-\*\s]+\$?\s*/, "");

        output += `${"  ".repeat(indent)}${ordered ? `${index}. ` : "- "}${content}\n`;

        item
          .querySelectorAll("ul.sl-list-wrap,ol.sl-list-wrap,ul,ol")
          .forEach((nested) => {
            output += listToMarkdown(nested, indent + 1);
          });

        index += 1;
      });

    return `${output}\n`;
  };

  const isBlock = (element) =>
    element?.matches?.(
      "table,.sl-table,.sl-block-code-wrap,.sl-multi-column,.sl-highlight-block,.sl-foldable-block,.sl-image,.sl-paragraph,.sl-heading,ul,ol"
    );

  const directBlocks = (container) => {
    const output = [];

    const walk = (node) => {
      [...(node.children || [])].forEach((child) => {
        if (isBlock(child)) {
          output.push(child);
        } else {
          walk(child);
        }
      });
    };

    walk(container);
    return output;
  };

  const blockToMarkdown = (element) => {
    if (!element?.matches) {
      return "";
    }

    if (element.matches("table,.sl-table")) {
      return tableToMarkdown(element);
    }

    if (element.matches(".sl-block-code-wrap")) {
      return codeToMarkdown(element);
    }

    if (element.matches(".sl-image") || element.tagName === "IMG") {
      return imageToMarkdown(element);
    }

    if (isList(element)) {
      return listToMarkdown(element);
    }

    if (element.matches(".sl-multi-column")) {
      let output = "\n---\n";
      element.querySelectorAll(".sl-multi-column-item").forEach((column, index) => {
        output += `\n**[列${index + 1}]**\n\n`;
        const blocksInColumn = directBlocks(column);
        if (blocksInColumn.length) {
          blocksInColumn.forEach((block) => {
            output += blockToMarkdown(block);
          });
        } else {
          output += `${textFromNode(column) || ""}\n\n`;
        }
      });
      return `${output}---\n\n`;
    }

    if (element.matches(".sl-highlight-block")) {
      const nestedBlocks = directBlocks(element);
      if (!nestedBlocks.length) {
        return textFromNode(element) ? `> **${textFromNode(element)}**\n\n` : "";
      }

      let nested = "";
      nestedBlocks.forEach((block) => {
        nested += blockToMarkdown(block);
      });

      return (
        `${nested.trim()}`
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n") + "\n\n"
      );
    }

    if (element.matches(".sl-foldable-block")) {
      const summary = clean(
        element.querySelector(
          ".sl-foldable-block-title-input,.sl-foldable-block-header"
        )?.textContent || "折叠块"
      );

      let nested = "";
      directBlocks(element).forEach((block) => {
        if (!block.closest(".sl-foldable-block-header")) {
          nested += blockToMarkdown(block);
        }
      });

      return `\n<details><summary>${summary}</summary>\n\n${nested.trim()}\n\n</details>\n\n`;
    }

    if (element.matches(".sl-heading")) {
      return textFromNode(element) ? `## ${textFromNode(element)}\n\n` : "";
    }

    if (element.matches(".sl-paragraph")) {
      return textFromNode(element) ? `${textFromNode(element)}\n\n` : "";
    }

    return textFromNode(element) ? `${textFromNode(element)}\n\n` : "";
  };

  const blocksMarkdown = [];
  sorted.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = item.html;
    const element = wrapper.firstElementChild;
    if (element) {
      blocksMarkdown.push(blockToMarkdown(element));
    }
  });

  while (blocksMarkdown.length) {
    const firstBlock = blocksMarkdown[0]
      .replace(/^\s+|\s+$/g, "")
      .replace(/^##\s+/, "")
      .trim();
    if (firstBlock === title) {
      blocksMarkdown.shift();
      continue;
    }
    break;
  }

  let markdown = `# ${title}\n\n${blocksMarkdown.join("")}`;
  markdown = markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  markdown += "\n";

  return {
    title,
    markdown,
  };
})();
