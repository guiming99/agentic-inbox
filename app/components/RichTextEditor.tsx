// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	ImageIcon,
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListNumbersIcon,
	MinusIcon,
	QuotesIcon,
	TableIcon,
	TextBIcon,
	TextItalicIcon,
	TextStrikethroughIcon,
	TextUnderlineIcon,
} from "@phosphor-icons/react";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, type ClipboardEvent, type DragEvent } from "react";
import { SignatureAsset, SignatureRow } from "./SignatureLayout";
import { TableExtensions } from "./TableExtensions";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
}

const MAX_INLINE_IMAGE_SIZE = 8 * 1024 * 1024;

function cssLength(value: string | null) {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^\d+(?:\.\d+)?(?:px|pt|in|cm|mm|%)$/i.test(trimmed)) return trimmed;
	if (/^\d+(?:\.\d+)?$/i.test(trimmed)) return `${trimmed}px`;
	return null;
}

function normalizeOfficeCellStyle(element: HTMLElement) {
	const styles = new Map<string, string>();
	const add = (name: string, value: string | null | undefined) => {
		if (value) styles.set(name, value.trim());
	};

	const style = element.getAttribute("style") || "";
	for (const declaration of style.split(";")) {
		const separator = declaration.indexOf(":");
		if (separator <= 0) continue;
		const name = declaration.slice(0, separator).trim().toLowerCase();
		const value = declaration.slice(separator + 1).trim();
		if (!value) continue;
		if (["mso-border-alt", "mso-border-insideh", "mso-border-insidev", "mso-padding-alt"].includes(name)) continue;
		if (name === "mso-char-indent-count" || name === "mso-line-height-rule") continue;
		add(name, value);
	}

	add("width", cssLength(element.getAttribute("width")) || styles.get("width"));
	add("height", cssLength(element.getAttribute("height")) || styles.get("height"));
	add("text-align", element.getAttribute("align") || styles.get("text-align"));
	add("vertical-align", element.getAttribute("valign") || styles.get("vertical-align"));
	const bg = element.getAttribute("bgcolor");
	if (bg) add("background-color", bg);

	const color = element.getAttribute("color");
	if (color) add("color", color);

	const font = element.getAttribute("face");
	if (font) add("font-family", font);
	const size = element.getAttribute("size");
	if (size && !styles.has("font-size")) {
		const points = ({ "1": 8, "2": 10, "3": 12, "4": 14, "5": 18, "6": 24, "7": 36 } as Record<string, number>)[size];
		if (points) add("font-size", `${points}pt`);
	}

	const border = element.getAttribute("border");
	if (border && !styles.has("border")) add("border", `${border}px solid #808080`);

	if (styles.size) element.setAttribute("style", Array.from(styles.entries()).map(([name, value]) => `${name}: ${value}`).join("; "));
	else element.removeAttribute("style");

	for (const attribute of Array.from(element.attributes)) {
		const name = attribute.name.toLowerCase();
		if (name === "class" || name.startsWith("data-") || name.startsWith("mso-") || name === "width" || name === "height" || name === "align" || name === "valign" || name === "bgcolor" || name === "color" || name === "face" || name === "size" || name === "border") {
			element.removeAttribute(attribute.name);
		}
	}
}

function normalizePastedTableHtml(html: string) {
	const document = new DOMParser().parseFromString(html, "text/html");
	document.querySelectorAll("style, meta, link, xml, o\\:p, v\\:*").forEach((node) => node.remove());
	document.querySelectorAll("comment").forEach((node) => node.remove());

	const table = document.querySelector("table");
	if (!table) return null;

	const colgroup = table.querySelector("colgroup");
	colgroup?.querySelectorAll("col").forEach((col) => {
		const width = cssLength(col.getAttribute("width"));
		if (width) col.setAttribute("style", `width: ${width}`);
		col.removeAttribute("class");
		col.removeAttribute("width");
	});

	for (const row of Array.from(table.querySelectorAll("tr"))) {
		for (const cell of Array.from(row.querySelectorAll("td, th"))) {
			const element = cell as HTMLElement;
			const colspan = Number.parseInt(element.getAttribute("colspan") || "1", 10);
			const rowspan = Number.parseInt(element.getAttribute("rowspan") || "1", 10);
			if (colspan > 1) element.setAttribute("colspan", String(colspan));
			else element.removeAttribute("colspan");
			if (rowspan > 1) element.setAttribute("rowspan", String(rowspan));
			else element.removeAttribute("rowspan");
			normalizeOfficeCellStyle(element);
		}
	}

	const tableElement = table as HTMLElement;
	normalizeOfficeCellStyle(tableElement);
	const tableStyle = tableElement.getAttribute("style") || "";
	tableElement.setAttribute("style", `${tableStyle}${tableStyle && !tableStyle.endsWith(";") ? ";" : ""} border-collapse: collapse;`);
	return table.outerHTML;
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
	const imageInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor({
		extensions: [
			StarterKit,
			SignatureAsset,
			SignatureRow,
			...TableExtensions,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage.configure({ allowBase64: true }),
			TextStyle,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class: "prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-sm [&_table]:border-collapse [&_td]:align-top [&_th]:align-top",
			},
		},
		onUpdate: ({ editor }) => onChange(editor.getHTML()),
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			const rafId = requestAnimationFrame(() => { if (!editor.isDestroyed) editor.commands.focus("start"); });
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor]);

	const insertImageFile = useCallback(async (file: File) => {
		if (!editor || !file.type.startsWith("image/")) return;
		if (file.size > MAX_INLINE_IMAGE_SIZE) {
			window.alert(`Image is too large. Please use an image smaller than ${MAX_INLINE_IMAGE_SIZE / (1024 * 1024)}MB.`);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result !== "string" || editor.isDestroyed) return;
			editor.chain().focus().setImage({ src: reader.result, alt: file.name }).run();
		};
		reader.readAsDataURL(file);
	}, [editor]);

	const insertSelectedImages = useCallback((files: FileList | null) => {
		if (!files?.length) return;
		for (const file of Array.from(files)) void insertImageFile(file);
	}, [insertImageFile]);

	const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
		const html = event.clipboardData.getData("text/html");
		const pastedTable = html ? normalizePastedTableHtml(html) : null;
		if (pastedTable && editor) {
			event.preventDefault();
			event.stopPropagation();
			editor.chain().focus().insertContent(pastedTable).run();
			return;
		}
		const image = Array.from(event.clipboardData.items).map((item) => item.kind === "file" ? item.getAsFile() : null).find((file): file is File => Boolean(file?.type.startsWith("image/")));
		if (!image) return;
		event.preventDefault();
		event.stopPropagation();
		void insertImageFile(image);
	}, [editor, insertImageFile]);

	const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
		const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
		if (!imageFiles.length) return;
		event.preventDefault();
		void Promise.all(imageFiles.map(insertImageFile));
	}, [insertImageFile]);

	const setLink = useCallback(() => {
		if (!editor) return;
		const previousUrl = editor.getAttributes("link").href;
		const url = window.prompt("URL", previousUrl);
		if (url === null) return;
		if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
		else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}, [editor]);

	const insertTable = useCallback(() => {
		if (!editor) return;
		const rows = Number(window.prompt("Rows", "3"));
		if (!Number.isInteger(rows) || rows < 1 || rows > 20) return;
		const cols = Number(window.prompt("Columns", "3"));
		if (!Number.isInteger(cols) || cols < 1 || cols > 10) return;
		editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
	}, [editor]);

	if (!editor) return null;
	const tableEditingAvailable = editor.can().addRowAfter();

	return (
		<div className="rounded-lg border border-kumo-line overflow-hidden flex flex-col h-full">
			<div className="flex flex-wrap items-center gap-0.5 bg-kumo-recessed px-2 py-1.5 border-b border-kumo-line shrink-0">
				<Tooltip content="Bold" side="bottom" asChild><Button variant={editor.isActive("bold") ? "secondary" : "ghost"} shape="square" size="sm" icon={<TextBIcon size={16} />} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold" /></Tooltip>
				<Tooltip content="Italic" side="bottom" asChild><Button variant={editor.isActive("italic") ? "secondary" : "ghost"} shape="square" size="sm" icon={<TextItalicIcon size={16} />} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic" /></Tooltip>
				<Tooltip content="Underline" side="bottom" asChild><Button variant={editor.isActive("underline") ? "secondary" : "ghost"} shape="square" size="sm" icon={<TextUnderlineIcon size={16} />} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline" /></Tooltip>
				<Tooltip content="Strikethrough" side="bottom" asChild><Button variant={editor.isActive("strike") ? "secondary" : "ghost"} shape="square" size="sm" icon={<TextStrikethroughIcon size={16} />} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough" /></Tooltip>
				<div className="mx-1 h-5 w-px bg-kumo-fill" />
				<Tooltip content="Bullet list" side="bottom" asChild><Button variant={editor.isActive("bulletList") ? "secondary" : "ghost"} shape="square" size="sm" icon={<ListBulletsIcon size={16} />} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list" /></Tooltip>
				<Tooltip content="Numbered list" side="bottom" asChild><Button variant={editor.isActive("orderedList") ? "secondary" : "ghost"} shape="square" size="sm" icon={<ListNumbersIcon size={16} />} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list" /></Tooltip>
				<div className="mx-1 h-5 w-px bg-kumo-fill" />
				<Tooltip content="Blockquote" side="bottom" asChild><Button variant={editor.isActive("blockquote") ? "secondary" : "ghost"} shape="square" size="sm" icon={<QuotesIcon size={16} />} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Blockquote" /></Tooltip>
				<Tooltip content="Link" side="bottom" asChild><Button variant={editor.isActive("link") ? "secondary" : "ghost"} shape="square" size="sm" icon={<LinkSimpleIcon size={16} />} onClick={setLink} aria-label="Link" /></Tooltip>
				{editor.isActive("link") && <Tooltip content="Remove link" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<LinkBreakIcon size={16} />} onClick={() => editor.chain().focus().unsetLink().run()} aria-label="Remove link" /></Tooltip>}
				<Tooltip content="Insert image" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ImageIcon size={16} />} onClick={() => imageInputRef.current?.click()} aria-label="Insert image" /></Tooltip>
				<input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { insertSelectedImages(event.target.files); event.currentTarget.value = ""; }} />
				<Tooltip content="Insert table" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<TableIcon size={16} />} onClick={insertTable} aria-label="Insert table" /></Tooltip>
				{tableEditingAvailable && <>
					<Tooltip content="Add row" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" onClick={() => editor.chain().focus().addRowAfter().run()} aria-label="Add row">+R</Button></Tooltip>
					<Tooltip content="Add column" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" onClick={() => editor.chain().focus().addColumnAfter().run()} aria-label="Add column">+C</Button></Tooltip>
					<Tooltip content="Delete row" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" onClick={() => editor.chain().focus().deleteRow().run()} aria-label="Delete row">−R</Button></Tooltip>
					<Tooltip content="Delete column" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" onClick={() => editor.chain().focus().deleteColumn().run()} aria-label="Delete column">−C</Button></Tooltip>
					<Tooltip content="Delete table" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" onClick={() => editor.chain().focus().deleteTable().run()} aria-label="Delete table">×T</Button></Tooltip>
				</>}
				<Tooltip content="Horizontal rule" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<MinusIcon size={16} />} onClick={() => editor.chain().focus().setHorizontalRule().run()} aria-label="Horizontal rule" /></Tooltip>
				<div className="mx-1 h-5 w-px bg-kumo-fill" />
				<Tooltip content="Undo" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowCounterClockwiseIcon size={16} />} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} aria-label="Undo" /></Tooltip>
				<Tooltip content="Redo" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowClockwiseIcon size={16} />} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} aria-label="Redo" /></Tooltip>
			</div>
			<div className="flex-1 overflow-y-auto" onPasteCapture={handlePaste} onDrop={handleDrop} onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }}>
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
