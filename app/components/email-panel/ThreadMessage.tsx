// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	CaretDownIcon,
	CaretUpIcon,
	ChatCircleIcon,
	CodeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate, formatShortDate, rewriteInlineImages, stripHtml } from "~/lib/utils";
import type { Email, Folder } from "~/types";

interface ThreadMessageProps {
	email: Email;
	mailboxId?: string;
	mailboxEmail?: string;
	isLast: boolean;
	isDraft?: boolean;
	isSending?: boolean;
	isExpanded: boolean;
	moveToFolders?: Folder[];
	onToggleExpand: () => void;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	onSendDraft?: () => void;
	onEditDraft?: () => void;
	onDeleteDraft?: () => void;
	onToggleStar?: () => void;
	onToggleRead?: () => void;
	onMove?: (folderId: string) => void;
	onSpam?: () => void;
	onDelete?: () => void;
	onViewSource?: () => void;
	onPreviewImage?: (url: string, filename: string) => void;
}

function Avatar({ isDraft, isSelf, sender }: { isDraft?: boolean; isSelf: boolean; sender: string }) {
	return (
		<div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isDraft ? "bg-kumo-fill text-kumo-subtle" : isSelf ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-fill text-kumo-default"}`}>
			{isDraft ? "D" : sender.charAt(0).toUpperCase()}
		</div>
	);
}

function MessageActions({
	email,
	moveToFolders = [],
	onToggleStar,
	onToggleRead,
	onMove,
	onSpam,
	onDelete,
}: Pick<ThreadMessageProps, "email" | "moveToFolders" | "onToggleStar" | "onToggleRead" | "onMove" | "onSpam" | "onDelete">) {
	return (
		<div className="flex items-center gap-0.5">
			{onToggleStar && <Tooltip content={email.starred ? "Unstar" : "Star"} side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<StarIcon size={14} weight={email.starred ? "fill" : "regular"} className={email.starred ? "text-kumo-warning" : ""} />} onClick={onToggleStar} aria-label={email.starred ? "Unstar" : "Star"} className="!h-6 !w-6" /></Tooltip>}
			{onToggleRead && <Tooltip content={email.read ? "Mark as unread" : "Mark as read"} side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={email.read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />} onClick={onToggleRead} aria-label={email.read ? "Mark as unread" : "Mark as read"} className="!h-6 !w-6" /></Tooltip>}
			{onMove && <MessageMoveMenu folders={moveToFolders} onMove={onMove} />}
			{onSpam && <Tooltip content={email.folder_id === "spam" ? "Not spam" : "Mark as spam"} side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<WarningCircleIcon size={14} />} onClick={onSpam} aria-label={email.folder_id === "spam" ? "Not spam" : "Mark as spam"} className="!h-6 !w-6" /></Tooltip>}
			{onDelete && <Tooltip content="Delete" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<TrashIcon size={14} />} onClick={onDelete} aria-label="Delete" className="!h-6 !w-6" /></Tooltip>}
		</div>
	);
}

function MessageMoveMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
	return (
		<div className="relative group/message-move">
			<Tooltip content="Move to folder" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<FolderSimpleIcon size={14} />} aria-label="Move to folder" className="!h-6 !w-6" /></Tooltip>
			<div className="hidden group-hover/message-move:block absolute top-full right-0 z-50 mt-1 min-w-[150px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
				<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Move to</div>
				<div className="h-px bg-kumo-line my-1" />
				{folders.map((f) => <button key={f.id} type="button" className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors" onClick={() => onMove(f.id)}>{f.name}</button>)}
			</div>
		</div>
	);
}

export default function ThreadMessage({
	email,
	mailboxId,
	mailboxEmail,
	isLast,
	isDraft,
	isSending,
	isExpanded,
	moveToFolders,
	onToggleExpand,
	onReply,
	onReplyAll,
	onForward,
	onSendDraft,
	onEditDraft,
	onDeleteDraft,
	onToggleStar,
	onToggleRead,
	onMove,
	onSpam,
	onDelete,
	onViewSource,
	onPreviewImage,
}: ThreadMessageProps) {
	const isSelf = email.sender === mailboxEmail;
	const containerClassName = `${!isLast ? "border-b border-kumo-line" : ""} ${isDraft ? "border-l-2 border-l-kumo-warning bg-kumo-warning/[0.02]" : ""}`;
	const senderLabel = isDraft ? "Draft reply" : isSelf ? "You" : email.sender;

	if (!isExpanded) {
		return (
			<div className={containerClassName}>
				<button type="button" onClick={onToggleExpand} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-kumo-tint rounded-lg text-left">
					<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
					<div className="flex-1 min-w-0"><div className="flex items-center justify-between"><span className="text-sm font-medium text-kumo-default truncate">{senderLabel}</span><span className="text-xs text-kumo-subtle shrink-0">{formatDetailDate(email.date)}</span></div><p className="text-xs text-kumo-subtle truncate">{stripHtml(email.body || "").slice(0, 80)}</p></div>
					<CaretDownIcon size={14} className="text-kumo-subtle shrink-0" />
				</button>
			</div>
		);
	}

	return (
		<div className={`group/thread-msg ${containerClassName}`}>
			<div className="px-4 py-4 md:px-6">
				<div className="flex items-center justify-between gap-3 mb-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<button type="button" onClick={onToggleExpand} className="shrink-0" aria-label="Collapse message"><div className="cursor-pointer hover:ring-2 hover:ring-kumo-brand/30 transition-shadow rounded-full"><Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} /></div></button>
						<div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium text-kumo-default truncate">{senderLabel}</span>{isDraft && <Badge variant="outline">Draft</Badge>}</div><div className="text-xs text-kumo-subtle">To: {email.recipient}</div>{email.cc && <div className="text-xs text-kumo-subtle">Cc: {email.cc}</div>}</div>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<span className="text-xs text-kumo-subtle">{formatShortDate(email.date)}</span>
						{!isDraft && <MessageActions email={email} moveToFolders={moveToFolders} onToggleStar={onToggleStar} onToggleRead={onToggleRead} onMove={onMove} onSpam={onSpam} onDelete={onDelete} />}
						{!isDraft && onReply && <Tooltip content="Reply to this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowBendUpLeftIcon size={14} />} onClick={onReply} aria-label="Reply to this message" className="!h-6 !w-6" /></Tooltip>}
						{!isDraft && onReplyAll && <Tooltip content="Reply all to this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ChatCircleIcon size={14} />} onClick={onReplyAll} aria-label="Reply all to this message" className="!h-6 !w-6" /></Tooltip>}
						{!isDraft && onForward && <Tooltip content="Forward this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowBendUpRightIcon size={14} />} onClick={onForward} aria-label="Forward this message" className="!h-6 !w-6" /></Tooltip>}
						{onViewSource && <Tooltip content="View source" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<CodeIcon size={14} />} onClick={onViewSource} aria-label="View source" className="!h-6 !w-6" /></Tooltip>}
						<button type="button" onClick={onToggleExpand} className="ml-1" aria-label="Collapse message"><CaretUpIcon size={14} className="text-kumo-subtle hover:text-kumo-default transition-colors" /></button>
					</div>
				</div>
				<div className="md:ml-[42px]"><EmailIframe body={rewriteInlineImages(email.body || "", mailboxId || "", email.id, email.attachments)} autoSize /></div>
				{isDraft && (onSendDraft || onEditDraft || onDeleteDraft) && <div className="flex gap-2 mt-3 md:ml-[42px]">{onSendDraft && <Button variant="primary" size="sm" icon={<PaperPlaneTiltIcon size={14} />} onClick={onSendDraft} loading={isSending} disabled={isSending}>{isSending ? "Sending..." : "Send"}</Button>}{onEditDraft && <Button variant="secondary" size="sm" icon={<PencilSimpleIcon size={14} />} onClick={onEditDraft} disabled={isSending}>Edit</Button>}{onDeleteDraft && <Button variant="ghost" size="sm" icon={<TrashIcon size={14} />} onClick={onDeleteDraft} disabled={isSending}>Discard</Button>}</div>}
				<EmailAttachmentList mailboxId={mailboxId} emailId={email.id} attachments={email.attachments} onPreviewImage={onPreviewImage} className="mt-3 md:ml-[42px]" />
			</div>
		</div>
	);
}
