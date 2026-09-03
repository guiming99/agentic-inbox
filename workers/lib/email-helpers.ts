// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared email helpers to eliminate duplication across API routes, MCP, and agent.
 *
 * Includes: DO stub helpers, sender validation, message-ID generation,
 * threading, HTML utilities, and tool-logic (getFullEmail / getFullThread).
 */
import type { MailboxDO } from "../durableObject";
import type { EmailFull } from "./schemas";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { formatQuotedDate } from "../../shared/dates";

// ── DO Stub ────────────────────────────────────────────────────────

/**
 * Resolve a MailboxDO stub from a mailbox email address.
 * Replaces the repeated 3-line ns.idFromName / ns.get pattern.
 */
export function getMailboxStub(
	env: Env,
	mailboxId: string,
): DurableObjectStub<MailboxDO> {
	const ns = env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	return ns.get(id);
}

// ── Mailbox Listing ────────────────────────────────────────────────

/**
 * List all mailboxes from R2 bucket metadata.
 */
export function listMailboxes(
	bucket: R2Bucket,
): Promise<{ id: string; email: string }[]> {
	return bucket.list({ prefix: "mailboxes/" }).then((list) => list.objects.map((obj) => {
		const id = obj.key.replace("mailboxes/", "").replace(".json", "");
		return { id, email: id };
	}));
}

// ── Sender Validation ──────────────────────────────────────────────

export function validateSender(
	to: string | string[],
	from: string | { email: string; name: string },
	mailboxId: string,
): { toStr: string; fromEmail: string; fromDomain: string } {
	const toStr = (Array.isArray(to) ? to.join(", ") : to).toLowerCase();
	const fromEmail = (typeof from === "string" ? from : from.email).toLowerCase();
	if (fromEmail !== mailboxId.toLowerCase()) throw new SenderValidationError("From address must match the mailbox email address");
	const fromDomain = fromEmail.split("@")[1];
	if (!fromDomain) throw new SenderValidationError("Invalid sender email address");
	return { toStr, fromEmail, fromDomain };
}

export class SenderValidationError extends Error {
	constructor(message: string) { super(message); this.name = "SenderValidationError"; }
}

// ── Message ID ─────────────────────────────────────────────────────

export function generateMessageId(fromDomain: string): { messageId: string; outgoingMessageId: string } {
	const messageId = crypto.randomUUID();
	const outgoingMessageId = `${messageId}@${fromDomain}`;
	return { messageId, outgoingMessageId };
}

// ── Threading ──────────────────────────────────────────────────────

export function buildReferencesChain(original: EmailFull): { originalMsgId: string; references: string[]; threadId: string } {
	const originalMsgId = original.message_id || original.id;
	let existingRefs: string[] = [];
	if (original.email_references) {
		try { existingRefs = JSON.parse(original.email_references); } catch {}
	}
	const references = [...existingRefs, originalMsgId].filter(Boolean);
	const threadId = original.thread_id || original.id;
	return { originalMsgId, references, threadId };
}

export function resolveThreadId(messageId: string, references: string[] = [], inReplyTo?: string | null): string {
	return references[0] || inReplyTo || messageId;
}

export function buildThreadingHeaders(originalMsgId: string, references: string[]): Record<string, string> {
	return { "In-Reply-To": `<${originalMsgId}>`, ...(references.length > 0 ? { References: references.map((r) => `<${r}>`).join(" ") } : {}) };
}

export async function resolveOriginalEmail(stub: DurableObjectStub<MailboxDO>, email: EmailFull): Promise<EmailFull> {
	if (email.folder_id === Folders.DRAFT && email.in_reply_to) {
		const realOriginal = (await stub.getEmail(email.in_reply_to)) as EmailFull | null;
		if (realOriginal) return realOriginal;
	}
	return email;
}

// ── HTML Utilities ─────────────────────────────────────────────────

export function escapeHtml(text: string): string {
	if (!text) return "";
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

export function textToHtml(text: string): string {
	if (!text) return "";
	const escaped = escapeHtml(text).replace(/\n/g, "<br>");
	return `<div style="white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Convert an HTML email into clean plain text.
 * Removes CSS/JS blocks, preserves meaningful line breaks, strips tags,
 * and decodes common/numeric HTML entities such as &nbsp; and &amp;.
 */
export function stripHtmlToText(html: string): string {
	if (!html) return "";
	let text = html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
		.replace(/<[^>]+>/g, " ");
	text = text.replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
		.replace(/&amp;|&#38;|&#x26;/gi, "&")
		.replace(/&lt;|&#60;|&#x3C;/gi, "<")
		.replace(/&gt;|&#62;|&#x3E;/gi, ">")
		.replace(/&quot;|&#34;|&#x22;/gi, '"')
		.replace(/&apos;|&#39;|&#x27;/gi, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text;
}

export const formatEmailDate = formatQuotedDate;

export function buildQuotedReplyBlock(original: { date?: string; sender?: string; body?: string }): string {
	if (!original.body) return "";
	const originalSender = escapeHtml(original.sender || "unknown");
	const originalDate = escapeHtml(formatEmailDate(original.date || ""));
	const plainBody = stripHtmlToText(original.body);
	const bodyToQuote = escapeHtml(plainBody).replace(/\n/g, "<br>");
	return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${originalDate}, ${originalSender} wrote:<br><br>${bodyToQuote}</blockquote>`;
}

// ── Tool Logic (getFullEmail / getFullThread) ──────────────────────

type MailboxThreadReaderStub = { getThreadEmails: (threadId: string) => Promise<EmailFull[]> };

export async function getFullEmail(stub: DurableObjectStub<MailboxDO>, emailId: string) {
	const email = (await stub.getEmail(emailId)) as EmailFull | null;
	if (!email) return null;
	const textBody = email.body ? stripHtmlToText(email.body) : "";
	return { ...email, body_text: textBody, body_html: email.body };
}

export async function getFullThread(stub: DurableObjectStub<MailboxDO>, threadId: string) {
	const threadStub = stub as unknown as MailboxThreadReaderStub;
	const emails = await threadStub.getThreadEmails(threadId);
	const enriched = emails.map((email) => ({ ...email, body_text: email.body ? stripHtmlToText(email.body) : "" }));
	enriched.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	return { thread_id: threadId, message_count: enriched.length, messages: enriched };
}
