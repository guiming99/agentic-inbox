// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/LICENSE-2.0

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

export function getMailboxStub(env: Env, mailboxId: string): DurableObjectStub<MailboxDO> {
	const ns = env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	return ns.get(id);
}

export async function listMailboxes(bucket: R2Bucket): Promise<{ id: string; email: string }[]> {
	const list = await bucket.list({ prefix: "mailboxes/" });
	return list.objects.map((obj) => {
		const id = obj.key.replace("mailboxes/", "").replace(".json", "");
		return { id, email: id };
	});
}

export function validateSender(to: string | string[], from: string | { email: string; name: string }, mailboxId: string): { toStr: string; fromEmail: string; fromDomain: string } {
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

export function generateMessageId(fromDomain: string): { messageId: string; outgoingMessageId: string } {
	const messageId = crypto.randomUUID();
	return { messageId, outgoingMessageId: `${messageId}@${fromDomain}` };
}

// ── Threading ──────────────────────────────────────────────────────

export function buildReferencesChain(original: EmailFull): { originalMsgId: string; references: string[]; threadId: string } {
	const originalMsgId = original.message_id || original.id;
	let existingRefs: string[] = [];
	if (original.email_references) {
		try { existingRefs = JSON.parse(original.email_references); } catch {}
	}
	const references = [...existingRefs, originalMsgId].filter(Boolean);
	return { originalMsgId, references, threadId: original.thread_id || original.id };
}

/**
 * Resolve a conversation thread id using RFC email threading headers.
 * Priority: References[0] -> In-Reply-To -> current Message-ID.
 */
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

export function escapeHtml(text: string): string {
	if (!text) return "";
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function textToHtml(text: string): string { return `<div style="white-space:pre-wrap">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`; }
export function stripHtmlToText(html: string): string { return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
export const formatEmailDate = formatQuotedDate;

export function buildQuotedReplyBlock(original: { date?: string; sender?: string; body?: string }): string {
	if (!original.body) return "";
	return `<br><blockquote>On ${escapeHtml(formatEmailDate(original.date || ""))}, ${escapeHtml(original.sender || "unknown")} wrote:<br><br>${escapeHtml(stripHtmlToText(original.body)).replace(/\n/g, "<br>")}</blockquote>`;
}

type MailboxThreadReaderStub = { getThreadEmails: (threadId: string) => Promise<EmailFull[]> };
export async function getFullEmail(stub: DurableObjectStub<MailboxDO>, emailId: string) {
	const email = (await stub.getEmail(emailId)) as EmailFull | null;
	if (!email) return null;
	return { ...email, body_text: email.body ? stripHtmlToText(email.body) : "", body_html: email.body };
}

export async function getFullThread(stub: DurableObjectStub<MailboxDO>, threadId: string) {
	const emails = await (stub as unknown as MailboxThreadReaderStub).getThreadEmails(threadId);
	return { thread_id: threadId, message_count: emails.length, messages: emails.map((email) => ({ ...email, body_text: email.body ? stripHtmlToText(email.body) : "" })) };
}
