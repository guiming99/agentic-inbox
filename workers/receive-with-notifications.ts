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

/**
 * Claims the archive slot for one original message. R2's conditional PUT
 * makes the claim atomic across concurrent email-worker invocations, so a
 * message delivered to several company mailboxes is archived at most once.
 */
async function claimArchiveSlot(env: Env, raw: Uint8Array, messageId: string | null): Promise<string | null> {
	const archiveEmail = normalizeAddress(env.ARCHIVE_EMAIL);
	if (!archiveEmail) return null;
	const key = await archiveMarkerKey(raw, messageId);
	const marker = await env.BUCKET.put(key, "1", {
		onlyIf: new Headers({ "If-None-Match": "*" }),
	});
	return marker ? key : null;
}

async function forwardToGlobalArchive(
	event: ForwardableEvent,
	env: Env,
	raw: Uint8Array,
	messageId: string | null,
	parsed: any,
) {
	const archiveEmail = normalizeAddress(env.ARCHIVE_EMAIL);
	if (!archiveEmail || hasForwardingMarker(parsed)) return;
	const nativeForward = typeof event.forward === "function" ? event.forward.bind(event) : undefined;
	if (!nativeForward) {
		console.error("Global archive forwarding skipped: native Cloudflare forwarding is unavailable");
		return;
	}
	if (event.canBeForwarded === false) {
		console.error("Global archive forwarding skipped: Cloudflare reports this email cannot be forwarded");
		return;
	}
	const envelopeRecipient = normalizeAddress(event.to);
	if (envelopeRecipient === archiveEmail) return;
	const markerKey = await claimArchiveSlot(env, raw, messageId);
	if (!markerKey) return;
	try {
		await nativeForward(archiveEmail);
		console.log(`Global archive forwarding completed for ${messageId || markerKey}`);
	} catch (error) {
		await env.BUCKET.delete(markerKey).catch((deleteError) => {
			console.error("Failed to release global archive forwarding marker", deleteError);
		});
		throw error;
	}
}

/**
 * Reads the inbound stream once, feeds the receiver unchanged, and then runs
 * the optional forwarding/Telegram pipeline. The original Cloudflare
 * ForwardableEmailMessage.forward() is kept as a bound method so that the
 * native forwarding call retains its original receiver/context.
 */
export async function receiveEmailWithNotifications(
	event: ForwardableEvent,
	env: Env,
	ctx: ExecutionContext,
) {
	const raw = await readRaw(event.raw, event.rawSize);
	const parsed = await new PostalMime().parse(raw);
	const mailboxId = findMailbox(parsed, env, event.to);
	if (!mailboxId) {
		await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);
		return;
	}

	if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
		await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);
		return;
	}

	await receiveEmail({ rawBuffer: raw, parsed, to: event.to }, env, ctx);

	const sender = (parsed.from?.address || "").toLowerCase();
	const recipients = (parsed.to || [])
		.map((entry: any) => entry.address?.toLowerCase())
		.filter(Boolean)
		.join(", ");
	const originalMessageId = extractMessageId(parsed.messageId);
	const delivered: DeliveredEmail = {
		mailboxId,
		emailId: originalMessageId || crypto.randomUUID(),
		sender,
		recipient: recipients,
		subject: parsed.subject || "",
		body: parsed.html || parsed.text || "",
		date: new Date().toISOString(),
		messageId: originalMessageId,
		alreadyForwarded: hasForwardingMarker(parsed),
	};

	await forwardToGlobalArchive(event, env, raw, originalMessageId, parsed);

	const settings = await getPostDeliverySettings(env, mailboxId);
	// When the global archive is configured, it replaces the legacy per-mailbox
	// forwarding target. Other post-delivery features remain unchanged.
	const effectiveSettings = env.ARCHIVE_EMAIL?.trim()
		? { ...settings, forwarding: { enabled: false, email: "" } }
		: settings;
	const nativeForward = typeof event.forward === "function"
		? event.forward.bind(event)
		: undefined;

	if (effectiveSettings.forwarding?.enabled && effectiveSettings.forwarding.email && !nativeForward) {
		console.error("Native email forwarding is unavailable for this email event");
	}
	if (effectiveSettings.forwarding?.enabled && effectiveSettings.forwarding.email && event.canBeForwarded === false) {
		console.error("Cloudflare reports this email cannot be forwarded natively");
	}

	await runPostDelivery(env, ctx, delivered, effectiveSettings, nativeForward);
}