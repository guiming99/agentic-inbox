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

type AppContext = Context<MailboxContext>;
const CreateMailboxBody = z.object({ email:z.string().email(), name:z.string().min(1), settings:z.record(z.any()).optional() });
const DraftBody = z.object({ to:z.string().optional(), cc:z.string().optional(), bcc:z.string().optional(), subject:z.string().optional(), body:z.string(), in_reply_to:z.string().optional(), thread_id:z.string().optional(), draft_id:z.string().optional() });
const app = new Hono<MailboxContext>();
app.use("/api/*",cors({origin:(origin)=>{if(!origin)return origin;try{const u=new URL(origin);if(u.hostname==="localhost"||u.hostname==="127.0.0.1")return origin;}catch{}return undefined;}}));
app.use("/api/v1/mailboxes/:mailboxId/*",requireMailbox);
const intQuery=(c:AppContext,k:string)=>{const v=c.req.query(k);if(!v)return undefined;const n=Number(v);return Number.isNaN(n)?undefined:n;};
const boolQuery=(c:AppContext,k:string)=>{const v=c.req.query(k);return v===undefined||v===""?undefined:v==="true"||v==="1";};
const slugify=(s:string)=>s.toLowerCase().replace(/\s+/g,"-").replace(/[^\w-]+/g,"").replace(/--+/g,"-").replace(/^-+|-+$/g,"");

app.get("/api/v1/config",c=>{const domains=(c.env.DOMAINS||"").split(",").map(d=>d.trim()).filter(Boolean);return c.json({domains,emailAddresses:c.env.EMAIL_ADDRESSES??[]});});
app.get("/api/v1/mailboxes",async c=>c.json((await listMailboxes(c.env.BUCKET)).map(m=>({...m,name:m.id}))));
app.post("/api/v1/mailboxes",async c=>{const {name,settings,email:raw}=CreateMailboxBody.parse(await c.req.json());const email=raw.toLowerCase();const allowed=(c.env.EMAIL_ADDRESSES??[]) as string[];if(allowed.length&&!allowed.map(a=>a.toLowerCase()).includes(email))return c.json({error:"Mailbox creation is restricted to configured EMAIL_ADDRESSES"},403);const key=`mailboxes/${email}.json`;if(await c.env.BUCKET.head(key))return c.json({error:"Mailbox already exists"},409);const finalSettings={fromName:name,forwarding:{enabled:false,email:""},signature:{enabled:false,text:""},autoReply:{enabled:false,subject:"",message:""},...settings};await c.env.BUCKET.put(key,JSON.stringify(finalSettings));const stub=c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));await stub.getFolders();return c.json({id:email,email,name,settings:finalSettings},201);});
app.get("/api/v1/mailboxes/:mailboxId",async c=>{const id=c.req.param("mailboxId")!;const o=await c.env.BUCKET.get(`mailboxes/${id}.json`);if(!o)return c.json({error:"Not found"},404);return c.json({id,name:id,email:id,settings:await o.json()});});

const MAX_EMAIL_SIZE=25*1024*1024;
async function streamToArrayBuffer(stream:ReadableStream,size:number){if(size>MAX_EMAIL_SIZE||size<=0)throw new Error(`Invalid email size: ${size}`);const out=new Uint8Array(size);let n=0;const r=stream.getReader();while(true){const {done,value}=await r.read();if(done)break;if(n+value.length>size){r.cancel();throw new Error("Stream exceeds declared size");}out.set(value,n);n+=value.length;}return out;}
async function receiveEmail(event:{raw:ReadableStream;rawSize:number},env:Env,ctx:ExecutionContext){const raw=await streamToArrayBuffer(event.raw,event.rawSize);const parsed=await new PostalMime().parse(raw);const messageId=crypto.randomUUID();const stub=env.MAILBOX.get(env.MAILBOX.idFromName(parsed.to![0].address));const extract=(s:string)=>{const m=s.match(/<([^>]+)>/);return m?m[1]:s.trim().split(/\s+/)[0];};const inReply=parsed.inReplyTo?extract(parsed.inReplyTo):null;const refs=parsed.references?parsed.references.split(/\s+/).filter(Boolean).map(extract):[];let threadId = resolveThreadId(messageId, refs, inReply);if(!inReply&&!refs.length){const t=await(stub as any).findThreadBySubject(parsed.subject||"",parsed.from?.address||undefined);if(t)threadId=t;}}
export { app, receiveEmail };
