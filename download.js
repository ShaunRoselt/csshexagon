const types = {
    html: "text/html",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    psd: "image/vnd.adobe.photoshop",
    pdf: "application/pdf",
};

const status = document.getElementById("downloadStatus");
const toggle = document.getElementById("downloadToggle");
const menu = document.getElementById("downloadMenu");
let preparing = false;
let encodeWebP;

function escapeXML(value) {
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "\ufffd")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function makeTextDownload(format) {
    const css = document.getElementById("layHexagonCodeCSS").textContent;
    if (format === "css") return new Blob([css], { type: types.css });
    const html = document.getElementById("layHexagonCodeHTML").textContent;
    const page = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CSS Hexagon</title>
    <style>
        body { margin: 2rem 1rem; font-family: system-ui, sans-serif; }
        ${css.replace(/<(?=\/style)/gi, "\\3c ")}
    </style>
</head>
<body>
    ${html}
</body>
</html>
`;
    return new Blob([page], { type: types.html });
}

function pointsFor(outline, width, height, insetX = 0, insetY = 0) {
    return outline.slice("polygon(".length, -1).split(",").map(point => {
        const [x, y] = point.trim().split(/\s+/).map(parseFloat);
        return `${insetX + x / 100 * (width - 2 * insetX)},${insetY + y / 100 * (height - 2 * insetY)}`;
    }).join(" ");
}

function readDesign(hover = false) {
    const style = document.documentElement.style;
    const prefix = hover ? "--hexagon-hover-" : "--hexagon-";
    const inputPrefix = hover ? "hexagonHover" : "hexagon";
    const setting = name => style.getPropertyValue(prefix + name);
    const number = name => parseFloat(setting(name));
    const outline = setting("outline");
    const width = number("width");
    const height = number("height") + 2 * number("margin-top");
    const border = number("border-width");
    const insetX = border * number("border-scale-x");
    const insetY = border * number("border-scale-y");
    const shadow = setting("shadow-color").match(/[\d.]+/g).map(Number);
    const text = document.getElementById("layHexagonText");
    const textStyle = getComputedStyle(text);

    return {
        width,
        height,
        outline,
        insetX,
        insetY,
        borderOpacity: Number(border > 0),
        borderColor: setting("border-color"),
        color: setting("color"),
        imageURL: window.getImageURL(inputPrefix + "ImageURL"),
        gradient: window.getGradient(inputPrefix),
        borderGradient: window.getGradient(inputPrefix + "Border"),
        textGradient: window.getGradient(inputPrefix + "Text"),
        shadowGradient: window.getGradient(inputPrefix + "Shadow"),
        shadowColor: `rgb(${shadow.slice(0, 3).join(",")})`,
        shadowOpacity: shadow[3],
        shadowBlur: number("shadow-blur") / 2,
        text: text.textContent,
        textColor: document.getElementById(inputPrefix + "TextColor").value,
        textSize: number("span-text-size"),
        textWidth: number("span-width"),
        fontFamily: textStyle.fontFamily,
    };
}

async function decodeImage(source) {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
}

async function embedBackground(url) {
    try {
        const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        const dataURL = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        await decodeImage(dataURL);
        return dataURL;
    } catch {
        throw new Error("The background image could not be embedded. Try HTML or a different image URL.");
    }
}

function textMarkup(design) {
    if (!design.text.trim() || !design.textSize) return "";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = `${design.textSize}px ${design.fontFamily}`;
    const lines = [];
    let line = "";
    for (const word of design.text.trim().split(/\s+/)) {
        const candidate = line ? line + " " + word : word;
        if (line && context.measureText(candidate).width > design.textWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    lines.push(line);
    const x = design.width / 2;
    const lineHeight = design.textSize * 1.5;
    const y = design.height / 2 - (lines.length - 1) * lineHeight / 2;
    let fill = design.textColor;
    let definition = "";
    if (design.textGradient) {
        const width = Math.max(...lines.map(line => context.measureText(line).width));
        const height = lines.length * lineHeight;
        definition = svgGradient(design.textGradient, "hexagon-text-gradient", x - width / 2, y - lineHeight / 2, width, height);
        fill = "url(#hexagon-text-gradient)";
    }
    return `${definition ? `<defs>${definition}</defs>` : ""}
    <text text-anchor="middle" dominant-baseline="central" font-family="${escapeXML(design.fontFamily)}"
        font-size="${design.textSize}" fill="${fill}">
        ${lines.map((value, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${escapeXML(value)}</tspan>`).join("")}
    </text>`;
}

function imageBounds(...designs) {
    const width = Math.max(...designs.map(design => design.width));
    const height = Math.max(...designs.map(design => design.height));
    if (!(width > 0 && height > 0)) throw new Error("Set a hexagon size greater than zero to download an image.");
    const blur = designs.some(design => design.shadowOpacity > 0)
        ? Math.max(...designs.map(design => design.shadowBlur))
        : 0;
    const pad = Math.ceil(blur * 3);
    return { width: width + 2 * pad, height: height + 2 * pad, pad };
}

function svgGradient(gradient, id, left, top, width, height) {
    const radians = gradient.angle * Math.PI / 180;
    const dx = Math.sin(radians);
    const dy = -Math.cos(radians);
    const halfLength = (width * Math.abs(dx) + height * Math.abs(dy)) / 2;
    const x = left + width / 2;
    const y = top + height / 2;
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" color-interpolation="sRGB"
        x1="${x - dx * halfLength}" y1="${y - dy * halfLength}"
        x2="${x + dx * halfLength}" y2="${y + dy * halfLength}">
        <stop offset="0" stop-color="${gradient.start}"/>
        <stop offset="1" stop-color="${gradient.end}"/>
    </linearGradient>`;
}

function svgFrame(design, image, bounds, layer = "Composite") {
    const { width, height, outline, insetX, insetY, shadowBlur, shadowColor, shadowOpacity } = design;
    const outer = pointsFor(outline, width, height);
    const inner = pointsFor(outline, width, height, insetX, insetY);
    const left = (width - bounds.width) / 2;
    const top = -bounds.pad;
    const hasShadow = shadowBlur > 0 && shadowOpacity > 0 && ["Composite", "Shadow"].includes(layer);
    const gradientShadow = hasShadow && design.shadowGradient;
    const borderPaint = design.borderGradient ? "url(#hexagon-border-gradient)" : design.borderColor;
    const parts = {
        Border: design.borderOpacity
            ? `<polygon points="${outer}" fill="${borderPaint}" opacity="${design.borderOpacity}"/>`
            : "",
        Fill: `<polygon points="${inner}" fill="${design.gradient ? "url(#hexagon-gradient)" : design.color}"/>`,
        Image: image ? `<image href="${escapeXML(image)}" x="${insetX}" y="${insetY}" width="${Math.max(0, width - 2 * insetX)}"
            height="${Math.max(0, height - 2 * insetY)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#hexagon-fill)"/>` : "",
        Text: ["Composite", "Shadow", "Text"].includes(layer) ? textMarkup(design) : "",
    };
    const content = layer === "Shadow" && gradientShadow ? "" : layer === "Border"
        ? `<path d="${polygonPath(outer)} ${polygonPath(inner)}" fill-rule="evenodd" fill="${borderPaint}"/>`
        : ["Composite", "Shadow"].includes(layer) ? Object.values(parts).join("\n") : parts[layer];
    const shadow = gradientShadow
        ? `<feGaussianBlur stdDeviation="${shadowBlur}"/>`
        : layer === "Shadow"
        ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${shadowBlur}" result="blur"/>
            <feFlood flood-color="${shadowColor}" flood-opacity="${shadowOpacity}"/>
            <feComposite in2="blur" operator="in"/>`
        : `<feDropShadow dx="0" dy="0" stdDeviation="${shadowBlur}" flood-color="${shadowColor}" flood-opacity="${shadowOpacity}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}"
        viewBox="${left} ${top} ${bounds.width} ${bounds.height}">
    <defs>
        ${design.gradient ? svgGradient(design.gradient, "hexagon-gradient", insetX, insetY, width - 2 * insetX, height - 2 * insetY) : ""}
        ${design.borderGradient ? svgGradient(design.borderGradient, "hexagon-border-gradient", 0, 0, width, height) : ""}
        ${gradientShadow ? svgGradient(gradientShadow, "hexagon-shadow-gradient", 0, 0, width, height) : ""}
        ${image ? `<clipPath id="hexagon-fill"><polygon points="${inner}"/></clipPath>` : ""}
        ${hasShadow ? `<filter id="hexagon-shadow" filterUnits="userSpaceOnUse" x="${left}" y="${top}"
            width="${bounds.width}" height="${bounds.height}" color-interpolation-filters="sRGB">${shadow}</filter>` : ""}
    </defs>
    ${gradientShadow ? `<polygon points="${outer}" fill="url(#hexagon-shadow-gradient)" filter="url(#hexagon-shadow)" opacity="${shadowOpacity}"/>` : ""}
    <g${hasShadow && !gradientShadow ? ' filter="url(#hexagon-shadow)"' : ""}>
        ${content}
    </g>
</svg>`;
    return new Blob([svg], { type: types.svg });
}

async function makeSVG() {
    const design = readDesign();
    const bounds = imageBounds(design);
    const image = design.imageURL ? await embedBackground(design.imageURL) : "";
    return { ...bounds, blob: svgFrame(design, image, bounds) };
}

async function fallbackWebP(context, width, height) {
    try {
        if (!encodeWebP) {
            const packageURL = "https://cdn.jsdelivr.net/npm/@jsquash/webp@1.5.0/";
            const encoder = await import(packageURL + "encode.js/+esm");
            await encoder.init({ locateFile: file => packageURL + "codec/enc/" + file });
            encodeWebP = encoder.default;
        }
        const pixels = context.getImageData(0, 0, width, height);
        return new Blob([await encodeWebP(pixels, { quality: 95 })], { type: types.webp });
    } catch {
        throw new Error("The WebP encoder could not run. Choose PNG instead.");
    }
}

async function drawFrame(context, blob, width, height) {
    const source = URL.createObjectURL(blob);
    try {
        const image = await decodeImage(source);
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        context.drawImage(image, 0, 0, width, height);
    } finally {
        URL.revokeObjectURL(source);
    }
}

function imageCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    return canvas;
}

async function rasterize({ blob, width, height }, format) {
    const canvas = imageCanvas(width, height);
    const context = canvas.getContext("2d");
    await drawFrame(context, blob, width, height);
    const raster = await new Promise(resolve => canvas.toBlob(resolve, types[format], 0.95));
    if (format === "webp" && raster?.type !== types.webp) {
        return fallbackWebP(context, canvas.width, canvas.height);
    }
    if (!raster) throw new Error("The image could not be encoded.");
    return raster;
}

function transitionProgress(time, duration) {
    if (time >= duration) return 1;
    const bezier = (t, p1, p2) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
    const progress = time / duration;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 12; step++) {
        const mid = (low + high) / 2;
        if (bezier(mid, 0.25, 0.25) < progress) low = mid;
        else high = mid;
    }
    return bezier((low + high) / 2, 0.1, 1);
}

function transitionFrame(general, hover, progress, textProgress) {
    const value = (key, amount = progress) => general[key] + (hover[key] - general[key]) * amount;
    const color = (key, amount = progress) => `color-mix(in srgb, ${general[key]} ${100 * (1 - amount)}%, ${hover[key]})`;
    return {
        ...hover,
        width: value("width"),
        height: value("height"),
        insetX: value("insetX"),
        insetY: value("insetY"),
        borderOpacity: value("borderOpacity"),
        borderColor: color("borderColor"),
        color: color("color"),
        shadowColor: color("shadowColor"),
        shadowOpacity: value("shadowOpacity"),
        shadowBlur: value("shadowBlur"),
        textColor: color("textColor", textProgress),
        textSize: value("textSize", textProgress),
        textWidth: value("textWidth", textProgress),
    };
}

async function makeGIF() {
    const general = readDesign();
    const hover = document.getElementById("hexagonHover").checked ? readDesign(true) : null;
    const duration = document.getElementById("hexagonHoverTransition").valueAsNumber * 1000;
    const textDuration = document.getElementById("hexagonHoverTextTransition").valueAsNumber * 1000;
    const bounds = hover ? imageBounds(general, hover) : imageBounds(general);
    const generalImagePromise = general.imageURL ? embedBackground(general.imageURL) : Promise.resolve("");
    const hoverImagePromise = !hover?.imageURL ? Promise.resolve("") :
        hover.imageURL === general.imageURL ? generalImagePromise : embedBackground(hover.imageURL);

    const [generalImage, hoverImage, encoder] = await Promise.all([
        generalImagePromise,
        hoverImagePromise,
        import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm").catch(() => {
            throw new Error("The GIF encoder could not load. Try again or choose PNG.");
        }),
    ]);
    const { GIFEncoder, quantize, applyPalette } = encoder;
    const canvas = imageCanvas(bounds.width, bounds.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const gif = GIFEncoder();
    const writeFrame = async (design, image, delay) => {
        await drawFrame(context, svgFrame(design, image, bounds), bounds.width, bounds.height);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const format = "rgba4444";
        const palette = quantize(data, 256, { format, oneBitAlpha: true });
        const transparentIndex = palette.findIndex(color => color[3] === 0);
        if (transparentIndex > 0) palette.unshift(palette.splice(transparentIndex, 1)[0]);
        const pixels = applyPalette(data, palette, format);
        gif.writeFrame(pixels, canvas.width, canvas.height, {
            palette, delay, transparent: transparentIndex >= 0, transparentIndex: 0, dispose: 2, repeat: hover ? 0 : -1,
        });
    };
    const total = Math.max(duration, textDuration);
    const steps = Math.ceil(total / 100);
    const delay = steps > 0 ? total / steps : 0;
    await writeFrame(general, generalImage, hover ? 500 + delay : 0);
    if (hover) {
        for (let step = 1; step < steps; step++) {
            const time = step * delay;
            const frame = transitionFrame(general, hover, transitionProgress(time, duration), transitionProgress(time, textDuration));
            await writeFrame(frame, hoverImage, delay);
        }
        await writeFrame(hover, hoverImage, 700);
    }
    gif.finish();
    return new Blob([gif.bytesView()], { type: types.gif });
}

function polygonPath(points) {
    return "M " + points.split(" ").join(" L ") + " Z";
}

async function documentStates() {
    const states = [{ name: "General", design: readDesign() }];
    if (document.getElementById("hexagonHover").checked) {
        states.push({ name: "Hover", design: readDesign(true) });
    }
    const images = new Map();
    return Promise.all(states.map(async state => {
        const { imageURL } = state.design;
        if (imageURL && !images.has(imageURL)) images.set(imageURL, embedBackground(imageURL));
        return { ...state, image: imageURL ? await images.get(imageURL) : "" };
    }));
}

function hasShadow(design) {
    return design.shadowBlur > 0 && design.shadowOpacity > 0;
}

async function makePSD() {
    const [states, { writePsd }] = await Promise.all([
        documentStates(),
        import("https://cdn.jsdelivr.net/npm/ag-psd@34.2.3/+esm"),
    ]);
    const bounds = imageBounds(...states.map(state => state.design));
    const canvas = imageCanvas(bounds.width, bounds.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = async (state, layer) => {
        await drawFrame(context, svgFrame(state.design, state.image, bounds, layer), bounds.width, bounds.height);
        return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const children = [];
    for (const state of states) {
        const { design, image } = state;
        const names = [];
        if (design.text.trim() && design.textSize) names.push("Text");
        if (image) names.push("Image");
        names.push("Fill");
        if (design.borderOpacity) names.push("Border");
        if (hasShadow(design)) names.push("Shadow");
        const layers = [];
        for (const name of names) layers.push({ name, imageData: await pixels(state, name) });
        children.unshift({ name: state.name, hidden: state.name === "Hover", opened: true, children: layers });
    }
    const imageData = await pixels(states[0], "Composite");
    const psd = writePsd({ width: canvas.width, height: canvas.height, imageData, children }, { trimImageData: true });
    return new Blob([psd], { type: types.psd });
}

async function makePDF() {
    const [states, { PDFDocument, rgb }] = await Promise.all([
        documentStates(),
        import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"),
    ]);
    const pdf = await PDFDocument.create();
    const bounds = imageBounds(...states.map(state => state.design));
    const scale = 72 / 96;
    const width = bounds.width * scale;
    const height = bounds.height * scale;
    const renderScale = 2;
    const canvas = imageCanvas(bounds.width * renderScale, bounds.height * renderScale);
    const context = canvas.getContext("2d");
    const paint = color => rgb(...color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255));
    for (const { design, image } of states) {
        const page = pdf.addPage([width, height]);
        const drawLayer = async layer => {
            await drawFrame(context, svgFrame(design, image, bounds, layer),
                bounds.width * renderScale, bounds.height * renderScale);
            const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
            const embedded = await pdf.embedPng(await png.arrayBuffer());
            page.drawImage(embedded, {
                x: 0, y: height - canvas.height * scale / renderScale,
                width: canvas.width * scale / renderScale, height: canvas.height * scale / renderScale,
            });
        };
        if (hasShadow(design)) await drawLayer("Shadow");
        const position = { x: (bounds.width - design.width) / 2 * scale, y: height - bounds.pad * scale, scale };
        const { outline, width: shapeWidth, height: shapeHeight, insetX, insetY } = design;
        if (design.borderOpacity && design.borderGradient) {
            await drawLayer("Border");
        } else if (design.borderOpacity) {
            page.drawSvgPath(polygonPath(pointsFor(outline, shapeWidth, shapeHeight)), { ...position, color: paint(design.borderColor) });
        }
        if (design.gradient) {
            await drawLayer("Fill");
        } else {
            page.drawSvgPath(polygonPath(pointsFor(outline, shapeWidth, shapeHeight, insetX, insetY)), { ...position, color: paint(design.color) });
        }
        if (image) await drawLayer("Image");
        if (design.text.trim() && design.textSize) await drawLayer("Text");
    }
    return new Blob([await pdf.save()], { type: types.pdf });
}

function saveFile(blob, format) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hexagon.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

toggle.addEventListener("shown.bs.menu", () => {
    if (document.activeElement === toggle) menu.querySelector("[role=menuitem]").focus();
});

menu.addEventListener("click", async event => {
    const format = event.target.closest("[data-format]")?.dataset.format;
    if (!format) return;
    toggle.focus();
    if (preparing) return;
    preparing = true;
    status.textContent = "Preparing download…";
    try {
        let blob;
        if (format === "html" || format === "css") {
            blob = makeTextDownload(format);
        } else if (format === "gif") {
            blob = await makeGIF();
        } else if (format === "psd") {
            blob = await makePSD();
        } else if (format === "pdf") {
            blob = await makePDF();
        } else {
            const svg = await makeSVG();
            blob = format === "svg" ? svg.blob : await rasterize(svg, format);
        }
        saveFile(blob, format);
        status.textContent = "";
    } catch (error) {
        status.textContent = error.message || "The download could not be prepared.";
    } finally {
        preparing = false;
    }
});
