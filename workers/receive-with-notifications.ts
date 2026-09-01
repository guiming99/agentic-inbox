import PostalMime from "postal-mime";
import { receiveEmail } from "./index";
import type { Env } from "./types";
import { getPostDeliverySettings, runPostDelivery, type DeliveredEmail } from "./lib/post-delivery";

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;
const ARCHIVE_MARKER_PREFIX = "system/archive-forwarded/";

type ForwardableEvent = {
	raw: ReadableStream;
	rawSize: number;
	to?: string;
	forward?: (target: string) => Promise<void>;
	canBeForwarded?: boolean;
};

async function readRaw(stream: ReadableStream, size: number): Promise<Uint8Array> {
	if (size > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${size} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (size <= 0) throw new Error(`Invalid stream size: ${size}`);
	const result = new Uint8Array(size);
	let offset = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (offset + value.length > size) {
			await reader.cancel();
			throw new Error("Incoming email stream exceeds declared size");
		}
		result.set(value, offset);
		offset += value.length;
	}
	return result.subarray(0, offset);
}

function extractMessageId(value: string | undefined | null): string | null {
	if (!value) return null;
	const match = value.match(/<([^>]+)>/);
	return match ? match[1] : value.trim().split(/\s+/)[0] || null;
}

function normalizeAddress(address: string | null | undefined) {
	const normalized = address?.trim().toLowerCase();
	return normalized || undefined;
}

function findMailbox(parsed: any, env: Env, envelopeRecipient?: string): string | undefined {
	const allowed = ((env.EMAIL_ADDRESSES ?? []) as string[])
		.map((a) => normalizeAddress(a))
		.filter(Boolean) as string[];
	const recipients = (parsed.to || [])
		.map((entry: any) => normalizeAddress(entry.address))
		.filter(Boolean) as string[];
	const envelope = normalizeAddress(envelopeRecipient);
	const routingRecipients = envelope ? [envelope] : recipients;
	if (allowed.length > 0) return routingRecipients.find((address) => allowed.includes(address));
	return envelope ?? recipients[0];
}

function hasForwardingMarker(parsed: any): boolean {
	return (parsed.headers || []).some((header: any) =>
		String(header.key || "").toLowerCase() === "x-agentic-inbox-forwarded" &&
		String(header.value || "").trim() === "1"
	);
}

async function archiveMarkerKey(raw: Uint8Array, messageId: string | null): Promise<string> {
	const identity = messageId || Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	const encoded = encodeURIComponent(identity).replace(/%/g, "_");
	return `${ARCHIVE_MARKER_PREFIX}${encoded}`;
}

async function claimArchiveSlot(env: Env, raw: Uint8Array, messageId: string | null): Promise<string | null> {
	const archiveEmail = normalizeAddress(env.ARCHIVE_EMAIL);
	if (!archiveEmail) return null;
	const key = await archiveMarkerKey(raw, messageId);
	const marker = await env.BUCKET.put(key, "1", { onlyIf: new Headers({ "If-None-Match": "*" }) });
	return marker ? key : null;
}

async function forwardToGlobalArchive(event: ForwardableEvent, env: Env, raw: Uint8Array, messageId: string | null, parsed: any) {
	const archiveEmail = normalizeAddress(env.ARCHIVE_EMAIL);
	if (!archiveEmail || hasForwardingMarker(parsed)) return;
	const nativeForward = typeof event.forward === "function" ? event.forward.bind(event) : undefined;
	if (!nativeForward || event.canBeForwarded === false) return;
	if (normalizeAddress(event.to) === archiveEmail) return;
	const markerKey = await claimArchiveSlot(env, raw, messageId);
	if (!markerKey) return;
	try { await nativeForward(archiveEmail); } catch (error) { await env.BUCKET.delete(markerKey); throw error; }
}

export async function receiveEmailWithNotifications(event: ForwardableEvent, env: Env, ctx: ExecutionContext) {
	const raw = await readRaw(event.raw, event.rawSize);
	const parsed = await new PostalMime().parse(raw);
	const mailboxId = findMailbox(parsed, env, event.to);
	await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);
	await forwardToGlobalArchive(event, env, raw, extractMessageId(parsed.messageId), parsed);
	if (!mailboxId) return;
	const settings = await getPostDeliverySettings(env, mailboxId);
	await runPostDelivery(env, ctx, { mailboxId, emailId: extractMessageId(parsed.messageId) || crypto.randomUUID(), sender: (parsed.from?.address || "").toLowerCase(), recipient: "", subject: parsed.subject || "", body: parsed.html || parsed.text || "", date: new Date().toISOString(), messageId: extractMessageId(parsed.messageId), alreadyForwarded: hasForwardingMarker(parsed) }, settings, typeof event.forward === "function" ? event.forward.bind(event) : undefined);
}
