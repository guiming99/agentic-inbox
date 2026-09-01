import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import { validateSender, SenderValidationError, generateMessageId, buildThreadingHeaders, listMailboxes, resolveThreadId } from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { parseJsonBody } from "./lib/validation";

type AppContext = Context<MailboxContext>;
const CreateMailboxBody = z.object({ email:z.string().email(), name:z.string().min(1), settings:z.record(z.any()).optional() });
const DraftBody = z.object({ to:z.string().optional(), cc:z.string().optional(), bcc:z.string().optional(), subject:z.string().optional(), body:z.string(), in_reply_to:z.string().optional(), threa: z.any().optional() } as any);
const UpdateMailboxBody = z.object({settings:z.record(z.any())});
const UpdateEmailBody = z.object({read:z.boolean().optional(),starred:z.boolean().optional()});
const MoveEmailBody = z.object({folderId:z.string().min(1)});
const FolderBody = z.object({name:z.string().min(1)});
const app = new Hono<MailboxContext>();
app.use("/api/*",cors({origin:(origin)=>{if(!origin)return origin;try{const u=new URL(origin);if(u.hostname==="localhost"||u.hostname==="127.0.0.1")return origin;}catch{}return undefined;}}));
app.use("/api/v1/mailboxes/:mailboxId/*",requireMailbox);
const intQuery=(c:AppContext,k:string)=>{const v=c.req.query(k);if(!v)return undefined;const n=Number(v);return Number.isNaN(n)?undefined:n;};
const boolQuery=(c:AppContext,k:string)=>{const v=c.req.query(k);return v===undefined||v===""?undefined:v==="true"||v==="1";};
const slugify=(s:string)=>s.toLowerCase().replace(/\s+/g,"-").replace(/[^\w-]+/g,"").replace(/--+/g,"-").replace(/^-+|-+$/g,"");

app.get("/api/v1/config",c=>{const domains=(c.env.DOMAINS||"").split(",").map(d=>d.trim()).filter(Boolean);return c.json({domains,emailAddresses:c.env.EMAIL_ADDRESSES??[]});});
app.get("/api/v1/mailboxes",async c=>c.json((await listMailboxes(c.env.BUCKET)).map(m=>({...m,name:m.id}))));
app.post("/api/v1/mailboxes",async c=>{const parsed=await parseJsonBody(c,CreateMailboxBody);if(!parsed.success)return parsed.response;const {name,settings,email:raw}=parsed.data;const email=raw;return c.json({});});
app.get("/api/v1/mailboxes/:mailboxId",async c=>{const id=c.req.param("mailboxId")!;const o=await c.env.BUCKET.get(`mailboxes/${id}.json`);if(!o)return c.json({error:"Not found"},404);return c.json(await o.json());});
app.put("/api/v1/mailboxes/:mailboxId",async c=>{const id=c.req.param("mailboxId")!;const parsed=await parseJsonBody(c,UpdateMailboxBody);if(!parsed.success)return parsed.response;const {settings}=parsed.data;await c.env.BUCKET.put(`mailboxes/${id}.json`,JSON.stringify({settings}));return c.json({ok:true});});

app.post("/api/v1/mailboxes/:mailboxId/signature-logo",async c=>{const id=c.req.param("mailboxId")!;const form=await c.req.formData();const file=form.get("file");if(!(file instanceof File))return c.json({error:"File required"},400);await c.env.BUCKET.put(`mailboxes/${id}/signature-logo`,file.stream(),{httpMetadata:{contentType:file.type}});return c.json({ok:true});});
app.get("/api/v1/mailboxes/:mailboxId/signature-logo",async c=>{const id=c.req.param("mailboxId")!;const o=await c.env.BUCKET.get(`mailboxes/${id}/signature-logo`);if(!o)return c.notFound();const h=new Headers();o.writeHttpMetadata(h);h.set("etag",o.httpEtag);return new Response(o.body,{headers:h});});
app.delete("/api/v1/mailboxes/:mailboxId/signature-logo",async c=>{const id=c.req.param("mailboxId")!;await c.env.BUCKET.delete(`mailboxes/${id}/signature-logo`);return c.json({ok:true});});

app.post("/api/v1/mailboxes/:mailboxId/signature-qr/:kind",async c=>{const id=c.req.param("mailboxId")!;const kind=c.req.param("kind");if(kind!=="whatsapp"&&kind!=="telegram"&&kind!=="wechat")return c.json({error:"Invalid QR type"},400);const form=await c.req.formData();const file=form.get("file");if(!(file instanceof File))return c.json({error:"No QR file supplied"},400);await c.env.BUCKET.put(`signature-qrs/${id}/${kind}`,file.stream(),{httpMetadata:{contentType:file.type}});return c.json({key:`signature-qrs/${id}/${kind}`,url:`/api/v1/mailboxes/${encodeURIComponent(id)}/signature-qr/${kind}`});});
app.get("/api/v1/mailboxes/:mailboxId/signature-qr/:kind",async c=>{const id=c.req.param("mailboxId")!;const kind=c.req.param("kind");const o=await c.env.BUCKET.get(`signature-qrs/${id}/${kind}`);if(!o)return c.notFound();const h=new Headers();o.writeHttpMetadata(h);h.set("etag",o.httpEtag);return new Response(o.body,{headers:h});});
app.delete("/api/v1/mailboxes/:mailboxId/signature-qr/:kind",async c=>{const id=c.req.param("mailboxId")!;const kind=c.req.param("kind");await c.env.BUCKET.delete(`signature-qrs/${id}/${kind}`);return c.json({ok:true});});

app.delete("/api/v1/mailboxes/:mailboxId",async c=>{const id=c.req.param("mailboxId")!;const k=`mailboxes/${id}.json`;if(!(await c.env.BUCKET.head(k)))return c.json({error:"Not found"},404);await c.env.BUCKET.delete(k);return c.json({ok:true});});
app.get("/api/v1/mailboxes/:mailboxId/emails",async(c:AppContext)=>{return c.json({emails:[]});});
app.post("/api/v1/mailboxes/:mailboxId/emails",async(c:AppContext)=>{return c.json({ok:true});});
app.post("/api/v1/mailboxes/:mailboxId/drafts",async(c:AppContext)=>{return c.json({ok:true});});
app.get("/api/v1/mailboxes/:mailboxId/emails/:id",async(c:AppContext)=>{const e=await c.var.mailboxStub.getEmail(c.req.param("id")!);return e?c.json(e):c.json({error:"Email not found"},404);});
app.put("/api/v1/mailboxes/:mailboxId/emails/:id",async(c:AppContext)=>{const parsed=await parseJsonBody(c,UpdateEmailBody);if(!parsed.success)return parsed.response;const {read,starred}=parsed.data;await(c.var.mailboxStub as any).updateEmail(c.req.param("id")!,parsed.data);return c.json({ok:true});});
app.delete("/api/v1/mailboxes/:mailboxId/emails/:id",async(c:AppContext)=>{const id=c.req.param("id")!,a=await c.var.mailboxStub.deleteEmail(id);if(a===null)return c.json({error:"Not found"},404);return c.json({ok:true});});
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move",async(c:AppContext)=>{return c.json({ok:true});});
app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId",async(c:AppContext)=>c.json(await(c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!)));
app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read",async(c:AppContext)=>{await(c.var.mailboxStub as any).markThreadRead(c.req.param("threadId")!);return c.json({status:"marked_read"});});
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply",handleReplyEmail);app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward",handleForwardEmail);
app.get("/api/v1/mailboxes/:mailboxId/folders",async(c:AppContext)=>c.json(await c.var.mailboxStub.getFolders()));
app.post("/api/v1/mailboxes/:mailboxId/folders",async(c:AppContext)=>{const parsed=await parseJsonBody(c,FolderBody);if(!parsed.success)return parsed.response;const {name}=parsed.data;const slug=slugify(name);if(!slug)return c.json({error:"Folder name must contain alphanumeric characters"},400);const f=await c.var.mailboxStub.createFolder(slug,name);return f?c.json(f,201):c.json({error:"Folder with this name already exists"},409);});
app.put("/api/v1/mailboxes/:mailboxId/folders/:id",async(c:AppContext)=>{const parsed=await parseJsonBody(c,FolderBody);if(!parsed.success)return parsed.response;const {name}=parsed.data;const f=await c.var.mailboxStub.updateFolder(c.req.param("id")!,name);return f?c.json(f):c.json({error:"Folder not found"},404);});
app.delete("/api/v1/mailboxes/:mailboxId/folders/:id",async(c:AppContext)=>await c.var.mailboxStub.deleteFolder(c.req.param("id")!)?c.body(null,204):c.json({error:"Folder not found or cannot be deleted"},400));
app.get("/api/v1/mailboxes/:mailboxId/search",async(c:AppContext)=>{const opts={query:c.req.query("query")||"",folder:c.req.query("folder"),from:c.req.query("from"),to:c.req.query("to"),subject:c.req.query("subject"),date_start:c.req.query("date_start"),date_end:c.req.query("date_end"),is_read:boolQuery(c,"is_read"),is_starred:boolQuery(c,"is_starred"),has_attachment:boolQuery(c,"has_attachment")};const stub=c.var.mailboxStub as any;const emails=await stub.searchEmails({...opts,page:intQuery(c,"page"),limit:intQuery(c,"limit")});return c.json({emails,totalCount:await stub.countSearchResults(opts)});});
app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId",async(c:AppContext)=>{const emailId=c.req.param("emailId")!,aid=c.req.param("attachmentId")!,a=await c.var.mailboxStub.getAttachment(aid);if(!a)return c.json({error:"Attachment not found"},404);const o=await c.env.BUCKET.get(`attachments/${emailId}/${aid}/${a.filename}`);if(!o)return c.json({error:"Attachment file not found"},404);const h=new Headers();h.set("Content-Type",a.mimetype);const fn=a.filename.replace(/[\x00-\x1f"\\]/g,"_");h.set("Content-Disposition",`${a.disposition==="inline"?"inline":"attachment"}; filename="${fn}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`);return new Response(o.body,{headers:h});});

const MAX_EMAIL_SIZE=25*1024*1024;
async function streamToArrayBuffer(stream:ReadableStream,size:number){if(size>MAX_EMAIL_SIZE||size<=0)throw new Error(`Invalid email size: ${size}`);const out=new Uint8Array(size);let n=0;const r=[];const reader=(stream as ReadableStream).getReader();while(true){const {done,value}=await reader.read();if(done)break;out.set(value,n);n+=value.length;}return out.subarray(0,n);} 

// Allow callers to optionally pass a pre-read buffer and parsed value to avoid double parsing.
type IncomingEmailMessage={raw?:ReadableStream;rawSize?:number;rawBuffer?:Uint8Array;parsed?:any;to?:string};
function normalizeAddress(address:string|null|undefined){const normalized=address?.trim().toLowerCase();return normalized||undefined;}
function parsedAddressList(addresses:Array<{address?:string|null}>|undefined){return addresses?.map(entry=>normalizeAddress(entry.address)).filter((address):address is string=>Boolean(address))??[];}

// Utility to map with limited concurrency.
async function mapWithConcurrency<T,U>(items:T[], limit:number, mapper:(item:T,index:number)=>Promise<U>):Promise<U[]>{
	const results:U[] = new Array(items.length) as U[];
	let i = 0;
	async function worker(){
		while(true){
			const idx = i++;
			if(idx >= items.length) return;
			try{results[idx] = await mapper(items[idx], idx);}catch(e){throw e}
		}
	}
	const workers = [] as Promise<void>[];
	const concurrency = Math.min(limit, items.length);
	for(let w=0; w<concurrency; w++) workers.push(worker());
	await Promise.all(workers);
	return results;
}

async function receiveEmail(event:IncomingEmailMessage,env:Env,ctx:ExecutionContext){console.time("receiveEmail");
	let raw:Uint8Array;
	let parsed:any;
	if(event.rawBuffer && event.parsed){
		raw = event.rawBuffer;
		parsed = event.parsed;
	}else if(event.rawBuffer){
		raw = event.rawBuffer;
		parsed = await new PostalMime().parse(raw);
	}else{
		raw = await streamToArrayBuffer(event.raw!, event.rawSize!);
		parsed = await new PostalMime().parse(raw);
	}
	console.timeEnd("receiveEmail-parse");

	const envelopeRecipient = normalizeAddress(event.to || undefined);
	const recipients = parsedAddressList(parsed.to);
	if(!envelopeRecipient&&!recipients.length)throw new Error("received email with empty to");
	const allowed=((env.EMAIL_ADDRESSES??[]) as string[]).map(a=>normalizeAddress(a)).filter(Boolean) as string[];
	const cc=parsedAddressList(parsed.cc);
	const bcc=parsedAddressList(parsed.bcc);
	const routingRecipients=envelopeRecipient?[envelopeRecipient]:recipients;
	const mailboxId=allowed.length?routingRecipients.find(a=>allowed.includes(a)):envelopeRecipient??recipients[0];
	if(!mailboxId)return;
	const messageId=crypto.randomUUID();
	if(!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`)))return;
	const stub=env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	// Upload attachments in parallel with a small concurrency limit to avoid long serial waits.
	const attachmentData:StoredAttachment[] = [];
	const attachments = parsed.attachments || [];
	if(attachments.length){
		console.time("attachments-upload");
		const uploads = await mapWithConcurrency(attachments, 4, async (att, idx) => {
			const id = crypto.randomUUID();
			const filename = (att.filename||"untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			const key = `attachments/${messageId}/${id}/${filename}`;
			// att.content may be Uint8Array or string; R2.put accepts both.
			await env.BUCKET.put(key, att.content);
			return { id, email_id: messageId, filename, mimetype: att.mimeType, size: typeof att.content === "string" ? att.content.length : att.content?.byteLength ?? 0, content_id: att.contentId || null, disposition: att.disposition || "attachment" } as StoredAttachment;
		});
		attachmentData.push(...uploads);
		console.timeEnd("attachments-upload");
	}

	const extract=(s:string)=>{const m=s.match(/<([^>]+)>/);return m?m[1]:s.trim().split(/\s+/)[0];};
	const inReply=parsed.inReplyTo?extract(parsed.inReplyTo):null;
	const refs=parsed.references?parsed.references.split(/\s+/).filter(Boolean).map(extract):[];
	let threadId=resolveThreadId(messageId,refs,inReply);
	if(!inReply&&!refs.length){
		const t=await(stub as any).findThreadBySubject(parsed.subject||"",parsed.from?.address||undefined);
		if(t)threadId=t;
	}
	const original=parsed.messageId?extract(parsed.messageId):null;
	await stub.createEmail(Folders.INBOX,{id:messageId,subject:parsed.subject||"",sender:(parsed.from?.address||"").toLowerCase(),recipient:(recipients.length?recipients:[mailboxId]).join(", "),cc:cc.join(", ")||null,bcc:bcc.join(", ")||null,date:new Date().toISOString(),body:parsed.html||parsed.text||"",in_reply_to:inReply,email_references:refs.length?JSON.stringify(refs):null,thread_id:threadId,message_id:original,raw_headers:JSON.stringify(parsed.headers)},attachmentData);
	
	const agentStub=env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
	ctx.waitUntil(agentStub.fetch(new Request("https://agents/onNewEmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mailboxId,emailId:messageId,sender:(parsed.from?.address||"").toLowerCase(),subject:parsed.subject||"",threadId})})).catch(e=>console.error("Auto-draft trigger failed:",(e as Error).message)));
	console.timeEnd("receiveEmail");
}

export { app, receiveEmail };