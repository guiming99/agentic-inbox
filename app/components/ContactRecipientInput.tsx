import { Input } from "@cloudflare/kumo";
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
	return value
		.map((c: any) => ({
			id: c?.id || c?.email || "",
			name: (c?.name || c?.email || "").trim(),
			email: (c?.email || "").trim().toLowerCase(),
			company: c?.company || "",
			position: c?.position || "",
		}))
		.filter((c) => c.email);
}

export function contactsFromSettings(value: unknown): RecipientContact[] {
	return normalizeContacts(value);
}

export default function ContactRecipientInput({
	label,
	value,
	onChange,
	contacts,
	placeholder,
	required = false,
}: {
	label?: string;
	value: string;
	onChange: (value: string) => void;
	contacts: RecipientContact[];
	placeholder: string;
	required?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const query = (value.split(",").pop() || "").trim().toLowerCase();
	const suggestions = useMemo(() => {
		const q = query.replace(/[<>]/g, "").trim();
		return contacts
			.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.position?.toLowerCase().includes(q))
			.slice(0, 8);
	}, [contacts, query]);

	const select = (contact: RecipientContact) => {
		const parts = value.split(",");
		parts.pop();
		const prefix = parts.map((v) => v.trim()).filter(Boolean).join(", ");
		const entry = contact.name && contact.name !== contact.email ? `${contact.name} <${contact.email}>` : contact.email;
		onChange(prefix ? `${prefix}, ${entry}, ` : `${entry}, `);
		setOpen(true);
	};

	return (
		<div className="relative">
			<Input
				label={label}
				type="text"
				placeholder={placeholder}
				size="sm"
				value={value}
				onChange={(e) => { onChange(e.target.value); setOpen(true); }}
				onFocus={() => setOpen(true)}
				onBlur={() => setTimeout(() => setOpen(false), 150)}
				required={required}
			/>
			{open && suggestions.length > 0 && (
				<div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-kumo-line bg-kumo-base shadow-lg">
					{suggestions.map((contact) => (
						<button key={contact.id || contact.email} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => select(contact)} className="w-full text-left px-3 py-2 hover:bg-kumo-tint">
							<div className="text-sm font-medium truncate">{contact.name}</div>
							<div className="text-xs text-kumo-subtle truncate">{contact.email}{contact.company ? ` · ${contact.company}` : ""}</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
