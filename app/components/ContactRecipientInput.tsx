import { Input } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

export interface RecipientContact {
	id: string;
	name: string;
	email: string;
	company?: string;
	position?: string;
}

function normalizeContacts(value: unknown): RecipientContact[] {
	if (!Array.isArray(value)) return [];
	return value.map((c: any) => ({
		id: c?.id || c?.email || "",
		name: (c?.name || c?.email || "").trim(),
		email: (c?.email || "").trim().toLowerCase(),
		company: c?.company || "",
		position: c?.position || "",
	})).filter((c) => c.email);
}

export function contactsFromSettings(value: unknown): RecipientContact[] { return normalizeContacts(value); }

function parseAddresses(value: string): string[] {
	return value.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
}

function emailFromAddress(value: string): string {
	const match = value.match(/<([^<>\s]+@[^<>\s]+)>/);
	return (match?.[1] || value).trim();
}

function displayName(value: string): string {
	const match = value.match(/^\s*(.*?)\s*<[^<>]+>\s*$/);
	return match?.[1]?.trim() || emailFromAddress(value);
}

export default function ContactRecipientInput({ label, value, onChange, contacts, placeholder, required = false }: {
	label?: string;
	value: string;
	onChange: (value: string) => void;
	contacts: RecipientContact[];
	placeholder: string;
	required?: boolean;
}) {
	const [input, setInput] = useState("");
	const [open, setOpen] = useState(false);
	const recipients = useMemo(() => parseAddresses(value), [value]);
	const query = input.trim().toLowerCase();
	const suggestions = useMemo(() => contacts.filter((c) => !query || c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query) || c.company?.toLowerCase().includes(query) || c.position?.toLowerCase().includes(query)).slice(0, 8), [contacts, query]);

	const commitInput = () => {
		const raw = input.trim();
		if (!raw) return;
		const contact = contacts.find((c) => c.email.toLowerCase() === emailFromAddress(raw).toLowerCase() || c.name.toLowerCase() === raw.toLowerCase());
		const entry = contact ? (contact.name && contact.name !== contact.email ? `${contact.name} <${contact.email}>` : contact.email) : raw;
		const next = [...recipients, entry].join(", ");
		onChange(next);
		setInput("");
		setOpen(false);
	};

	const select = (contact: RecipientContact) => {
		const entry = contact.name && contact.name !== contact.email ? `${contact.name} <${contact.email}>` : contact.email;
		if (!recipients.some((r) => emailFromAddress(r).toLowerCase() === contact.email.toLowerCase())) onChange([...recipients, entry].join(", "));
		setInput("");
		setOpen(false);
	};

	return <div className="relative">
		{label && <div className="text-xs font-medium text-kumo-subtle mb-1">{label}</div>}
		<div className="min-h-9 flex flex-wrap items-center gap-1.5 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 focus-within:ring-1 focus-within:ring-kumo-focus">
			{recipients.map((recipient, index) => <span key={`${recipient}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-kumo-tint px-2 py-1 text-xs text-kumo-default max-w-full">
				<span className="truncate max-w-52">{displayName(recipient)}</span>
				<button type="button" aria-label={`Remove ${displayName(recipient)}`} onClick={() => onChange(recipients.filter((_, i) => i !== index).join(", "))} className="shrink-0 rounded-full hover:bg-kumo-line p-0.5"><XIcon size={12} /></button>
			</span>)}
			<Input type="text" value={input} placeholder={recipients.length ? "Add recipient…" : placeholder} size="sm" onChange={(e) => { setInput(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => { setOpen(false); }, 150)} onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); commitInput(); }
				else if (e.key === "Backspace" && !input && recipients.length) { onChange(recipients.slice(0, -1).join(", ")); }
				else if (e.key === "Tab" && input.trim()) commitInput();
			}} className="flex-1 min-w-32 border-0 shadow-none px-1" required={required && recipients.length === 0} />
		</div>
		{open && suggestions.length > 0 && <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-kumo-line bg-kumo-base shadow-lg">{suggestions.map((contact) => <button key={contact.id || contact.email} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => select(contact)} className="w-full text-left px-3 py-2 hover:bg-kumo-tint"><div className="text-sm font-medium truncate">{contact.name}</div><div className="text-xs text-kumo-subtle truncate">{contact.email}{contact.company ? ` · ${contact.company}` : ""}</div></button>)}</div>}
	</div>;
}
