import { Node } from "@tiptap/core";

/**
 * Tiptap/ProseMirror normally discards arbitrary inline CSS from generic spans.
 * These two nodes make the signature layout part of the editor schema so the
 * horizontal QR/logo layout survives setContent() -> getHTML().
 */
export const SignatureAsset = Node.create({
	name: "signatureAsset",
	inline: true,
	group: "inline",
	atom: true,
	selectable: false,

	addAttributes() {
		return {
			kind: { default: "social" },
			src: { default: "" },
			alt: { default: "" },
			label: { default: "" },
			cid: { default: null },
		};
	},

	parseHTML() {
		return [
			{
				tag: 'span[data-signature-asset]',
				getAttrs: (node) => {
					const element = node as HTMLElement;
					const image = element.querySelector("img");
					const label = element.querySelector("[data-signature-label]");
					const kind = element.getAttribute("data-signature-asset") || "social";
					return {
						kind,
						src: image?.getAttribute("src") || "",
						alt: image?.getAttribute("alt") || "",
						label:
							label?.textContent?.trim() ||
							element.getAttribute("data-signature-label") ||
							"",
						cid: image?.getAttribute("data-cid") || null,
					};
				},
			},
		];
	},

	renderHTML({ node }) {
		const isLogo = node.attrs.kind === "logo";
		const label = node.attrs.label || "";
		const imageAttrs: Record<string, string> = {
			src: node.attrs.src || "",
			alt: node.attrs.alt || "",
			style: isLogo
				? "display:block;max-width:140px;max-height:80px;width:auto;height:auto;object-fit:contain;margin:0 auto;"
				: "display:block;width:64px;height:64px;max-width:64px;max-height:64px;object-fit:contain;margin:0 auto;",
		};
		if (!isLogo) {
			imageAttrs.width = "64";
			imageAttrs.height = "64";
		}
		if (node.attrs.cid) imageAttrs["data-cid"] = node.attrs.cid;

		const outerStyle = isLogo
			? "display:inline-block;vertical-align:top;width:140px;margin:0 32px 0 0;padding:0;text-align:center;line-height:1.2;white-space:nowrap;"
			: "display:inline-block;vertical-align:top;width:96px;margin:0 32px 0 0;padding:0;text-align:center;line-height:1.2;white-space:nowrap;";

		return [
			"span",
			{
				"data-signature-asset": node.attrs.kind || "social",
				"data-signature-label": label,
				style: outerStyle,
			},
			["img", imageAttrs],
			...(label ? [["span", { "data-signature-label": "", style: "display:block;font-size:11px;line-height:16px;margin-top:4px;text-align:center;white-space:nowrap;" }, label]] : []),
		];
	},
});

export const SignatureRow = Node.create({
	name: "signatureRow",
	group: "block",
	content: "signatureAsset*",
	isolating: true,
	defining: true,

	parseHTML() {
		return [{ tag: 'p[data-signature-row="true"]' }, { tag: 'div[data-signature-row="true"]' }];
	},

	renderHTML() {
		return [
			"div",
			{
				"data-signature-row": "true",
				style: "margin:10px 0 0;padding:0;line-height:normal;white-space:nowrap;display:block;font-size:0;",
			},
			0,
		];
	},
});
