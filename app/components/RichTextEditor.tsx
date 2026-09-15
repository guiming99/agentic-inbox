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

export default function RichTextEditor({
	value,
	onChange,
}: RichTextEditorProps) {
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
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-kumo-line [&_blockquote]:pl-3 [&_blockquote]:text-kumo-subtle [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-sm [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-kumo-line [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-kumo-line [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-semibold [&_th]:bg-kumo-recessed",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) editor.commands.focus("start");
			});
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
		const image = Array.from(event.clipboardData.items)
			.map((item) => item.kind === "file" ? item.getAsFile() : null)
			.find((file): file is File => Boolean(file?.type.startsWith("image/")));
		if (!image) return;
		event.preventDefault();
		void insertImageFile(image);
	}, [insertImageFile]);

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
		if (url === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
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
			<div className="flex-1 overflow-y-auto" onPaste={handlePaste} onDrop={handleDrop} onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }}>
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
