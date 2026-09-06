(() => {
  "use strict";

  const TASK_ICON_HASH = "9e02c48663f5e509f05e08e9b220d30cb9263b41";
  const TEXT_ICON_HASH = "d38c9fe6b358eb214d9167a4585e09e221f1c1f2";
  const TASK_ICON = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M9 20.2441V22.6082C9 22.826 9.17109 22.9971 9.38883 22.9971H11.753C11.854 22.9971 11.9551 22.9582 12.0251 22.8804L20.5173 14.396L17.601 11.4798L9.11665 19.9642C9.03888 20.0419 9 20.1352 9 20.2441ZM22.7725 12.1408C23.0758 11.8375 23.0758 11.3476 22.7725 11.0443L20.9528 9.22454C20.6495 8.92125 20.1596 8.92125 19.8563 9.22454L18.4331 10.6477L21.3494 13.5639L22.7725 12.1408Z" fill="white"/>\n</svg>';
  const TEXT_ICON = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M17 21H9C8.45 21 8 21.45 8 22C8 22.55 8.45 23 9 23H17C17.55 23 18 22.55 18 22C18 21.45 17.55 21 17 21ZM23 13H9C8.45 13 8 13.45 8 14C8 14.55 8.45 15 9 15H23C23.55 15 24 14.55 24 14C24 13.45 23.55 13 23 13ZM9 19H23C23.55 19 24 18.55 24 18C24 17.45 23.55 17 23 17H9C8.45 17 8 17.45 8 18C8 18.55 8.45 19 9 19ZM8 10C8 10.55 8.45 11 9 11H23C23.55 11 24 10.55 24 10C24 9.45 23.55 9 23 9H9C8.45 9 8 9.45 8 10Z" fill="white"/>\n</svg>';
  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".pdf"];
  const MAX_TEX_SIZE = 5 * 1024 * 1024;
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  const MAX_TOTAL_SIZE = 60 * 1024 * 1024;
  const MAX_FILES = 100;

  const ui = {
    tex: document.querySelector("#tex-input"),
    fileInput: document.querySelector("#file-input"),
    fileName: document.querySelector("#file-name"),
    open: document.querySelector("#open-button"),
    clear: document.querySelector("#clear-button"),
    download: document.querySelector("#download-button"),
    status: document.querySelector("#status"),
    title: document.querySelector("#module-title"),
    taskCount: document.querySelector("#task-count"),
    textCount: document.querySelector("#text-count"),
    preview: document.querySelector("#task-preview"),
    message: document.querySelector("#message"),
    warnings: document.querySelector("#warnings"),
    warningsTitle: document.querySelector("#warnings-title"),
    warningsList: document.querySelector("#warnings-list"),
    attachmentCount: document.querySelector("#attachment-count"),
    fileChips: document.querySelector("#file-chips")
  };

  const state = {
    texFileName: "",
    attachments: [],
    fileWarnings: [],
    currentParse: null,
    loading: false,
    parseTimer: 0
  };

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripComments(source) {
    return source.split(/\r?\n/).map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let slashes = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashes += 1;
        if (slashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    }).join("\n");
  }

  function matchingBrace(text, opening, left = "{", right = "}") {
    let depth = 0;
    for (let pos = opening; pos < text.length; pos += 1) {
      const escaped = pos > 0 && text[pos - 1] === "\\";
      if (text[pos] === left && !escaped) depth += 1;
      if (text[pos] === right && !escaped) {
        depth -= 1;
        if (depth === 0) return pos;
      }
    }
    return -1;
  }

  function bracedArgument(text, command) {
    const match = new RegExp(escapeRegExp(command) + "\\s*\\{").exec(text);
    if (!match) throw new Error("Не найдена команда " + command + "{...}");
    const opening = match.index + match[0].lastIndexOf("{");
    const closing = matchingBrace(text, opening);
    if (closing < 0) throw new Error("Не закрыта команда " + command + "{...}");
    return { value: text.slice(opening + 1, closing), end: closing + 1 };
  }

  function replaceBracedCommand(text, name, transform) {
    const pattern = new RegExp("\\\\" + escapeRegExp(name) + "\\s*\\{", "g");
    let cursor = 0;
    while (cursor <= text.length) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(text);
      if (!match) return text;
      const opening = pattern.lastIndex - 1;
      const closing = matchingBrace(text, opening);
      if (closing < 0) return text;
      const replacement = transform(text.slice(opening + 1, closing));
      text = text.slice(0, match.index) + replacement + text.slice(closing + 1);
      cursor = match.index;
    }
    return text;
  }

  function replaceOldStyle(text, command, marker) {
    const pattern = new RegExp("\\{\\\\" + command + "\\b", "g");
    while (true) {
      const match = pattern.exec(text);
      if (!match) return text;
      const closing = matchingBrace(text, match.index);
      if (closing < 0) return text;
      const content = text.slice(pattern.lastIndex, closing).trim();
      text = text.slice(0, match.index) + marker + content + marker + text.slice(closing + 1);
      pattern.lastIndex = 0;
    }
  }

  function withoutMath(text) {
    return text
      .replace(/\$\$.*?\$\$/gs, "")
      .replace(/(?<!\\)\$(?:\\.|[^$])*?(?<!\\)\$/gs, "")
      .replace(/\\\[.*?\\\]|\\\(.*?\\\)/gs, "");
  }

  function uniqueMatches(text, pattern, group = 1) {
    return [...new Set([...text.matchAll(pattern)].map((match) => match[group]))].sort();
  }

  function diagnoseConverted(text, context, warnings) {
    const outside = withoutMath(text);
    const environments = uniqueMatches(outside, /\\(?:begin|end)\{([^}]+)\}/g);
    if (environments.length) warnings.push(context + ": осталось необработанное окружение LaTeX: " + environments.join(", "));

    const braced = uniqueMatches(outside, /\\([A-Za-z@]+)\s*\{/g);
    if (braced.length) warnings.push(context + ": после преобразования остались конструкции вида \\command{...}: " + braced.map((name) => "\\" + name).join(", "));

    const commands = new Set([...outside.matchAll(/\\([A-Za-z@]+)/g)].map((match) => match[1]));
    const retainedNames = new Set(["vspace", "hspace", "noindent", "raggedleft", "hfill", "label", "ref", "epigraph", "cancel", "rotatebox"]);
    const retained = [...commands].filter((name) => retainedNames.has(name)).sort();
    if (retained.length) warnings.push(context + ": оставлена без изменения разметка: " + retained.map((name) => "\\" + name).join(", "));

    const unknown = [...commands].filter((name) => !braced.includes(name) && !retainedNames.has(name) && name !== "begin" && name !== "end").sort();
    if (unknown.length) warnings.push(context + ": неизвестные команды вне математической формулы (возможно, опечатки): " + unknown.map((name) => "\\" + name).join(", "));

    const serviceNames = new Set(["documentclass", "usepackage", "requirepackage", "input", "include", "def", "newcommand", "renewcommand", "worksheet", "worksheetheader", "resetproblem", "begin", "end", "ifaltmain", "else", "fi", "begingroup", "endgroup"]);
    const suspicious = [...commands].filter((name) => serviceNames.has(name)).sort();
    if (suspicious.length) warnings.push(context + ": остались подозрительные служебные команды: " + suspicious.map((name) => "\\" + name).join(", "));
  }

  function latexToPlatform(input, context, warnings) {
    const footnotes = [];
    let text = replaceBracedCommand(input, "footnote", (value) => {
      footnotes.push(value.trim());
      return "";
    });

    for (const environment of ["equation*", "align*", "gather*", "multline*"]) {
      const pattern = new RegExp("\\\\begin\\{" + escapeRegExp(environment) + "\\}([\\s\\S]*?)\\\\end\\{" + escapeRegExp(environment) + "\\}", "g");
      text = text.replace(pattern, (_, inside) => {
        const converted = inside.replace(/&/g, " ").replace(/\\\\\s*/g, " ").trim();
        warnings.push(context + ": окружение " + environment + " заменено на $$...$$; выравнивание и переносы формулы удалены");
        return "\n$$" + converted + "$$\n";
      });
    }

    if (/\\begin\{(?:table|tabular)\}/.test(text)) {
      warnings.push(context + ": таблица не перенесена в архив");
      text = text.replace(/\\begin\{tabular\}(?:\{[^}]*\})?.*?\\end\{tabular\}/gs, "");
      text = text.replace(/\\begin\{table\}(?:\[[^\]]*\])?.*?\\end\{table\}/gs, "");
    }

    text = text.replace(/\\(?:ifaltmain|else|fi|endgroup)\b/g, "");
    text = text.replace(/^\s*%+\s*$/gm, "");
    text = text.replace(/\\begin\{minipage\}[^\n]*/g, "");
    text = text.replace(/\\begin\{(?:figure|center)\}(?:\[[^\]]*\])?/g, "");
    text = text.replace(/\\end\{(?:figure|center|minipage)\}/g, "");
    text = text.replace(/\\(?:centering|leavevmode|null|par|pagebreak|newpage|clearpage|resetproblem)\b/g, "");
    text = text.replace(/\\setproblem\s*\{[^{}]*\}/g, "");
    text = text.replace(/\\captionof\s*\{[^{}]*\}\s*\{[^{}]*\}/g, "");
    for (const command of ["caption", "captionof", "captionsetup"]) text = replaceBracedCommand(text, command, () => "");
    text = replaceBracedCommand(text, "textbf", (value) => "**" + value + "**");
    text = replaceBracedCommand(text, "emph", (value) => "*" + value + "*");
    text = replaceBracedCommand(text, "textit", (value) => "*" + value + "*");
    text = replaceBracedCommand(text, "claim", (value) => "**" + value.trim().replace(/\.+$/, "") + ".**");
    text = replaceOldStyle(text, "bf", "**");
    text = replaceOldStyle(text, "it", "*");
    text = text.replace(/\\subsection\*?\s*\{/g, "\\subsection{");
    text = replaceBracedCommand(text, "section", (value) => "\n**" + value.trim() + "**\n");
    text = replaceBracedCommand(text, "subsection", (value) => "\n**" + value.trim() + "**\n");

    const hrefPattern = /\\href\s*\{/g;
    while (true) {
      hrefPattern.lastIndex = 0;
      const match = hrefPattern.exec(text);
      if (!match) break;
      const firstOpen = hrefPattern.lastIndex - 1;
      const firstClose = matchingBrace(text, firstOpen);
      if (firstClose < 0) break;
      const secondMatch = /^\s*\{/.exec(text.slice(firstClose + 1));
      if (!secondMatch) break;
      const secondOpen = firstClose + secondMatch[0].length;
      const secondClose = matchingBrace(text, secondOpen);
      if (secondClose < 0) break;
      const url = text.slice(firstOpen + 1, firstClose);
      const label = text.slice(secondOpen + 1, secondClose);
      text = text.slice(0, match.index) + "[" + label + "](" + url + ")" + text.slice(secondClose + 1);
    }

    const listReplacement = (content, numbered) => {
      const parts = content.split(/^\s*\\item(?:\[[^\]]*\])?\s+/gm).slice(1).map((part) => part.trim());
      return "\n" + parts.map((part, index) => (numbered ? String(index + 1) + ". " : "* ") + part).join("\n") + "\n";
    };
    for (const [environment, numbered] of [["itemize", false], ["enumerate", true]]) {
      const pattern = new RegExp("\\\\begin\\{" + environment + "\\}([\\s\\S]*?)\\\\end\\{" + environment + "\\}", "g");
      let guard = 0;
      while (pattern.test(text) && guard < 100) {
        pattern.lastIndex = 0;
        text = text.replace(pattern, (_, content) => listReplacement(content, numbered));
        guard += 1;
      }
    }

    text = text.replace(/\\\((.*?)\\\)/gs, (_, value) => "$" + value + "$");
    text = text.replace(/\\\[(.*?)\\\]/gs, (_, value) => "$$" + value + "$$");
    text = text.replace(/\\'\{([A-Za-zА-Яа-яЁё])\}/g, (_, letter) => letter + "\u0301");
    text = text.replace(/\\(?:ldots|dots)\b/g, "…");
    const marker = "\u0000CHEOPS_IMAGE_ALIGNMENT\u0000";
    text = text.replace(/:--:/g, marker);
    text = text.replace(/~---/g, "\u00a0—").replace(/~--/g, "\u00a0–").replace(/~/g, "\u00a0");
    text = text.replace(/---/g, "—").replace(/--/g, "–");
    text = text.replaceAll(marker, ":--:");
    text = text.replace(/<<\s*(.*?)\s*>>/gs, "«$1»");
    text = text.replace(/\\\\\s*/g, " ");
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (footnotes.length) {
      const notes = footnotes.map((note) => "<small>Примечание: " + latexToPlatform(note, context + " — сноска", warnings) + "</small>").join(" ");
      text = text.trimEnd() + "\n\n" + notes;
    }
    text = text.trim();
    diagnoseConverted(text, context, warnings);
    return text;
  }

  function normalizeLabel(label) {
    return label.trim().replace(/\$/g, "").replace(/\^\s*\\?star/g, "*").replace(/\^\*/g, "*");
  }

  function problemEvents(block) {
    const token = /\\begin\{([^}]+)\}|\\end\{([^}]+)\}|^\s*\\(?:itemy\s*\{|item\s*(?:\[|\b)|setproblem\s*\{)/gm;
    const rawEvents = [];
    let depth = 0;
    let match;
    while ((match = token.exec(block)) !== null) {
      if (match[1]) {
        depth += 1;
        continue;
      }
      if (match[2]) {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth) continue;
      const raw = match[0].trim();
      if (raw.startsWith("\\setproblem")) {
        const opening = block.indexOf("{", match.index);
        const closing = matchingBrace(block, opening);
        if (opening >= 0 && closing >= 0) rawEvents.push({ type: "set", label: normalizeLabel(block.slice(opening + 1, closing)), position: closing + 1 });
        continue;
      }
      let label = null;
      let contentStart = token.lastIndex;
      if (raw.startsWith("\\itemy")) {
        const opening = block.indexOf("{", match.index);
        const closing = matchingBrace(block, opening);
        label = normalizeLabel(block.slice(opening + 1, closing));
        contentStart = closing + 1;
      } else if (raw.includes("[")) {
        const opening = block.indexOf("[", match.index);
        const closing = block.indexOf("]", opening + 1);
        label = normalizeLabel(block.slice(opening + 1, closing));
        contentStart = closing + 1;
      }
      rawEvents.push({ type: "item", label, position: match.index, contentStart });
    }

    return rawEvents.map((event, index) => {
      if (event.type === "set") return event;
      const later = rawEvents.slice(index + 1).find((candidate) => candidate.type === "item" || candidate.type === "set");
      const end = later ? later.position : block.length;
      return { type: "item", label: event.label, item: block.slice(event.contentStart, end).trim(), position: event.position };
    });
  }

  function splitSubproblems(item) {
    const pattern = /\\(?:(subproblemx)(\*)?|(subproblemy)|(subproblem)|(subprobpem))(?=\s|\{|$)\s*(?:\{([^{}]*)\})?/g;
    const matches = [...item.matchAll(pattern)];
    if (!matches.length) return { prefix: item, parts: [] };
    const prefix = item.slice(0, matches[0].index).trim();
    const parts = matches.map((match, index) => {
      const end = index + 1 < matches.length ? matches[index + 1].index : item.length;
      return {
        explicit: match[6] ? normalizeLabel(match[6]) : null,
        starred: Boolean(match[1] && match[2]),
        content: item.slice(match.index + match[0].length, end).trim()
      };
    });
    return { prefix, parts };
  }

  function fileExtension(name) {
    const match = /\.[^.]+$/.exec(name);
    return match ? match[0].toLowerCase() : "";
  }

  function basename(rawName) {
    return rawName.replace(/\\/g, "/").split("/").pop();
  }

  function findImage(rawName, lazy, attachments) {
    const requested = basename(rawName);
    const hasExtension = Boolean(fileExtension(requested));
    const names = lazy || !hasExtension ? IMAGE_EXTENSIONS.map((extension) => requested + extension) : [requested];
    for (const name of names) {
      const found = attachments.find((attachment) => attachment.name.toLowerCase() === name.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  function parseTex(rawSource, attachments = []) {
    const source = stripComments(rawSource.replace(/^\uFEFF/, ""));
    const titleResult = bracedArgument(source, "\\worksheet");
    const worksheetCount = (source.match(/\\worksheet\s*\{/g) || []).length;
    if (worksheetCount > 1) throw new Error("Обнаружено несколько команд \\worksheet в одном файле");
    const warnings = [];
    const title = titleResult.value.trim();
    diagnoseConverted(title, "название листочка", warnings);
    let body = source.slice(titleResult.end);
    const documentEnd = body.indexOf("\\end{document}");
    if (documentEnd >= 0) body = body.slice(0, documentEnd);

    body = body.replace(/\\begin\{figure\}(?:\[[^\]]*\])?.*?\\end\{figure\}/gs, (figure) => {
      const count = (figure.match(/\\(?:includegraphics|lazyfigure)\b/g) || []).length;
      if (count > 1) {
        warnings.push("блок из нескольких изображений не перенесён в архив");
        return "";
      }
      return figure;
    });

    const imageFiles = new Map();
    const missing = [];
    body = body.replace(/\\(includegraphics|lazyfigure)(?:\[([^\]]*)\])?\{([^}]+)\}/g, (_, kind, options, rawNameValue) => {
      const rawName = rawNameValue.trim();
      const lazy = kind === "lazyfigure";
      const candidate = findImage(rawName, lazy, attachments);
      if (!candidate) {
        if (lazy) warnings.push("изображение из \\lazyfigure{" + rawName + "} не найдено и не вставлено");
        else missing.push(rawName);
        return "";
      }
      if (candidate.extension === ".pdf") {
        warnings.push("изображение " + candidate.name + ": PDF не вставлен в архив");
        return "";
      }
      if (lazy) warnings.push("команда \\lazyfigure{" + rawName + "} обработана как обычное изображение");
      imageFiles.set(candidate.digest, candidate);
      return '\n\n:--:<img src="/noo-back/content/_image/' + candidate.digest + '" width="400" />';
    });
    if (missing.length) throw new Error("Не найдены изображения: " + missing.join(", "));

    const elements = [];
    let taskNumber = 0;
    let cursor = 0;
    let problemsCount = 0;
    const problemsPattern = /\\begin\{problems?\}([\s\S]*?)\\end\{problems?\}/g;
    let problems;
    while ((problems = problemsPattern.exec(body)) !== null) {
      problemsCount += 1;
      const theory = latexToPlatform(body.slice(cursor, problems.index), "теория", warnings);
      if (theory) elements.push({ kind: "text", caption: "Теория", content: theory });
      let nextNumber = null;
      for (const event of problemEvents(problems[1])) {
        if (event.type === "set") {
          nextNumber = event.label;
          continue;
        }
        let numberLabel;
        if (event.label) {
          numberLabel = event.label;
          if (/^\d+$/.test(event.label)) taskNumber = Number(event.label);
        } else if (nextNumber) {
          numberLabel = nextNumber;
          if (/^\d+$/.test(nextNumber)) taskNumber = Number(nextNumber);
          nextNumber = null;
        } else {
          taskNumber += 1;
          numberLabel = String(taskNumber);
        }

        let item = event.item;
        let split = splitSubproblems(item);
        const imageTags = item.match(/:--:<img\s+[^>]+\/>/g) || [];
        if (imageTags.length) {
          item = item.replace(/\s*:--:<img\s+[^>]+\/>/g, "");
          split = splitSubproblems(item);
        }

        if (split.parts.length) {
          if (split.prefix) split.parts[0].content = split.prefix + " " + split.parts[0].content;
          split.parts.forEach((part, index) => {
            let letter = part.explicit || String.fromCharCode("а".charCodeAt(0) + index);
            if (part.starred && !letter.endsWith("*")) letter += "*";
            let content = part.content;
            if (index === 0 && imageTags.length) content += "\n\n" + imageTags.join("\n");
            const description = "**Задача " + numberLabel + letter + ".** " + latexToPlatform(content, "задача " + numberLabel + letter, warnings);
            elements.push({ kind: "task", caption: "", content: description });
          });
        } else {
          if (imageTags.length) item += "\n\n" + imageTags.join("\n");
          const description = "**Задача " + numberLabel + ".** " + latexToPlatform(item, "задача " + numberLabel, warnings);
          elements.push({ kind: "task", caption: "", content: description });
        }
      }
      cursor = problemsPattern.lastIndex;
    }

    const tail = latexToPlatform(body.slice(cursor), "теория после задач", warnings);
    if (tail) elements.push({ kind: "text", caption: "Теория", content: tail });
    if (!problemsCount || !elements.some((element) => element.kind === "task")) {
      throw new Error("Не найдено ни одного окружения \\begin{problems} ... \\end{problems}; архив не создан");
    }
    return { title, elements, imageFiles, warnings: [...new Set(warnings)] };
  }

  function buildInfo(parsed) {
    const moduleId = 1;
    const blockId = "2";
    let nextId = 3;
    const addElement = [];
    const tasks = [];
    const texts = [];
    const scorer = [];
    const timeout = [];
    const advanced = [];
    const tries = [];
    const penalty = [];

    for (const element of parsed.elements) {
      const objectId = nextId;
      const versionId = nextId + 1;
      nextId += 2;
      const icon = element.kind === "task" ? TASK_ICON_HASH : TEXT_ICON_HASH;
      addElement.push({ elements: [{ type: element.kind, id: versionId }], icon, section: "ordinary", block: blockId });
      if (element.kind === "text") {
        texts.push({ id: objectId, versionId, caption: element.caption, content: element.content, items: [] });
      } else {
        const task = {
          id: objectId,
          versionId,
          description: element.content,
          type: ["detailed"],
          answersData: [{ comment: "", areFilesAllowed: true }],
          solution: [{ ordering: false, text: [[" "]] }],
          solutionToShow: [0],
          explanations: [],
          hints: [],
          videos: [],
          section: "ordinary"
        };
        tasks.push({ usualTask: [task, []] });
        scorer.push({ elementVersionId: versionId, elementScorerParams: { alg: { exactMatchParams: { score: 1 } }, scorers: [{ exactMatchParams: { score: 1 } }] } });
        timeout.push({ versionId });
        advanced.push({ versionId, isAdvanced: false });
        tries.push({ versionId });
        penalty.push({ versionId });
      }
    }

    const imageHashNameMap = { [TASK_ICON_HASH]: "task.svg", [TEXT_ICON_HASH]: "text.svg" };
    for (const [digest, attachment] of parsed.imageFiles) imageHashNameMap[digest] = digest + attachment.extension;
    return {
      moduleInfo: {
        name: parsed.title,
        groups: [],
        addElement,
        lecturers: [],
        items: [],
        setScorer: scorer,
        setTimeout: timeout,
        setIsAdvanced: advanced,
        setMaxTries: tries,
        setHintsPenalty: penalty,
        block: [[{ id: blockId, level: 0, position: 1 }]]
      },
      task: tasks,
      video: [],
      text: texts,
      infoTaskItems: [],
      infoVideoItems: [],
      infoTextItems: [],
      infoModuleItems: [],
      lecturersInfo: [],
      imageHashNameMap,
      id: moduleId,
      trainings: []
    };
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function concatenate(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    const stamp = dosDateTime(new Date());
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const local = new Uint8Array(30);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      localView.setUint16(28, 0, true);
      localParts.push(local, name, data);

      const central = new Uint8Array(46);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 0x0314, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0x81a40000, true);
      centralView.setUint32(42, offset, true);
      centralParts.push(central, name);
      offset += local.length + name.length + data.length;
    }
    const centralDirectory = concatenate(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, offset, true);
    return concatenate([...localParts, centralDirectory, end]);
  }

  function rotateLeft(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  function sha1Fallback(bytes) {
    const totalLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const message = new Uint8Array(totalLength);
    message.set(bytes);
    message[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const view = new DataView(message.buffer);
    view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(totalLength - 4, bitLength >>> 0, false);
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    const words = new Uint32Array(80);
    for (let chunk = 0; chunk < totalLength; chunk += 64) {
      for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(chunk + index * 4, false);
      for (let index = 16; index < 80; index += 1) words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      for (let index = 0; index < 80; index += 1) {
        let f;
        let k;
        if (index < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (index < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (index < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const temp = (rotateLeft(a, 5) + f + e + k + words[index]) >>> 0;
        e = d;
        d = c;
        c = rotateLeft(b, 30);
        b = a;
        a = temp;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, "0")).join("");
  }

  async function sha1(bytes) {
    if (window.crypto && window.crypto.subtle) {
      const digest = await window.crypto.subtle.digest("SHA-1", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return sha1Fallback(bytes);
  }

  function plural(count, one, few, many) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function setStatus(text, kind = "") {
    ui.status.className = "status" + (kind ? " " + kind : "");
    ui.status.lastElementChild.textContent = text;
  }

  function showMessage(text = "", kind = "error") {
    ui.message.textContent = text;
    ui.message.className = "message" + (text ? " visible " + kind : "");
  }

  function renderWarnings(warnings) {
    ui.warningsList.replaceChildren();
    if (!warnings.length) {
      ui.warnings.classList.remove("visible");
      return;
    }
    ui.warnings.classList.add("visible");
    ui.warningsTitle.textContent = warnings.length + " " + plural(warnings.length, "предупреждение", "предупреждения", "предупреждений");
    for (const warning of warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      ui.warningsList.append(item);
    }
  }

  function updateFilesUi() {
    const imageCount = state.attachments.length;
    const texLabel = state.texFileName || (ui.tex.value.trim() ? "вставленный текст" : "TeX не выбран");
    ui.fileName.textContent = texLabel + " · " + (imageCount ? imageCount + " " + plural(imageCount, "изображение", "изображения", "изображений") : "изображений нет");
    ui.attachmentCount.textContent = String(imageCount);
    ui.fileChips.replaceChildren();
    if (!imageCount) {
      const empty = document.createElement("span");
      empty.className = "attachments-empty";
      empty.textContent = "PNG, JPG и SVG можно выбрать вместе с TeX.";
      ui.fileChips.append(empty);
      return;
    }
    state.attachments.forEach((attachment, index) => {
      const chip = document.createElement("span");
      chip.className = "file-chip";
      const name = document.createElement("span");
      name.className = "file-chip-name";
      name.textContent = attachment.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.dataset.index = String(index);
      remove.setAttribute("aria-label", "Убрать " + attachment.name);
      remove.textContent = "×";
      chip.append(name, remove);
      ui.fileChips.append(chip);
    });
  }

  function safeParse() {
    if (!ui.tex.value.trim()) return { parsed: null, error: "" };
    try {
      return { parsed: parseTex(ui.tex.value, state.attachments), error: "" };
    } catch (error) {
      return { parsed: null, error: error instanceof Error ? error.message : "Не удалось разобрать TeX." };
    }
  }

  function render() {
    updateFilesUi();
    const result = safeParse();
    state.currentParse = result.parsed;
    const parsed = result.parsed;
    const tasks = parsed ? parsed.elements.filter((element) => element.kind === "task") : [];
    const texts = parsed ? parsed.elements.filter((element) => element.kind === "text") : [];
    ui.title.textContent = parsed ? parsed.title : "Пока не найдено";
    ui.taskCount.textContent = String(tasks.length);
    ui.textCount.textContent = String(texts.length);
    ui.preview.replaceChildren();

    if (!parsed) {
      const empty = document.createElement("div");
      empty.className = "empty-preview";
      empty.textContent = ui.tex.value.trim() ? "Содержимое пока не распознано." : "Здесь появится краткая проверка содержимого архива.";
      ui.preview.append(empty);
    } else {
      let taskIndex = 0;
      for (const element of parsed.elements) {
        if (element.kind === "task") taskIndex += 1;
        const row = document.createElement("div");
        row.className = "task-item";
        const number = document.createElement("span");
        number.className = "task-number";
        number.textContent = element.kind === "task" ? String(taskIndex) : "Т";
        const text = document.createElement("span");
        text.className = "task-text";
        text.textContent = element.content;
        row.append(number, text);
        ui.preview.append(row);
      }
    }

    const warnings = [...new Set([...state.fileWarnings, ...(parsed ? parsed.warnings : [])])];
    renderWarnings(warnings);
    if (state.loading) {
      setStatus("Готовлю выбранные файлы…");
      showMessage();
    } else if (!ui.tex.value.trim()) {
      setStatus("Ожидаю исходник");
      showMessage();
    } else if (result.error) {
      setStatus("Нужно проверить исходник", "error");
      showMessage(result.error);
    } else {
      setStatus("Готово · " + tasks.length + " " + plural(tasks.length, "задача", "задачи", "задач"), "success");
      showMessage();
    }
    ui.download.disabled = state.loading || !parsed;
  }

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (files.length > MAX_FILES) {
      showMessage("Можно добавить не более " + MAX_FILES + " файлов за один раз.");
      return;
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) {
      showMessage("Общий размер выбранных файлов превышает 60 МБ.");
      return;
    }
    const texFiles = files.filter((file) => file.name.toLowerCase().endsWith(".tex"));
    if (texFiles.some((file) => file.size > MAX_TEX_SIZE)) {
      showMessage("Размер TeX-файла не должен превышать 5 МБ.");
      return;
    }
    if (files.some((file) => file.size > MAX_FILE_SIZE)) {
      showMessage("Размер одного файла не должен превышать 25 МБ.");
      return;
    }

    state.loading = true;
    state.fileWarnings = [];
    render();
    try {
      if (texFiles.length > 1) state.fileWarnings.push("выбрано несколько TeX-файлов; использован " + texFiles[0].name);
      if (texFiles.length) {
        ui.tex.value = await texFiles[0].text();
        state.texFileName = texFiles[0].name;
      }
      const imageFiles = files.filter((file) => IMAGE_EXTENSIONS.includes(fileExtension(file.name)));
      const unsupported = files.filter((file) => !file.name.toLowerCase().endsWith(".tex") && !IMAGE_EXTENSIONS.includes(fileExtension(file.name)));
      if (unsupported.length) state.fileWarnings.push("неподдерживаемые файлы пропущены: " + unsupported.map((file) => file.name).join(", "));
      const prepared = await Promise.all(imageFiles.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { name: file.name, extension: fileExtension(file.name), bytes, digest: await sha1(bytes) };
      }));
      for (const attachment of prepared) {
        const existing = state.attachments.findIndex((item) => item.name.toLowerCase() === attachment.name.toLowerCase());
        if (existing >= 0) state.attachments.splice(existing, 1, attachment);
        else state.attachments.push(attachment);
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Не удалось прочитать выбранные файлы.");
    } finally {
      state.loading = false;
      ui.fileInput.value = "";
      render();
    }
  }

  function downloadArchive() {
    try {
      const parsed = parseTex(ui.tex.value, state.attachments);
      const root = "ModuleVersionId 1";
      const archiveFiles = [
        { name: root + "/info.json", data: JSON.stringify(buildInfo(parsed)) },
        { name: root + "/img/" + TASK_ICON_HASH + ".svg", data: TASK_ICON },
        { name: root + "/img/" + TEXT_ICON_HASH + ".svg", data: TEXT_ICON }
      ];
      for (const [digest, attachment] of parsed.imageFiles) archiveFiles.push({ name: root + "/img/" + digest + attachment.extension, data: attachment.bytes });
      const archive = zipStore(archiveFiles);
      const blob = new Blob([archive], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = state.texFileName ? state.texFileName.replace(/\.tex$/i, "") + ".zip" : "module.zip";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const tasks = parsed.elements.filter((element) => element.kind === "task").length;
      const texts = parsed.elements.filter((element) => element.kind === "text").length;
      showMessage("Архив собран: " + tasks + " " + plural(tasks, "задача", "задачи", "задач") + ", " + texts + " " + plural(texts, "элемент теории", "элемента теории", "элементов теории") + ".", "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Не удалось собрать архив.");
    }
  }

  ui.tex.addEventListener("input", () => {
    window.clearTimeout(state.parseTimer);
    state.parseTimer = window.setTimeout(render, 120);
  });
  ui.open.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", () => addFiles(ui.fileInput.files));
  ui.download.addEventListener("click", downloadArchive);
  ui.clear.addEventListener("click", () => {
    ui.tex.value = "";
    ui.fileInput.value = "";
    state.texFileName = "";
    state.attachments = [];
    state.fileWarnings = [];
    render();
    ui.tex.focus();
  });
  ui.fileChips.addEventListener("click", (event) => {
    const button = event.target.closest(".chip-remove");
    if (!button) return;
    state.attachments.splice(Number(button.dataset.index), 1);
    render();
  });

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove("dragging");
    }
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("dragging");
    addFiles(event.dataTransfer.files);
  });

  if (window.__CHEOPS_TEST__) {
    window.__cheopsConverter = { stripComments, matchingBrace, bracedArgument, latexToPlatform, problemEvents, splitSubproblems, parseTex, buildInfo, zipStore, sha1Fallback, TASK_ICON, TEXT_ICON, TASK_ICON_HASH, TEXT_ICON_HASH };
  }
  render();
})();
