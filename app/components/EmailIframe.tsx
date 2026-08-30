// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "~/types";

interface EmailIframeProps {
	body: string;
	mailboxId?: string;
	emailId?: string;
	attachments?: Attachment[];
	autoSize?: boolean;
}

function attachmentUrl(mailboxId: string, emailId: string, attachmentId: string) {
	return `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, { credentials: "include" });
		if (!response.ok) return null;
		const blob = await response.blob();
		if (!blob.type.startsWith("image/")) return null;
		return await blobToDataUrl(blob);
	} catch {
		return null;
	}
}

function absoluteUrl(url: string) {
	if (typeof window === "undefined") return url;
	try {
		return new URL(url, window.location.origin).href;
	} catch {
		return url;
	}
}

/**
 * Prepare the email synchronously for the first paint. Inline/CID images are
 * converted to authenticated API URLs, but are NOT fetched before the iframe
 * is displayed. Image bytes are fetched afterwards and pushed into the
 * already-visible iframe via postMessage.
 */
function prepareEmailBody(
	body: string,
	mailboxId?: string,
	emailId?: string,
	attachments?: Attachment[],
) {
	if (!body) return { body, imageUrls: [] as string[] };

	let result = body;
	const imageUrls = new Set<string>();

	if (mailboxId && emailId && attachments?.length) {
		for (const att of attachments) {
			if (!att.content_id) continue;
			const cid = att.content_id.replace(/^<|>$/g, "").trim();
			if (!cid) continue;
			const url = absoluteUrl(attachmentUrl(mailboxId, emailId, att.id));
			const escapedCid = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const re = new RegExp(`cid:\\s*<?${escapedCid}>?`, "gi");
			if (re.test(result)) {
				result = result.replace(re, url);
				imageUrls.add(url);
			}
		}

		for (const att of attachments) {
			if (att.disposition !== "inline" || !att.filename) continue;
			const url = absoluteUrl(attachmentUrl(mailboxId, emailId, att.id));
			const escapedName = att.filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const re = new RegExp(`(<img\\b[^>]*\\balt=["'])${escapedName}(["'][^>]*\\bsrc=["'])cid:[^"']+(["'])`, "gi");
			if (re.test(result)) {
				result = result.replace(re, `$1${att.filename}$2${url}$3`);
				imageUrls.add(url);
			}
		}
	}

	const apiImageRe = /(?:src|background)=["']((?:https?:\/\/[^"'\s]+)?\/api\/v1\/mailboxes\/[^"'\s]+\/emails\/[^"'\s]+\/attachments\/[^"'\s]+)["']/gi;
	for (const match of result.matchAll(apiImageRe)) imageUrls.add(absoluteUrl(match[1]));

	return { body: result, imageUrls: [...imageUrls] };
}

export default function EmailIframe({ body, mailboxId, emailId, attachments, autoSize }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	const handleMessage = useCallback((event: MessageEvent) => {
		if (!autoSize || event.source !== iframeRef.current?.contentWindow) return;
		if (event.data && typeof event.data === "object" && event.data.__emailIframeHeight && typeof event.data.height === "number" && event.data.height > 0) setHeight(event.data.height);
	}, [autoSize]);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || !body) return;
		let cancelled = false;

		const { body: preparedBody, imageUrls } = prepareEmailBody(body, mailboxId, emailId, attachments);
		const cleanBody = DOMPurify.sanitize(preparedBody, {
			USE_PROFILES: { html: true },
			FORBID_TAGS: ["style"],
			ADD_ATTR: ["target", "data-email-src"],
			FORCE_BODY: true,
		});
		const imageUrlJson = JSON.stringify(imageUrls).replace(/</g, "\\u003c");
		const padding = autoSize ? "0" : "24px";
		const heightScript = autoSize ? `<script>function reportHeight(){var h=document.body.scrollHeight;if(h>0)parent.postMessage({__emailIframeHeight:true,height:h},"*");}reportHeight();setTimeout(reportHeight,50);setTimeout(reportHeight,150);setTimeout(reportHeight,400);<\/script>` : "";
		const imageScript = `<script>(function(){var transparent="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";var urls=${imageUrlJson};var nodes=document.querySelectorAll("img[src], [background]");nodes.forEach(function(el){var src=el.getAttribute("src")||el.getAttribute("background");if(src&&urls.indexOf(src)>=0){el.setAttribute("data-email-src",src);if(el.tagName==="IMG")el.setAttribute("src",transparent);else el.setAttribute("background",transparent);}});window.addEventListener("message",function(e){var data=e.data;if(!data||data.__emailImages!==true||!data.images)return;Object.keys(data.images).forEach(function(src){var nodes=document.querySelectorAll('[data-email-src="'+CSS.escape(src)+'"]');nodes.forEach(function(el){var value=data.images[src];if(el.tagName==="IMG")el.setAttribute("src",value);else el.setAttribute("background",value);});});setTimeout(function(){parent.postMessage({__emailIframeHeight:true,height:document.body.scrollHeight},"*");},0);});})();<\/script>`;

		iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; script-src 'unsafe-inline';"><style>*{box-sizing:border-box}html{background:#fff;color-scheme:light}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;background:#fff;padding:${padding};margin:0;word-wrap:break-word;overflow-wrap:break-word;${autoSize ? "overflow:hidden;" : ""}}[style*="position: fixed"],[style*="position:fixed"],[style*="position: absolute"],[style*="position:absolute"]{position:relative!important}a{color:#2563eb}img{max-width:100%;height:auto}blockquote{border-left:3px solid #d1d5db;padding-left:1em;margin-left:0;color:#6b7280}pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px}table{border-collapse:collapse;max-width:100%}td,th{padding:4px 8px}p{margin:4px 0}h1,h2,h3{margin:8px 0 4px}ul,ol{padding-left:20px;margin:4px 0}</style></head><body>${cleanBody}${imageScript}${heightScript}</body></html>`;

		if (imageUrls.length) {
			void Promise.all(
				imageUrls.map(async (url) => [url, await fetchImageAsDataUrl(url)] as const),
			).then((entries) => {
				if (cancelled || !iframeRef.current?.contentWindow) return;
				const images: Record<string, string> = {};
				for (const [url, dataUrl] of entries) if (dataUrl) images[url] = dataUrl;
				if (Object.keys(images).length) iframeRef.current.contentWindow.postMessage({ __emailImages: true, images }, "*");
			});
		}

		return () => { cancelled = true; };
	}, [body, mailboxId, emailId, attachments, autoSize]);

	return <iframe ref={iframeRef} className="block w-full border-0" style={autoSize ? { height: `${height}px` } : { height: "100%" }} sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation" title="Email content" />;
}
